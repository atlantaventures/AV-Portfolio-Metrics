/**
 * Entry point: custom Sheet menu + (optional) trigger installer.
 *
 * onOpen() runs automatically every time the bound Sheet is opened and adds the
 * "Portfolio Pulse" menu, so a non-technical person can add a Registry row and onboard it
 * without waiting for the scheduled trigger or opening the script editor at all.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Portfolio Pulse')
    .addItem('Sync now', 'syncNow')
    .addItem('Onboard company...', 'onboardCompanyPrompt')
    .addItem('Rebuild dashboard', 'rebuildDashboardSafely_')
    .addToUi();
}

/**
 * Menu item: "Portfolio Pulse -> Onboard company...". The only way onboarding ever happens —
 * always one company, always by the exact name typed here, never automatic and never triggered
 * by the biweekly sync. See onboardCompanyByName_() in Pipeline.gs for why: a deliberate,
 * single-company action keeps a backfill's worst-case running time bounded and predictable, and
 * gives a specific reason whenever it can't proceed instead of silently skipping a company in a
 * log nobody reads.
 */
function onboardCompanyPrompt() {
  var ui = SpreadsheetApp.getUi();

  var nameResponse = ui.prompt(
    'Onboard company',
    'Type the exact company name from the Registry tab:',
    ui.ButtonSet.OK_CANCEL
  );
  if (nameResponse.getSelectedButton() !== ui.Button.OK) return;

  var companyName = nameResponse.getResponseText().trim();
  if (!companyName) return;

  var confirmResponse = ui.alert(
    'Onboard "' + companyName + '"?',
    'This proposes a metric schema and backfills its history (up to ' + MAX_BACKFILL_MONTHS +
      ' months) using the Claude API. A company with a lot of history can take a few minutes. Continue?',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirmResponse !== ui.Button.OK) return;

  try {
    var result = onboardCompanyByName_(companyName);
    ui.alert(
      'Onboarded "' + result.company + '"',
      'Tracking ' + result.metricNames.length + ' metric(s): ' + result.metricNames.join(', ') + '.\n' +
        'Backfilled ' + result.rowsWritten + ' row(s) from ' + result.emailCount + ' email(s) over the last ' +
        result.backfillMonths + ' month(s).',
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('Could not onboard "' + companyName + '"', String((err && err.message) || err), ui.ButtonSet.OK);
  }
}

/**
 * Creates (or replaces) a biweekly (every-2-weeks) time-driven trigger for runPortfolioPulse().
 * Run this once from the script editor (select installBiweeklyTrigger in the function
 * dropdown, click Run).
 *
 * This can't be set up via the Triggers page UI — its "Week timer" option only offers "every
 * week," with no every-N-weeks choice — so the convenience function is the only way to get this
 * exact cadence. See SETUP.md for why biweekly, not daily or weekly: founders sending weekly
 * updates plus a boss who won't check in that often makes daily syncing wasteful API cost for
 * no benefit, and weekly would mean the trigger's "since last run" window usually captures
 * exactly one email — biweekly gives a bit of buffer without losing anything, since
 * appendMetricRows_() in SheetsClient.gs already collapses multiple readings in the same month
 * down to the most recent one regardless of how many land in a single sync.
 */
function installBiweeklyTrigger() {
  ScriptTriggers_deleteTriggersFor_('runPortfolioPulse');
  ScriptApp.newTrigger('runPortfolioPulse')
    .timeBased()
    .everyWeeks(2)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();
  Logger.log('Biweekly trigger installed: runPortfolioPulse will run every other Monday, around 6am.');
}

function ScriptTriggers_deleteTriggersFor_(functionName) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
