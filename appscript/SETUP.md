# Portfolio Pulse — Google Apps Script Setup

This is the Google Sheets–native version of the portfolio tracker. Everything runs inside the
Sheet itself — no Python install, no `venv`, no `credentials.json`/`service_account.json` files
to keep track of, no laptop that has to stay on for a cron job to fire. If you can open a Google
Sheet, you can run this.

It reads and writes the **same Registry and Metrics tabs** the Python pipeline uses today. Both
versions can run side by side — see the note at the end about eventually retiring the Python one.

## What you're setting up

- **Registry tab** — same columns as today (`company`, `sender_email`, `status`, `schema_json`,
  `priorities`), plus one new optional column: `backfill_months`.
- **Metrics tab** — same columns as today (`company`, `period`, `metric`, `value`, `unit`), plus
  two new optional columns: `source_email_subject`, `source_email_date`.
- **Meta tab** — new. A "Last synced: ..." cell, so anyone can open the Sheet and see when it
  last ran without touching the script editor, plus a small table refreshed on every rebuild
  showing each active company's latest primary-revenue reading (metric, period, value) — see
  `updateMetaSummaryTable_()` in `Dashboard.gs`.
- **One tab per company** — new, auto-generated. Each active company gets its own tab (named
  after the company) with a data table and charts — see step 8.

## 1. Open the script editor and paste in the code

1. Open the real Google Sheet (the one with your Registry and Metrics tabs).
2. **Extensions → Apps Script**. This opens a script project already bound to this specific
   Sheet — nothing here can accidentally touch a different spreadsheet.
3. You'll see a default `Code.gs` file with an empty `myFunction()` in it. Delete that.
4. For each file in this `appscript/` folder (`Code.gs`, `Models.gs`, `Prompts.gs`, `Utils.gs`,
   `JsonUtils.gs`, `ClaudeClient.gs`, `GmailClient.gs`, `SheetsClient.gs`, `RelevanceFilter.gs`,
   `Extraction.gs`, `Onboarding.gs`, `Pipeline.gs`, `Dashboard.gs`): click the **+** next to
   "Files" in the script editor, choose **Script**, name it exactly the same (without the
   `.gs` — Apps Script adds that itself), and paste in the matching file's contents.
