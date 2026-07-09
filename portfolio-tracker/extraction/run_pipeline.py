"""
The recurring pipeline — this is Phase 2 from the workflow map, run as one script.

For each active company in the Registry:
    1. Fetch new emails since the last run.
    2. Extract metrics from each, using that company's schema.
    3. Append the resulting rows to the Metrics tab.

Run manually while testing:
    python run_pipeline.py <spreadsheet_id>

Later, this is the one script a cron job calls on a schedule — same pattern as the job board
pipeline's droplet cron, just a different script.
"""

import json
import os
import sys
from datetime import datetime, timedelta

from gmail_client import fetch_new_emails
from sheets_client import get_active_companies, append_metric_rows
from extract_core import extract_metrics, rows_for_sheet

STATE_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "last_run.json")
LOOKBACK_DAYS_IF_FIRST_RUN = 30


def _get_last_run() -> datetime:
    if os.path.exists(STATE_PATH):
        with open(STATE_PATH) as f:
            return datetime.fromisoformat(json.load(f)["last_run"])
    return datetime.now() - timedelta(days=LOOKBACK_DAYS_IF_FIRST_RUN)


def _save_last_run(ts: datetime) -> None:
    with open(STATE_PATH, "w") as f:
        json.dump({"last_run": ts.isoformat()}, f)


def run(spreadsheet_id: str) -> None:
    since = _get_last_run()
    run_started_at = datetime.now()

    companies = get_active_companies(spreadsheet_id)
    print(f"Checking {len(companies)} active company(ies) for updates since {since}...")

    total_rows_written = 0
    for company in companies:
        emails = fetch_new_emails(company["sender_email"], since)
        if not emails:
            print(f"  {company['company']}: no new emails")
            continue

        for email in emails:
            result = extract_metrics(email["body"], company["schema"])
            rows = rows_for_sheet(company["company"], result)
            append_metric_rows(spreadsheet_id, rows)
            total_rows_written += len(rows)
            new_metrics = [m["metric"] for m in result.get("metrics", []) if m.get("is_new_metric")]
            note = f" (new metric(s) seen: {new_metrics})" if new_metrics else ""
            print(f"  {company['company']}: extracted {len(rows)} metric(s) from '{email['subject']}'{note}")

    _save_last_run(run_started_at)
    print(f"\nDone. {total_rows_written} row(s) written to the Metrics tab.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python run_pipeline.py <spreadsheet_id>")
        sys.exit(1)
    run(sys.argv[1])
