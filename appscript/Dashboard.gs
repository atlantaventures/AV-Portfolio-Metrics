/**
 * Dashboard — one tab per active company (not one shared "Dashboard" tab). Each company's tab
 * has:
 *  - a visible (Date x metric) pivot table, number-formatted per metric's unit, so exact data
 *    points are readable at a glance instead of only on chart hover. The Date column shows the
 *    exact source-email date (MM/DD/YYYY), not the coarser period bucket used for grouping —
 *    see periodDateLabels_().
 *  - a slicer on Date that filters that table AND every chart built from it — Sheets applies
 *    a slicer's row-filtering to any chart sourced from the same range, so one control narrows
 *    both the table and every chart on the tab at once
 *  - one line chart per metric, each a fixed pixel size and stacked with a fixed pixel gap, so
 *    charts never overlap regardless of the sheet's row heights or column widths
 *  - any period-over-period move of EXTREME_MOVE_THRESHOLD or more is highlighted directly in
 *    the pivot table, plus summarized in one line above it, so a real swing (good or bad) gets
 *    noticed instead of sitting unremarked among a lot of numbers — see flagExtremeMoves_()
 *
 * Number formatting: table cells use a per-unit format (percent / USD / count) so the visible
 * numbers never show scientific notation, and each chart's vertical axis uses Google Charts'
 * `format: 'short'` option, which renders large values as "1M" / "300K" instead of "1.0E+06".
 *
 * Axis scaling: each chart's vertical axis is explicitly zoomed to that metric's own min/max
 * (plus a little padding), rather than Google Charts' default 'pretty' auto-range — see
 * numericViewWindowForMetric_(). Left on the default, a metric like revenue moving 15% month
 * over month (e.g. $1.2M -> $1.4M) can get auto-expanded to a $0-$1.5M+ axis, which makes a real
 * trend look like a flat line. This trades the "always anchored at zero" convention bar charts
 * use for one that shows the actual month-to-month movement clearly, which is the point of a
 * trend line on a tracking dashboard like this one.
 *
 * Scorecard cards are still not scriptable — Apps Script's chart-building API has no SCORECARD
 * type as of this writing (verified against the current Charts.ChartType docs). Add those by
 * hand per company tab if you want them; see SETUP.md.
 *
 * rebuildDashboard_() also refreshes a small summary table on the Meta tab (see
 * updateMetaSummaryTable_() below) — one row per active company with its latest primary-revenue
 * reading, so the single most important number per company is visible without opening any
 * company tab.
 */

// Column far to the right of any real content — used to tag a tab as "owned" by this script,
// so a rebuild can safely delete a company's tab if that company is later removed/renamed
// without ever touching a sheet it didn't create itself.
var COMPANY_TAB_MARKER_COL = 50;
var COMPANY_TAB_MARKER_VALUE = 'PORTFOLIO_PULSE_COMPANY_TAB';

var PIVOT_START_ROW = 5;
var PIVOT_START_COL = 1;
var SLICER_GAP_COLS = 2;

var CHART_WIDTH_PX = 640;
var CHART_HEIGHT_PX = 340;
var CHART_GAP_PX = 40; // vertical breathing room between stacked charts
var CHART_TOP_PADDING_ROWS = 2; // breathing room between the pivot table and the first chart

// A period-over-period relative change at or beyond this magnitude gets flagged — same
// threshold and same color regardless of direction, since a 30% move deserves a second look
// whether it's a gain or a loss.
var EXTREME_MOVE_THRESHOLD = 0.2;
var EXTREME_MOVE_COLOR = '#FCE4B8';

/**
 * Rebuilds every active company's tab from scratch, and removes any tab this script created
 * for a company that's no longer active (status changed, or the row was removed/renamed).
 * Safe to call repeatedly.
 */
function rebuildDashboard_() {
  var companies = getActiveCompanies_();
  var allRows = getAllMetricRows_();

  var activeTabNames = {};
  companies.forEach(function (company) {
    activeTabNames[sanitizeSheetName_(company.company)] = true;
  });
  removeStaleCompanyTabs_(activeTabNames);

  companies.forEach(function (company) {
    var metricNames = Object.keys(company.schema);
    var series = allRows.filter(function (row) {
      return row.company === company.company;
    });
    buildCompanyTab_(company, metricNames, series);
  });

  enforceTabOrder_();
  updateMetaSummaryTable_(companies, allRows);
}

// Left blank below the Meta tab's "Last synced" cell (row 1) as a visual gap.
var META_SUMMARY_START_ROW = 3;
var META_SUMMARY_HEADER = ['Company', 'Date', 'Value'];

