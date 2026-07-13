# Portfolio Tracker — Setup Guide

Everything here mirrors the workflow map: Phase 1 (onboarding) and Phase 2 (recurring
extraction) are real, runnable code. You'll run all of it on your own machine, since it
needs your Google account and your Anthropic API key.

## File map

```
├── config/
│   ├── prompts.py          # the three prompt templates, already written
│   ├── models.py           # the one place model names live — see its docstring before touching
│   ├── json_utils.py       # shared, defensive parsing of Claude's JSON responses
│   ├── credentials.json    # Gmail OAuth client — you download this (step 2)
│   ├── service_account.json # Sheets service account key — you download this (step 3)
│   └── (token.json, last_run.json get created automatically on first run)
├── onboarding/
│   └── onboard_company.py  # run once per new company
├── extraction/
│   ├── extract_core.py     # the extraction logic — testable on its own
│   ├── gmail_client.py     # reads emails
│   ├── sheets_client.py    # reads Registry, writes Metrics
│   └── run_pipeline.py     # runs the full recurring cycle
├── requirements.txt
└── .env.example
```

## 1. Local setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Open `.env` and add your real Anthropic API key (same one from your Console org).

## 2. Gmail API access (for reading founder emails)

1. In [Google Cloud Console](https://console.cloud.google.com), pick the project you already
   use for AV work (or make a new one).
2. **APIs & Services → Library** → search "Gmail API" → Enable.
3. **APIs & Services → Credentials** → Create Credentials → OAuth client ID → Application
   type: **Desktop app**.
4. Download the JSON, rename it `credentials.json`, put it in `config/`.
5. First time you run anything that touches Gmail, a browser tab opens asking you to approve
   access — that's expected, and only happens once. It saves a `token.json` so every run
   after that is silent.

This tool only ever requests the `gmail.readonly` scope — Google's own docs are explicit that
this excludes send/modify/delete. Whoever clicks through that consent screen (you today, your
boss eventually) is granting read access only; there is no code path in here that could send or
alter anything in their inbox.

**Testing a second Google account (e.g. your boss's) without breaking the first:** don't just
rerun the login — it overwrites `token.json` in place and breaks whichever account was working
before. Since the OAuth consent screen is set to "Internal," the same `credentials.json` already
covers anyone in the AV Google Workspace — you don't need a second OAuth client, just a separate
token file so each person's login is saved independently:

```bash
GMAIL_TOKEN_PATH=config/token_boss.json python3 gmail_client.py some-address@example.com
```

Whoever is at the keyboard when that runs is the account that logs in and gets saved to
`token_boss.json` — your own `token.json` is untouched. Once it's verified working, decide
deliberately whether to point the real pipeline at the new token or keep both around.

## 3. Sheets API access (for reading Registry, writing Metrics)

1. Same Cloud Console project → **Library** → search "Google Sheets API" → Enable.
2. **Credentials** → Create Credentials → **Service account** (not OAuth client this time —
   service accounts don't need a browser popup, which matters once this runs on a schedule).
3. Open the service account → **Keys** → Add key → Create new key → JSON. Download it,
   rename it `service_account.json`, put it in `config/`.
4. Note the service account's email address (looks like
   `something@your-project.iam.gserviceaccount.com`).

If you already have a service account JSON from the job board pipeline's Sheets-writing step,
you can reuse it — just do step 4 below with that same email address.

## 4. Create the Google Sheet

Make a new Sheet with two tabs, headers exactly as shown (case-sensitive — the code reads
these by name):

**Registry tab:**
| company | sender_email | status | schema_json | priorities |
|---|---|---|---|---|

`priorities` is **mandatory**, free text — whatever you want tracked for this company, in plain
language (e.g. "ARR, active customers, and churn — ignore everything else"). It's the universal
source of truth for what this tool ever tracks: a company with no priorities set is never
onboarded, and has no data displayed on the dashboard even if it already has a schema and
history from before this rule existed. It's read once at onboarding to choose the metrics
(never re-sent on every sync), but its presence is checked every time the dashboard data gets
rebuilt — blank it out later and that company's data stops showing until it's filled in again.

**Metrics tab:**
| company | period | metric | value | unit |
|---|---|---|---|---|

Share the Sheet with your service account's email address (from step 3.4) as an **Editor**.
Grab the spreadsheet ID from the URL — the long string between `/d/` and `/edit` — and put
it in `.env` as `SPREADSHEET_ID`.

## 5. Add a company and run it

Add a row to the Registry tab by hand: company name, sender email, `status = Active`, and
`priorities` — required, the pipeline refuses to onboard a company without it. Leave
`schema_json` blank — the pipeline notices and onboards it automatically on the next run,
pulling a real sample straight from Gmail (no sample file needed). Then just run the real thing:

```bash
cd extraction
python3 run_pipeline.py <your-spreadsheet-id>
```

This does everything: onboards any company missing a schema (at most 5 metrics, chosen by
Claude from the sample email plus your stated priorities), syncs new emails, extracts values
for exactly those metrics, and refreshes `dashboard/data.json`.

## 6. View the dashboard

```bash
cd dashboard
python3 -m http.server 8765
```

Open `http://localhost:8765` — it reads `data.json`, which `run_pipeline.py` keeps fresh. Each
company gets up to 5 cards (its most important metrics), with a chart always visible below them
— no click needed to see a trend. Clicking a different card swaps which metric the chart shows;
a toggle switches the chart between month-by-month (with a year picker) and year-over-year
views. There's deliberately no "everything else" table — this tool tracks a small, chosen set
of numbers, not everything a founder's email happens to state.

## 7. Later: scheduling

Once this works end to end manually, `run_pipeline.py <spreadsheet_id>` is the one command a
cron job needs to call on a schedule — same shape as the job board droplet cron, just this
script instead.

## 8. Possible future work

`GMAIL_LOOKUP_SKILL_SPEC.md` in the repo root is a design spec (not built) for a smaller,
on-demand companion tool — answering ad hoc questions like "show me updates from Carpool for
the last 4 months" directly in chat, without the scheduling or persistent-Sheet parts of this
pipeline. Not started; read that file before building it.
