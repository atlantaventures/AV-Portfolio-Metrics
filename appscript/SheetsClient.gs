/**
 * Google Sheets integration — replaces extraction/sheets_client.py's gspread/service-account
 * flow with SpreadsheetApp, bound directly to the container Sheet. No service_account.json,
 * no separate auth step: the script already runs with the permissions of whoever authorized it,
 * scoped to this one spreadsheet (see the spreadsheets.currentonly scope in appsscript.json).
 *
 * Registry and Metrics tab shapes and column order are unchanged from the Python pipeline.
 * The one addition is an optional `backfill_months` column on Registry — see
 * getBackfillMonths_().
 */

var REGISTRY_TAB = 'Registry';
var METRICS_TAB = 'Metrics';
var META_TAB = 'Meta';

var DEFAULT_BACKFILL_MONTHS = 24;

// Hard ceiling, regardless of what's typed into the Registry's backfill_months column. Onboarding
// is a single-company, synchronous operation triggered from the UI (see onboardCompanyByName_()
// in Pipeline.gs) that has to fit inside Apps Script's 6-minute execution limit with nothing else
// running alongside it — 24 months of weekly emails (~100) comfortably does; going meaningfully
// higher risks the run getting killed mid-backfill.
var MAX_BACKFILL_MONTHS = 24;

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getRegistrySheet_() {
  var sheet = getSpreadsheet_().getSheetByName(REGISTRY_TAB);
  if (!sheet) {
    throw new Error('No "' + REGISTRY_TAB + '" tab found in this spreadsheet.');
  }
  return sheet;
}

function getMetricsSheet_() {
  var sheet = getSpreadsheet_().getSheetByName(METRICS_TAB);
  if (!sheet) {
    throw new Error('No "' + METRICS_TAB + '" tab found in this spreadsheet.');
  }
  return sheet;
}

/**
 * Reads a sheet's rows into an array of plain objects keyed by header name — the Apps Script
 * equivalent of gspread's get_all_records(). Adds a non-data __rowIndex field (1-based sheet
 * row number) so callers can write back to the exact row without re-scanning.
 */
function getRowsAsObjects_(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    row.__rowIndex = i + 1;
    rows.push(row);
  }
  return rows;
}

/**
 * backfill_months is optional — blank, zero, or non-numeric all fall back to the 24-month
 * default. Anything above MAX_BACKFILL_MONTHS is silently clamped down to it, rather than
 * honored as typed — see the constant's comment for why.
 */
function getBackfillMonths_(row) {
  var n = parseInt(row.backfill_months, 10);
  if (isNaN(n) || n <= 0) return DEFAULT_BACKFILL_MONTHS;
  return Math.min(n, MAX_BACKFILL_MONTHS);
}

/**
 * Returns Registry rows where status == "Active" AND priorities is filled in (priorities is the
 * universal source of truth — a company with no stated priorities has no data displayed, even
 * if it happens to already have a schema from before this rule existed).
 * Mirrors get_active_companies() in sheets_client.py.
 */
function getActiveCompanies_() {
  var rows = getRowsAsObjects_(getRegistrySheet_());
  var active = [];
  rows.forEach(function (row) {
    var status = String(row.status || '').trim().toLowerCase();
    var schemaJson = String(row.schema_json || '').trim();
    var priorities = String(row.priorities || '').trim();
    if (status !== 'active' || !schemaJson || !priorities) return;

    // A hand-edit gone wrong (a typo, Sheets auto-converting straight quotes to "smart" quotes)
    // shouldn't take down every other company's sync — skip just this one row.
    var schema;
    try {
      schema = JSON.parse(schemaJson);
    } catch (e) {
      Logger.log(
        '  WARNING: ' + row.company + "'s schema_json is malformed JSON (" + e +
          ') — skipping this company.'
      );
      return;
    }
    active.push({
      company: row.company,
      senderEmail: row.sender_email,
      schema: schema,
      backfillMonths: getBackfillMonths_(row),
    });
  });
  return active;
}

/**
 * Finds exactly one Registry row by company name (trimmed, case-insensitive) — the only way a
 * company is looked up for onboarding now, always by explicit name typed into a prompt (see
 * onboardCompanyByName_() in Pipeline.gs), never by scanning for "whatever's pending." Throws a
 * specific, human-readable error rather than returning null/undefined for "not found" or
 * "ambiguous," since the caller shows these directly in a UI alert.
 */