/**
 * Writes a small "latest reading per company" table to the Meta tab — one row per active
 * company, its primary-revenue reading (whichever metric its schema tags "primary_revenue" —
 * see primaryRevenueMetricName_()) and the exact date of the email that reading came from. No
 * metric name column: this table is deliberately just company/date/value, on the assumption
 * that whoever's glancing at this already knows what each company's headline number is.
 *
 * Refreshed by rebuildDashboard_() — i.e. on every "Sync now"/scheduled sync AND every
 * onboarding run, same as the rest of the dashboard.
 */
function updateMetaSummaryTable_(companies, allRows) {
  var sheet = getMetaSheet_();
  clearMetaSummaryTable_(sheet);

  sheet.getRange(META_SUMMARY_START_ROW, 1)
    .setValue('Latest primary revenue metric per company')
    .setFontWeight('bold');
  sheet.getRange(META_SUMMARY_START_ROW + 1, 1, 1, META_SUMMARY_HEADER.length)
    .setValues([META_SUMMARY_HEADER])
    .setFontWeight('bold');

  if (companies.length === 0) return;

  var dataStartRow = META_SUMMARY_START_ROW + 2;
  companies.forEach(function (company, index) {
    var row = dataStartRow + index;
    var metricName = primaryRevenueMetricName_(company.schema);

    if (!metricName) {
      sheet.getRange(row, 1, 1, META_SUMMARY_HEADER.length).setValues([[company.company, '(no primary revenue metric)', '']]);
      return;
    }

    var latest = latestMetricReading_(allRows, company.company, metricName);
    if (!latest) {
      sheet.getRange(row, 1, 1, META_SUMMARY_HEADER.length).setValues([[company.company, '(no data yet)', '']]);
      return;
    }

    sheet.getRange(row, 1, 1, META_SUMMARY_HEADER.length).setValues([[company.company, exactDateLabel_(latest), latest.value]]);
    var unit = (company.schema[metricName] && company.schema[metricName].unit) || '';
    sheet.getRange(row, 3).setNumberFormat(cellFormatForUnit_(unit));
  });

  sheet.autoResizeColumns(1, META_SUMMARY_HEADER.length);
}

// Wider than META_SUMMARY_HEADER.length on purpose: clears stray columns left over from a
// previous rebuild under a wider table shape (e.g. the old Company/Metric/Period/Value layout),
// not just whatever the current header happens to be.
var META_SUMMARY_CLEAR_COLS = 6;

/** Clears whatever the summary table's previous rebuild left behind, so a shrinking company list or a shrinking table shape doesn't leave stale cells. */
function clearMetaSummaryTable_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow >= META_SUMMARY_START_ROW) {
    sheet.getRange(META_SUMMARY_START_ROW, 1, lastRow - META_SUMMARY_START_ROW + 1, META_SUMMARY_CLEAR_COLS).clear();
  }
}

/** The metric name in `schema` tagged category "primary_revenue", or null if none is. */
function primaryRevenueMetricName_(schema) {
  var metricNames = Object.keys(schema);
  for (var i = 0; i < metricNames.length; i++) {
    if (schema[metricNames[i]] && schema[metricNames[i]].category === 'primary_revenue') {
      return metricNames[i];
    }
  }
  return null;
}

/** The most recent (by period, lexicographically) numeric reading of `metricName` for `companyName`, or null. */
function latestMetricReading_(allRows, companyName, metricName) {
  var matches = allRows.filter(function (row) {
    return row.company === companyName && row.metric === metricName && typeof row.value === 'number';
  });
  if (matches.length === 0) return null;

  matches.sort(function (a, b) {
    return a.period < b.period ? -1 : a.period > b.period ? 1 : 0;
  });
  return matches[matches.length - 1];
}

function removeStaleCompanyTabs_(activeTabNames) {
  var ss = getSpreadsheet_();
  ss.getSheets().forEach(function (sheet) {
    if (isOwnedCompanyTab_(sheet) && !activeTabNames[sheet.getName()]) {
      ss.deleteSheet(sheet);
    }
  });
}

function isOwnedCompanyTab_(sheet) {
  return sheet.getRange(1, COMPANY_TAB_MARKER_COL).getValue() === COMPANY_TAB_MARKER_VALUE;
}

/**
 * Creates a company's tab at the current end of the sheet list if it doesn't exist yet — never
 * at whatever position Apps Script's no-index insertSheet() default happens to pick (which can
 * land before Registry/Metrics). Combined with enforceTabOrder_() pinning Registry/Metrics/Meta
 * to the front on every rebuild, this is what keeps company tabs appearing in creation order,
 * after the three fixed tabs, instead of scattered wherever they happened to get inserted.
 */
