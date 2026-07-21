/**
 * Two entirely separate operations, never run together in the same execution:
 *
 * - Onboarding: always manual, always exactly one company, always looked up by the name typed
 *   into the "Onboard company..." prompt (see onboardCompanyByName_() below and
 *   onboardCompanyPrompt() in Code.gs). Proposes a schema, then immediately does a one-time deep
 *   backfill for that company alone (backfill_months, capped at MAX_BACKFILL_MONTHS — see
 *   SheetsClient.gs). This never runs on a schedule and never processes more than one company,
 *   specifically so its worst-case running time is bounded and nothing else is competing for the
 *   same 6-minute Apps Script execution window.
 * - Sync: runs on the biweekly trigger (or "Sync now"), and only ever does incremental syncing
 *   for companies that already have a schema — it never onboards anything, no matter how many
 *   Registry rows are sitting with a blank schema_json. Searches Gmail only for messages since
 *   the last global run (the Meta tab's "Last synced" cell), never a wide backfill window.
 *
 * Each company's sync is wrapped in its own try/catch so one bad row (malformed schema_json, one
 * failed API call) doesn't take down the whole run. Errors thrown by the top-level entry points
 * below (runPortfolioPulse, syncNow) are left to propagate, so Apps Script's built-in
 * failure-notification email actually fires. onboardCompanyByName_() is the exception — its
 * errors are meant to propagate all the way to a UI alert a human is actively watching, not a
 * log they'd have to go looking for.
 */

// ~6 months — mirrors LOOKBACK_DAYS_IF_FIRST_RUN in run_pipeline.py. Only used the very first
// time the sync pass ever runs, before the Meta tab has a "Last synced" value at all.
var FIRST_RUN_LOOKBACK_MONTHS = 6;

/**
 * Onboards exactly one company, looked up by name. Throws a specific, human-readable error for
 * every way this can legitimately fail to proceed — not found, ambiguous name, not Active, no
 * priorities, or already onboarded — since the caller (onboardCompanyPrompt() in Code.gs) shows
 * these directly in an alert.
 *
 * "Already onboarded" (schema_json already filled in) is a hard refusal, not a silent no-op or
 * an automatic re-run: redoing a backfill re-spends API credits on the same history and can
 * produce slightly different values on re-extraction, so it's made a deliberate two-step action
 * (clear schema_json on the Registry row, then onboard again) rather than something a repeat
 * click or a typo'd company name could trigger by accident.
 */
function onboardCompanyByName_(companyName) {
  var row = findRegistryRowByName_(companyName);

  var status = String(row.status || '').trim().toLowerCase();
  var schemaJson = String(row.schema_json || '').trim();
  var priorities = String(row.priorities || '').trim();

  if (status !== 'active') {
    throw new Error(
      '"' + row.company + '" is not Active in the Registry (status is "' + (row.status || '(blank)') +
        '"). Set status to Active before onboarding.'
    );
  }
  if (!priorities) {
    throw new Error(
      '"' + row.company + '" has no priorities set. Fill in the Registry\'s priorities column before onboarding.'
    );
  }
  if (schemaJson) {
    throw new Error(
      '"' + row.company + '" already has a schema — it looks like this company was already onboarded. ' +
        'Onboarding only ever runs once per company; to redo it (e.g. the founder changed how they report ' +
        'metrics), clear this row\'s schema_json cell first, then onboard it again.'
    );
  }

  var backfillMonths = getBackfillMonths_(row);

  Logger.log('Onboarding "' + row.company + '"...');
  var schema = proposeSchemaFromSender_(row.sender_email, row.company, priorities);
  updateCompanySchema_(row.company, schema);
  Logger.log('  Schema saved: ' + Object.keys(schema).length + ' metric(s): ' + Object.keys(schema).join(', '));

  var emails, rowsWritten;
  try {
    var backfillSince = monthsAgo_(backfillMonths);
    emails = fetchNewEmails_(row.sender_email, backfillSince, row.company);
    rowsWritten = processEmails_(row.company, schema, emails);
  } catch (err) {
    // The schema is already saved by this point, so a bare re-onboard attempt would now hit the
    // "already has a schema" refusal above — spell out the actual recovery path so that refusal
    // doesn't leave a human stuck not knowing why nothing worked.
    throw new Error(
      '"' + row.company + '" was onboarded (schema saved) but the history backfill failed: ' + err +
        '. To retry the backfill, clear this row\'s schema_json cell and run "Onboard company..." again.'
    );
  }

  rebuildDashboardSafely_();

  return {
    company: row.company,
    metricNames: Object.keys(schema),
    emailCount: emails.length,
    rowsWritten: rowsWritten,
    backfillMonths: backfillMonths,
  };
}