function findRegistryRowByName_(companyName) {
  var rows = getRowsAsObjects_(getRegistrySheet_());
  var target = String(companyName).trim().toLowerCase();
  var matches = rows.filter(function (row) {
    return String(row.company || '').trim().toLowerCase() === target;
  });

  if (matches.length === 0) {
    throw new Error(
      'No company named "' + companyName + '" found in the Registry. Check that the spelling ' +
        'exactly matches the "company" column on the Registry tab.'
    );
  }
  if (matches.length > 1) {
    throw new Error(
      'Multiple Registry rows are named "' + companyName + '". Make company names unique before onboarding.'
    );
  }
  return matches[0];
}

/**
 * Reads every row of the Metrics tab, each as {company, period, metric, value, unit}. Used by
 * Dashboard.gs to build charts.
 *
 * period is normalized back to a plain string here — see normalizePeriodValue_() for why a
 * date-shaped period (a weekly reporter's "YYYY-MM-DD" week-start, or "YYYY-MM") can come back
 * from the Sheet as a Date object instead of the string Claude returned.
 */
function getAllMetricRows_() {
  return getRowsAsObjects_(getMetricsSheet_()).map(function (row) {
    row.period = normalizePeriodValue_(row.period);
    return row;
  });
}

/**
 * A period like "2026-06" or "2026-07-13" looks like a date to Google Sheets, which silently
 * converts the cell to a real Date value on write — Apps Script then reads it back as a JS Date
 * object, not the original string. Left alone, that breaks period sorting (Date objects coerce
 * to strings via Date.toString(), which starts with a day-of-week name — "Wed Apr...", "Mon
 * Jun..." — so a plain lexicographic sort scrambles chronological order) and shows a full
 * timestamp with a GMT offset wherever the period is displayed. This converts any Date-typed
 * period back to plain "YYYY-MM-DD" text; a genuinely non-date period ("2026-Q2", "unknown")
 * passes through as-is.
 *
 * appendMetricRows_() already force-formats the period column as plain text before writing, so
 * this is a defensive fallback for rows written before that fix existed (or a manual paste that
 * re-triggers Sheets' auto-conversion) — not the primary guard.
 */
function normalizePeriodValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

/**
 * rows are [company, period, metric, value, unit, source_email_subject, source_email_date].
 * The last two are traceability-only — they don't affect any pipeline logic, they just let a
 * human trace a given value back to the actual email it was extracted from. Add
 * `source_email_subject` and `source_email_date` as two new columns on the Metrics tab, in
 * whatever position you want, to pick this up; leaving them off entirely still works, rows just
 * skip those two fields. Columns are looked up by header name (see metricsColumnIndex_()) rather
 * than hardcoded position, specifically so where you put these two doesn't matter.
 *
 * This is an upsert, not a blind append: if a row already exists for the same
 * (company, period, metric), its value/unit/source fields are overwritten in place instead of
 * adding a duplicate row. period is whatever granularity EXTRACTION_PROMPT (Prompts.gs) actually
 * normalized to for that email — a week-start date for a weekly reporter, "YYYY-MM" for a
 * monthly one — so this still collapses correctly if a founder ever sends two updates covering
 * the exact same period (e.g. a same-week correction email), without collapsing genuinely
 * distinct weeks into one row the way a fixed monthly bucket used to.
 *
 * "Latest reading wins" for a given period, by design: callers process emails in chronological
 * order (fetchNewEmails_() in GmailClient.gs sorts oldest-first), so whichever email is handed
 * to this function last for a given period is genuinely the most recent one. If a later email
 * covering the same period simply doesn't mention a metric, nothing gets written for it — the
 * existing, still-most-recent-available value (and its original source email) from an earlier
 * email for that period is left untouched rather than being blanked out.
 *
 * The period column is force-formatted to plain text before any new row is written, so Sheets
 * never gets the chance to auto-convert a date-shaped period string into a Date-typed cell in
 * the first place (see normalizePeriodValue_() for what happens downstream if it does).
 */