function getOrCreateCompanyTab_(companyName) {
  var ss = getSpreadsheet_();
  var name = sanitizeSheetName_(companyName);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name, ss.getNumSheets()); // insertSheet's index is 0-indexed
  }
  return sheet;
}

/**
 * Pins Registry, Metrics, and Meta to the front, in that order, leaving every other tab
 * (company tabs) in whatever relative order they were already in. Restores whichever sheet was
 * active beforehand, since moving a sheet requires making it active first.
 *
 * Meta may not exist yet the very first time this runs (it's created lazily by
 * getMetaSheet_() in SheetsClient.gs) — moveTabToFront_ skips gracefully if a name isn't found.
 */
function enforceTabOrder_() {
  var ss = getSpreadsheet_();
  var originalActive = ss.getActiveSheet();

  moveTabToFront_(ss, REGISTRY_TAB, 1); // moveActiveSheet's position is 1-indexed
  moveTabToFront_(ss, METRICS_TAB, 2);
  moveTabToFront_(ss, META_TAB, 3);

  ss.setActiveSheet(originalActive);
}

function moveTabToFront_(ss, sheetName, onePos) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return;
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(onePos);
}

/** Sheet tab names can't contain [ ] * / \ ? : and can't be blank or over 100 characters. */
function sanitizeSheetName_(name) {
  var cleaned = String(name).replace(/[\[\]*/\\?:]/g, '-').trim();
  if (!cleaned) cleaned = 'Company';
  return cleaned.substring(0, 100);
}

function buildCompanyTab_(company, metricNames, series) {
  var sheet = getOrCreateCompanyTab_(company.company);
  sheet.clear(); // full reset every rebuild — no stray formatting left over from a shrunk table
  sheet.getCharts().forEach(function (chart) {
    sheet.removeChart(chart);
  });
  sheet.getSlicers().forEach(function (slicer) {
    slicer.remove();
  });
  sheet.getRange(1, COMPANY_TAB_MARKER_COL).setValue(COMPANY_TAB_MARKER_VALUE);

  sheet.getRange(1, 1).setValue(company.company + ' — Dashboard').setFontSize(16).setFontWeight('bold');

  var periods = distinctSortedPeriods_(series);
  var byPeriod = buildPeriodLookup_(series, periods);
  var periodLabels = periodDateLabels_(series, periods);
  var pivotRange = writeCompanyPivotTable_(sheet, company, metricNames, periods, byPeriod, periodLabels);

  if (periods.length === 0) {
    sheet.getRange(2, 1).setValue('No metric data yet — check back after the next sync.');
    return;
  }

  sheet.getRange(2, 1).setValue('Use the slicer to filter which dates the table and charts below show.');

  var extremeMoves = flagExtremeMoves_(sheet, metricNames, periods, byPeriod, periodLabels);
  var movesSummary = extremeMovesSummary_(extremeMoves);
  if (movesSummary) {
    sheet.getRange(3, 1).setValue(movesSummary).setFontColor('#B45F06').setFontWeight('bold');
  }

  insertPeriodSlicer_(sheet, pivotRange, metricNames.length);
  insertMetricCharts_(sheet, company, metricNames, periods, byPeriod);
}

/**
 * Highlights any pivot-table cell whose value moved by EXTREME_MOVE_THRESHOLD or more (relative
 * change) from that metric's previous *available* reading — not necessarily the immediately
 * preceding period, since a metric can have gaps. Returns the list of flagged moves so the
 * caller can also render a one-line summary above the table; a human glancing at the sheet
 * shouldn't have to scan every cell to notice a real swing.
 */
function flagExtremeMoves_(sheet, metricNames, periods, byPeriod, periodLabels) {
  var moves = [];

  metricNames.forEach(function (metricName, metricIndex) {
    var previousValue = null;
    var previousPeriod = null;

    periods.forEach(function (period, periodIndex) {
      var value = byPeriod[period][metricName];
      if (typeof value !== 'number') return; // no reading this period — nothing to compare

      if (typeof previousValue === 'number' && previousValue !== 0) {
        var pctChange = (value - previousValue) / Math.abs(previousValue);
        if (Math.abs(pctChange) >= EXTREME_MOVE_THRESHOLD) {
          var row = PIVOT_START_ROW + 1 + periodIndex;
          var col = PIVOT_START_COL + 1 + metricIndex;
          sheet.getRange(row, col).setBackground(EXTREME_MOVE_COLOR);
          moves.push({
            metricName: metricName,
            fromDate: periodLabels[previousPeriod],
            toDate: periodLabels[period],
            pctChange: pctChange,
          });
        }
      }

      previousValue = value;
      previousPeriod = period;
    });
  });

  return moves;
}