/**
 * Runs relevance-check then extraction on each email, appending resulting rows to the Metrics
 * tab. Shared by both the onboarding backfill and the incremental sync, since the only
 * difference between them is which emails were fetched (wide window vs. narrow window).
 */
function processEmails_(companyName, schema, emails) {
  var totalRows = 0;
  emails.forEach(function (email) {
    try {
      if (!shouldExtract_(email.subject, email.body)) {
        Logger.log("  " + companyName + ": skipped '" + email.subject + "' (not a performance update)");
        return;
      }
      var result = extractMetrics_(email.body, schema, email.date.toISOString());
      var rows = rowsForSheet_(companyName, result, email);
      appendMetricRows_(rows);
      totalRows += rows.length;
      Logger.log('  ' + companyName + ': extracted ' + rows.length + " metric(s) from '" + email.subject + "'");
    } catch (err) {
      Logger.log('  ERROR processing an email for ' + companyName + ': ' + err);
    }
  });
  return totalRows;
}

/**
 * Incremental sync for every already-onboarded Active company. `since` is the incremental sync
 * window — the Meta tab's last-synced timestamp, or the first-run fallback.
 */
function syncActiveCompanies_(since) {
  var totalRows = 0;
  getActiveCompanies_().forEach(function (company) {
    try {
      var emails = fetchNewEmails_(company.senderEmail, since, company.company);
      if (emails.length === 0) {
        Logger.log('  ' + company.company + ': no new emails');
        return;
      }
      totalRows += processEmails_(company.company, company.schema, emails);
    } catch (err) {
      Logger.log('  ERROR syncing ' + company.company + ': ' + err);
    }
  });
  return totalRows;
}

/**
 * Scheduled entry point — the function the biweekly time-driven trigger calls (see SETUP.md).
 * Sync-only: identical to clicking "Sync now" by hand, just automatic. Onboarding never runs
 * from here, no matter how many Registry rows have a blank schema_json — see the top-of-file
 * comment for why.
 */
function runPortfolioPulse() {
  syncNow();
}

/**
 * The dashboard is a convenience view, not the source of truth — a chart-building hiccup
 * (e.g. a transient Sheets API error) should never be allowed to make the run look like it
 * failed. Log and move on rather than throwing.
 */
function rebuildDashboardSafely_() {
  try {
    rebuildDashboard_();
  } catch (err) {
    Logger.log('WARNING: dashboard rebuild failed, data pipeline is unaffected: ' + err);
  }
}

/** Menu item: "Portfolio Pulse -> Sync now" — incremental sync for every already-onboarded Active company. */
function syncNow() {
  var runStartedAt = new Date();
  var since = getLastSyncedDate_() || monthsAgo_(FIRST_RUN_LOOKBACK_MONTHS, runStartedAt);

  Logger.log('Checking for updates since ' + since.toISOString() + '...');
  var rowsWritten = syncActiveCompanies_(since);

  setLastSyncedDate_(runStartedAt);
  rebuildDashboardSafely_();
  Logger.log('Done. ' + rowsWritten + ' row(s) written to the Metrics tab this run.');
}