function appendMetricRows_(rows) {
  if (!rows || rows.length === 0) return;
  var sheet = getMetricsSheet_();
  var col = metricsColumnIndex_(sheet);

  var existingRowIndexByKey = {};
  getRowsAsObjects_(sheet).forEach(function (existingRow) {
    var key = metricRowKey_(existingRow.company, normalizePeriodValue_(existingRow.period), existingRow.metric);
    existingRowIndexByKey[key] = existingRow.__rowIndex;
  });

  rows.forEach(function (row) {
    var company = row[0], period = row[1], metric = row[2];
    var value = row[3], unit = row[4], sourceSubject = row[5], sourceDate = row[6];
    var existingRowIndex = existingRowIndexByKey[metricRowKey_(company, period, metric)];
    var rowIndex = existingRowIndex || sheet.getLastRow() + 1;

    sheet.getRange(rowIndex, col.period).setNumberFormat('@');
    sheet.getRange(rowIndex, col.company).setValue(company);
    sheet.getRange(rowIndex, col.period).setValue(period);
    sheet.getRange(rowIndex, col.metric).setValue(metric);
    sheet.getRange(rowIndex, col.value).setValue(value);
    sheet.getRange(rowIndex, col.unit).setValue(unit);
    if (col.source_email_subject) sheet.getRange(rowIndex, col.source_email_subject).setValue(sourceSubject);
    if (col.source_email_date) sheet.getRange(rowIndex, col.source_email_date).setValue(sourceDate);
  });
}

/**
 * Maps each Metrics tab header name to its 1-based column number. `source_email_subject` and
 * `source_email_date` are optional — absent from the map entirely if the column doesn't exist,
 * which appendMetricRows_() checks for before writing to it.
 */
function metricsColumnIndex_(sheet) {
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  header.forEach(function (name, i) {
    if (name) col[name] = i + 1;
  });
  ['company', 'period', 'metric', 'value', 'unit'].forEach(function (required) {
    if (!col[required]) {
      throw new Error('Metrics tab is missing the required "' + required + '" column.');
    }
  });
  return col;
}

/**
 * Joined with " :: " — a sequence that should never appear in a company name, a period string
 * ("YYYY-MM", "YYYY-MM-DD", "YYYY-Q#"), or a snake_case metric name — so two genuinely different
 * (company, period, metric) triples can never collide onto the same key.
 */
function metricRowKey_(company, period, metric) {
  return company + ' :: ' + period + ' :: ' + metric;
}

/**
 * One-time cleanup for rows written before the fix above existed: rewrites any Date-typed
 * period cell already sitting in the Metrics tab back to plain "YYYY-MM" text, in place. Not
 * required for the dashboard to work — getAllMetricRows_() already normalizes on read — this
 * is only for making the raw Metrics tab itself look right if you open it directly. Run once
 * from the script editor's function dropdown; safe to run more than once.
 */
function fixMetricsTabPeriodFormatting() {
  var sheet = getMetricsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var periodRange = sheet.getRange(2, 2, lastRow - 1, 1);
  var values = periodRange.getValues();
  var fixed = 0;
  var normalized = values.map(function (row) {
    var value = row[0];
    if (Object.prototype.toString.call(value) === '[object Date]') {
      fixed++;
      return [normalizePeriodValue_(value)];
    }
    return [value];
  });

  periodRange.setNumberFormat('@');
  periodRange.setValues(normalized);
  Logger.log('Fixed ' + fixed + ' Date-typed period cell(s) in the Metrics tab.');
}

/** Overwrites a company's schema_json cell in the Registry tab. Mirrors update_company_schema(). */
function updateCompanySchema_(company, schema) {
  var sheet = getRegistrySheet_();
  var rows = getRowsAsObjects_(sheet);
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var schemaCol = header.indexOf('schema_json') + 1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].company === company) {
      sheet.getRange(rows[i].__rowIndex, schemaCol).setValue(JSON.stringify(schema));
      return;
    }
  }
  throw new Error("No Registry row found for company '" + company + "'");
}

/**
 * The Meta tab holds one human-readable cell instead of a hidden PropertiesService value, so
 * anyone can open the Sheet and see when the pipeline last ran without touching the script
 * editor.
 */
function getMetaSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(META_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(META_TAB);
    sheet.getRange('A1').setValue('Last synced: (never)');
  }
  return sheet;
}

/** Returns the last-synced Date, or null if the pipeline has never completed a sync pass. */
function getLastSyncedDate_() {
  var sheet = getMetaSheet_();
  var text = String(sheet.getRange('A1').getValue() || '');
  var match = /Last synced:\s*(.+)/.exec(text);
  if (match) {
    var parsed = new Date(match[1].trim());
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function setLastSyncedDate_(date) {
  getMetaSheet_().getRange('A1').setValue('Last synced: ' + date.toISOString());
}