function extremeMovesSummary_(moves) {
  if (moves.length === 0) return '';
  var parts = moves.map(function (move) {
    var sign = move.pctChange >= 0 ? '+' : '';
    return move.metricName + ' ' + sign + Math.round(move.pctChange * 100) + '% (' +
      move.fromDate + ' → ' + move.toDate + ')';
  });
  return '⚠ Large moves (' + Math.round(EXTREME_MOVE_THRESHOLD * 100) + '%+): ' + parts.join('; ');
}

function distinctSortedPeriods_(series) {
  var seen = {};
  series.forEach(function (row) {
    seen[row.period] = true;
  });
  return Object.keys(seen).sort();
}

/** {period: {metric: value}} — built once per tab and shared by the table and the charts. */
function buildPeriodLookup_(series, periods) {
  var byPeriod = {};
  periods.forEach(function (period) {
    byPeriod[period] = {};
  });
  series.forEach(function (row) {
    byPeriod[row.period][row.metric] = row.value;
  });
  return byPeriod;
}

/**
 * {period: "MM/DD/YYYY"} — the exact date of the email that produced each period's data, not
 * the (coarser) period bucket itself. A period bucket can in principle hold rows from more than
 * one email (e.g. a same-week correction email that only restates one of several metrics — see
 * appendMetricRows_() in SheetsClient.gs), so this takes the latest source_email_date among that
 * period's rows, consistent with "latest reading wins" everywhere else in this pipeline.
 *
 * Falls back to the raw period string if source_email_date is missing entirely (the column is
 * optional — see SETUP.md) or unparseable, so an older Sheet without that column still renders.
 */
function periodDateLabels_(series, periods) {
  var latestDateByPeriod = {};
  series.forEach(function (row) {
    var raw = row.source_email_date;
    if (!raw) return;
    var date = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(date.getTime())) return;
    var existing = latestDateByPeriod[row.period];
    if (!existing || date.getTime() > existing.getTime()) {
      latestDateByPeriod[row.period] = date;
    }
  });

  var labels = {};
  periods.forEach(function (period) {
    var date = latestDateByPeriod[period];
    labels[period] = date ? formatDateLabel_(date) : period;
  });
  return labels;
}

/** "MM/DD/YYYY" for a real Date. */
function formatDateLabel_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MM/dd/yyyy');
}

/**
 * A single row's exact source-email date as "MM/DD/YYYY" (see formatDateLabel_()), or its raw
 * period string if source_email_date is missing/unparseable. Used by the Meta tab's summary
 * table, which shows one row (one email's reading) at a time rather than a whole period's worth
 * — see periodDateLabels_() for the equivalent when multiple rows share a period bucket.
 */
function exactDateLabel_(row) {
  var raw = row.source_email_date;
  var date = raw ? (raw instanceof Date ? raw : new Date(raw)) : null;
  return date && !isNaN(date.getTime()) ? formatDateLabel_(date) : row.period;
}

/**
 * Writes a wide (Date, metric1, metric2, ...) table starting at PIVOT_START_ROW/COL and
 * returns its full range (header + data rows). Each metric column is number-formatted per its
 * declared unit so the visible table never shows scientific notation. The first column shows the
 * exact source-email date (see periodDateLabels_()) rather than the period bucket string — rows
 * are still keyed and ordered by the underlying period, only the displayed label changes.
 */
function writeCompanyPivotTable_(sheet, company, metricNames, periods, byPeriod, periodLabels) {
  var header = ['Date'].concat(metricNames);
  sheet.getRange(PIVOT_START_ROW, PIVOT_START_COL, 1, header.length).setValues([header]).setFontWeight('bold');

  var values = periods.map(function (period) {
    return [periodLabels[period]].concat(
      metricNames.map(function (metricName) {
        return Object.prototype.hasOwnProperty.call(byPeriod[period], metricName)
          ? byPeriod[period][metricName]
          : '';
      })
    );
  });

  if (values.length > 0) {
    sheet.getRange(PIVOT_START_ROW + 1, PIVOT_START_COL, values.length, header.length).setValues(values);

    metricNames.forEach(function (metricName, index) {
      var col = PIVOT_START_COL + 1 + index;
      var unit = (company.schema[metricName] && company.schema[metricName].unit) || '';
      sheet.getRange(PIVOT_START_ROW + 1, col, values.length, 1).setNumberFormat(cellFormatForUnit_(unit));
    });

    sheet.autoResizeColumns(PIVOT_START_COL, header.length);
  }

  return sheet.getRange(PIVOT_START_ROW, PIVOT_START_COL, 1 + values.length, header.length);
}