5. Open **appsscript.json** in the script editor (click the gear icon → "Show `appsscript.json`
   manifest file" if it isn't already visible in the file list) and replace its contents with
   this project's `appsscript.json`. This is what declares the scopes below up front — Gmail
   read-only, Sheets (this spreadsheet only), external requests (for the Claude API call), and
   script triggers.
6. **File → Save** (or Ctrl/Cmd+S).

## 2. What each file does

| File | Same as (Python) | Purpose |
|---|---|---|
| `Models.gs` | `config/models.py` | The three pinned Claude model IDs |
| `Prompts.gs` | `config/prompts.py` | The three prompt templates, ported verbatim |
| `Utils.gs` | — | Template substitution + date-math helpers |
| `JsonUtils.gs` | `config/json_utils.py` | Defensive parsing of Claude's JSON responses |
| `ClaudeClient.gs` | the `anthropic` SDK calls | Raw `UrlFetchApp` call to the Messages API |
| `GmailClient.gs` | `extraction/gmail_client.py` | Subject-query building, email fetching |
| `SheetsClient.gs` | `extraction/sheets_client.py` | Registry/Metrics/Meta tab reads & writes |
| `RelevanceFilter.gs` | `extraction/relevance_filter.py` | Keyword fast-path + Claude relevance check |
| `Extraction.gs` | `extraction/extract_core.py` | Pulls metric values out of one email |
| `Onboarding.gs` | `onboarding/onboard_company.py` | Proposes a schema for a new company |
| `Pipeline.gs` | `extraction/run_pipeline.py` | The two-pass run — see "How it runs" below |
| `Dashboard.gs` | `dashboard/build_data.py` + `index.html` | Builds each company's tab — table, slicer, charts |
| `Code.gs` | — | Custom Sheet menu, optional trigger installer |

## 3. Set your Anthropic API key

The key never goes in a source file (it would be visible to anyone with edit access to the
script, and could get pasted into a copy of the Sheet by accident):

1. In the script editor, click the gear icon (**Project Settings**) in the left sidebar.
2. Scroll to **Script Properties → Add script property**.
3. Property: `ANTHROPIC_API_KEY`. Value: your real key (same one from the Console org the
   Python `.env` file used).
4. Save.

**Same place, optional: overriding a model.** `Models.gs` hardcodes a default model per job
(relevance filter, extraction, onboarding), but if Anthropic ever retires one of those snapshots,
you don't need to edit code and redeploy — add a Script Property named `RELEVANCE_MODEL`,
`EXTRACTION_MODEL`, or `ONBOARDING_MODEL` (same screen as above) with the new model ID, and that
job picks it up on its next run. Leave them unset to keep using the built-in defaults.

## 4. Authorize Gmail and Sheets access (one click, once)

1. Back in the script editor, pick any function in the dropdown next to the "Run" button —
   `syncNow` is a safe one to use for this first run — and click **Run**. (Don't use
   `onboardCompanyPrompt` for this step — it shows a dialog box, which only works when clicked
   from the Sheet's own menu, not from the script editor's Run button.)
2. A dialog will ask you to authorize. Click through **Review permissions → (pick your account)
   → Advanced → Go to (project name) (unsafe)** — this "unsafe" warning is Google's standard
   language for any script that hasn't been through their public verification process; it
   doesn't mean anything is actually wrong. It's expected for a private script like this one.
3. You'll see the exact scopes it's requesting, matching `appsscript.json`:
   - **Read your email messages and settings** — this is `gmail.readonly` specifically. Per
     Google's own Gmail API scope docs, this explicitly excludes send/modify/delete. There is no
     code path anywhere in this project that could send or alter anything in your inbox.
   - **See, edit, create, and delete your spreadsheets** — scoped to `spreadsheets.currentonly`,
     meaning only *this* Sheet, not every Sheet in your Drive.
   - **Connect to an external service** — this is what lets `ClaudeClient.gs` call the Anthropic
     API via `UrlFetchApp`.
   - **Manage your triggers** — needed for the `installWeeklyTrigger()` function in step 6.
4. Click **Allow**. This happens once per person who runs the script (same idea as the Python
   version's `token.json` — except here Google manages that state for you, there's no file to
   copy around).

## 5. Add the Registry columns and a company

If you're pointing this at the same Sheet the Python pipeline already uses, the Registry tab
already has the right columns — you only need to add one:

1. Add a `backfill_months` column to the Registry tab (any position, but the far right is
   simplest). Leave it blank for any company that should use the default (24 months back on
   first onboarding); fill in a number to override per-company.
2. Add two columns to the Metrics tab, `source_email_subject` and `source_email_date` — any
   position, any order, the code looks them up by header name (far right is simplest, but it
   genuinely doesn't matter). Every row written from now on carries the subject and date of the
   actual email it was extracted from, so if a number ever looks wrong you can find the exact
   email it came from instead of guessing. Existing rows just stay blank in these two columns —
   nothing needs to be backfilled, and leaving these columns off the sheet entirely doesn't break
   anything either.
3. To add a brand-new company: add a row with `company`, `sender_email`, `status = Active`, and
   `priorities` (required — same rule as the Python version, the pipeline refuses to onboard a
   company with no stated priorities). Leave `schema_json` blank. Nothing happens automatically
   from here — see step 7 for onboarding it.

## 6. Set up the scheduled run

**Recommended cadence: weekly, not daily.** Founders report on a weekly cadence, and each
Metrics row is keyed to the actual reporting period a founder used — a week-start date for a
weekly reporter, "YYYY-MM" for a monthly one (see EXTRACTION_PROMPT in `Prompts.gs`) — so a
weekly sync keeps pace with the data without missing anything. Daily buys nothing beyond that:
just extra Gmail-search-and-Claude-API cost checking for emails that mostly aren't there yet.

1. In the script editor, pick `installWeeklyTrigger` from the function dropdown.
2. Click **Run**. You'll see the same one-time authorization dialog from step 4 if you haven't
   already granted access.
3. Done — this creates a trigger that fires every Monday around 6am. Running it again later
   (e.g. to change the day/hour, or just to confirm it's still there) replaces the old one
   cleanly rather than creating a duplicate.

You can see (and delete, or change) the resulting trigger afterward from the clock icon
(**Triggers**) in the left sidebar. `installWeeklyTrigger` is just a convenience wrapper — the
same cadence can be set up directly from the Triggers page's **+ Add Trigger** → Function:
`runPortfolioPulse` → Time-driven → **Week timer**, no code required; the only reason to prefer
the function is that it deletes any old `runPortfolioPulse` trigger first, so you don't end up
with two firing side by side.

Whatever cadence you pick, `runPortfolioPulse` is the function that should run on it. It only
ever syncs already-onboarded companies — it never onboards anything, no matter how many Registry
rows are sitting with a blank `schema_json`. Onboarding is a separate, deliberate, one-at-a-time
action — see step 7.

## 7. The custom menu

Reload the Sheet (or wait a few seconds after the first authorization) and you'll see a
**Portfolio Pulse** menu next to Extensions:

- **Sync now** — incremental sync for every already-onboarded company immediately. Useful right
  after a new update email you don't want to wait for the scheduled trigger to pick up.
- **Onboard company...** — the only way a company gets onboarded. Click it, type the exact
  company name from the Registry tab, confirm, and it proposes a schema and backfills that one
  company's history (up to `backfill_months`, capped at 24). It refuses, with a specific reason
  shown in a dialog, if: the name doesn't match any Registry row, the name matches more than one
  row, the row isn't `status = Active`, `priorities` is blank, or the row already has a
  `schema_json` (onboarding only ever runs once per company — to redo it, clear that row's
  `schema_json` cell first, then onboard it again).
- **Rebuild dashboard** — regenerates every company's tab (table, slicer, charts) from whatever's
  in the Sheet right now, without touching Gmail or Claude at all. `runPortfolioPulse` and
  "Onboard company..." both already call this automatically when they finish — reach for this
  one directly if you've been fiddling with a company's tab by hand and want it rebuilt without
  waiting for a full sync.

None of these require opening the script editor — this is what lets a non-technical person add a
Registry row and onboard it on the spot.

## 8. The per-company tabs

Every active company gets its own tab (named after the company), built and rebuilt
automatically — you don't create these by hand. Each one has:

- **A visible data table** — Period down the rows, one column per metric, so you can read exact
  values directly instead of hovering over a chart point. Numbers are formatted per the metric's
  unit (`$1,200,000`, `12.5%`, `5,400`) — never scientific notation.
- **A "Filter by period" slicer** next to the table. Google Sheets applies a slicer's filtering
  to any chart sourced from the same range, so narrowing the slicer narrows the table *and* every
  chart on that tab together — this is the filtering that was missing before.
- **Large-move highlighting.** Any period-over-period change of 20% or more (up or down) is
  shaded directly in the table, with a one-line summary above it (e.g. "⚠ Large moves (20%+):
  ARR -22% (2026-02 → 2026-03)") — so a real swing gets noticed without having to scan every
  cell. The 20% threshold is `EXTREME_MOVE_THRESHOLD` in `Dashboard.gs` if you want it tighter or
  looser.
- **One line chart per metric**, stacked vertically below the table, each a fixed size with a
  fixed gap between them so they never overlap regardless of row heights or zoom level. Each
  chart's vertical axis uses Google Charts' `format: 'short'` option, which renders large values
  as `1M` / `300K` instead of the `1.0E+06` scientific notation from before.
- Companies that go inactive (or get removed from the Registry) have their tab automatically
  deleted on the next rebuild — the script tags every tab it creates so it only ever removes
  tabs it made itself, never a tab you added by hand.

**One thing still not scriptable: Scorecard cards.** Apps Script's chart-building API
(`Charts.ChartType`) has no `SCORECARD` type as of this writing, so the big single-number-with-
trend tiles aren't created automatically. Add one by hand, per company tab, if you want it:

1. On that company's tab, pick an empty area below or beside the charts.
2. **Insert → Chart**.
3. In the chart editor's setup panel, change the chart type to **Scorecard chart**.
4. Set its data range to the metric column you want (e.g. the `monthly_revenue` column in that
   tab's data table) — pick the most recent row, or the whole column for a compare-to-previous
   card.
5. Repeat for however many hero metrics you want as cards. This is a one-time setup per metric —
   the underlying data keeps updating on its own; you'd only redo this if a company's schema
   changes or you want a card for a newly onboarded company.

**If you're upgrading from an earlier version of this project** that had one shared "Dashboard"
tab: that tab is no longer created or updated. If you'd already added manual Scorecard cards to
it, they're untouched (the rebuild never deletes a tab it doesn't recognize as its own) — move
them onto the relevant company's new tab, or leave the old one around, and delete it yourself
whenever it's convenient.

## 9. Later: retiring the Python pipeline

Don't do this yet. Once the Apps Script version above has been running for a while side by side
with the Python one and you've confirmed the Metrics tab is getting the same rows from both
(same companies, same periods, same values), retiring the Python pipeline is just:

1. Stop whatever cron job (or manual habit) calls `run_pipeline.py`.
2. Optionally remove `config/credentials.json`, `config/service_account.json`, `config/token.json`,
   and the `.env` file — nothing in the Apps Script version reads any of them.
3. Keep the Python source files around for a while as reference even after you stop running
   them — don't delete `extraction/`, `onboarding/`, or `config/*.py` outright until you're sure
   you won't want to diff prompt wording or logic against them again.

This is intentionally not automated — it's a deliberate decision to make once you trust the new
version, not a step this migration performs for you.
