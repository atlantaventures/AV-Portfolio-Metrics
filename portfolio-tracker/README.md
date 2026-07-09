# Portfolio Tracker — Setup Guide

Everything here mirrors the workflow map: Phase 1 (onboarding) and Phase 2 (recurring
extraction) are real, runnable code. You'll run all of it on your own machine, since it
needs your Google account and your Anthropic API key.

## File map

```
portfolio-tracker/
├── config/
│   ├── prompts.py          # the two prompt templates, already written
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
cd portfolio-tracker
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
| company | sender_email | status | schema_json |
|---|---|---|---|

**Metrics tab:**
| company | period | metric | value | unit |
|---|---|---|---|---|

Share the Sheet with your service account's email address (from step 3.4) as an **Editor**.
Grab the spreadsheet ID from the URL — the long string between `/d/` and `/edit` — and put
it in `.env` as `SPREADSHEET_ID`.

## 5. Test each piece on its own

```bash
# Onboarding — proposes a schema from a sample email
cd onboarding
python3 onboard_company.py path/to/a/real/sample_email.txt

# Gmail connection — lists recent emails from a sender (triggers the one-time browser auth)
cd ../extraction
python3 gmail_client.py founder@example.com

# Sheets connection — lists active companies from your Registry tab
python3 sheets_client.py <your-spreadsheet-id>
```

If all three work, add your first company to the Registry tab by hand (status = "Active",
schema_json = whatever the onboarding script printed) and run the real thing:

```bash
python3 run_pipeline.py <your-spreadsheet-id>
```

## 6. Connect Data Studio

Point Data Studio at the same Sheet, using the Metrics tab as the data source. Build the
company + metric filter controls as discussed — nothing in this repo touches that part, it's
pure point-and-click once the Metrics tab has real rows in it.

## 7. Later: scheduling

Once this works end to end manually, `run_pipeline.py <spreadsheet_id>` is the one command a
cron job needs to call on a schedule — same shape as the job board droplet cron, just this
script instead.