/**
 * Cell-level number format per unit — a literal quoted suffix for percent (not Sheets' "%"
 * format, which would multiply our already-in-percentage-points values by 100 and show 1200%
 * for a value of 12).
 */
function cellFormatForUnit_(unit) {
  switch (unit) {
    case 'percent':
      return '0.0"%"';
    case 'USD':
    case 'USD_per_month':
      return '$#,##0';
    case 'count':
      return '#,##0';
    default:
      return '#,##0.##';
  }
}

/** Chart vertical-axis format per unit — 'short' abbreviates big numbers (1M, 300K); percent stays plain. */
function chartAxisFormatForUnit_(unit) {
  return unit === 'percent' ? '#,##0"%"' : 'short';
}

/**
 * Zooms a metric's vertical axis to its own data range, so real movement is visible instead of
 * getting lost in Google Charts' default auto-range (see the "Axis scaling" note at the top of
 * this file). Padding is 15% of the data's range on each side; for a flat line or a single data
 * point (range of 0), falls back to 10% of the value's own magnitude so the axis still has some
 * breathing room instead of collapsing to zero width. Returns null if there's no numeric data
 * for this metric at all, so the caller can leave the axis on Charts' default.
 */
function numericViewWindowForMetric_(metricName, periods, byPeriod) {
  var values = periods
    .map(function (period) {
      return byPeriod[period][metricName];
    })
    .filter(function (value) {
      return typeof value === 'number';
    });

  if (values.length === 0) return null;

  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  var range = max - min;
  var padding = range > 0 ? range * 0.15 : Math.max(Math.abs(max) * 0.1, 1);

  return { min: min - padding, max: max + padding };
}

/**
 * One slicer, anchored just past the table, filtering the Date column (column 1 of
 * pivotRange). Because it shares pivotRange's rows with every chart built below, filtering it
 * filters the table and every chart together.
 */
function insertPeriodSlicer_(sheet, pivotRange, numMetrics) {
  var anchorCol = PIVOT_START_COL + 1 + numMetrics + SLICER_GAP_COLS;
  var slicer = sheet.insertSlicer(pivotRange, PIVOT_START_ROW, anchorCol);
  slicer.setColumnFilterCriteria(1, SpreadsheetApp.newFilterCriteria().build());
  slicer.setTitle('Filter by date');
}

/**
 * One line chart per metric, stacked vertically below the table. Each chart is anchored at the
 * SAME cell (chartAnchorRow, PIVOT_START_COL) and positioned purely with pixel offsets, so
 * spacing never depends on the sheet's actual row heights — this is what keeps charts from
 * overlapping each other regardless of zoom level or manual row resizing.
 */
function insertMetricCharts_(sheet, company, metricNames, periods, byPeriod) {
  var chartAnchorRow = PIVOT_START_ROW + periods.length + 1 + CHART_TOP_PADDING_ROWS;

  metricNames.forEach(function (metricName, index) {
    var periodColRange = sheet.getRange(PIVOT_START_ROW, PIVOT_START_COL, periods.length + 1, 1);
    var metricColRange = sheet.getRange(PIVOT_START_ROW, PIVOT_START_COL + 1 + index, periods.length + 1, 1);
    var unit = (company.schema[metricName] && company.schema[metricName].unit) || '';
    var viewWindow = numericViewWindowForMetric_(metricName, periods, byPeriod);

    var chartBuilder = sheet
      .newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(periodColRange)
      .addRange(metricColRange)
      .setNumHeaders(1)
      .setOption('title', metricName)
      .setOption('width', CHART_WIDTH_PX)
      .setOption('height', CHART_HEIGHT_PX)
      .setOption('vAxis.format', chartAxisFormatForUnit_(unit))
      .setOption('legend', { position: 'none' })
      .setOption('pointSize', 6) // Charts defaults to 0 (no markers) for line charts — without
      // this, only the connecting line renders and each period's actual reading is invisible.
      .setPosition(chartAnchorRow, PIVOT_START_COL, 0, index * (CHART_HEIGHT_PX + CHART_GAP_PX));

    if (viewWindow) {
      chartBuilder
        .setOption('vAxis.viewWindowMode', 'explicit')
        .setOption('vAxis.viewWindow.min', viewWindow.min)
        .setOption('vAxis.viewWindow.max', viewWindow.max);
    }

    sheet.insertChart(chartBuilder.build());
  });
}
