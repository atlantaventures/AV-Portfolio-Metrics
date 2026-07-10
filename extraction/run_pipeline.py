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
from sheets_client import (
    get_active_companies,
    append_metric_rows,
    append_review_rows,
    REVIEW_TAB,
    get_companies_needing_onboarding,
    update_company_schema,
)
from extract_core import extract_metrics, rows_for_sheet
from triage_new_metrics import triage_metric, review_row_for_sheet
from relevance_filter import should_extract

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "dashboard"))
from build_data import build as build_dashboard_data, DATA_PATH as DASHBOARD_DATA_PATH  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "onboarding"))
from onboard_company import propose_schema_from_sender  # noqa: E402

STATE_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "last_run.json")
LOOKBACK_DAYS_IF_FIRST_RUN = 180  # ~6 months — a new company's starting point, not "get everything ever"


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

    pending_onboarding = get_companies_needing_onboarding(spreadsheet_id)
    freshly_onboarded = set()
    for company in pending_onboarding:
        print(f"  {company['company']}: no schema yet — pulling their most recent email to propose one...")
        try:
            schema = propose_schema_from_sender(company["sender_email"], subject_hint=company["company"])
        except ValueError as e:
            print(f"    Skipped: {e}")
            continue
        update_company_schema(spreadsheet_id, company["company"], schema)
        freshly_onboarded.add(company["company"])
        print(f"    Onboarded with {len(schema)} metric(s): {list(schema.keys())}")

    companies = get_active_companies(spreadsheet_id)
    print(f"Checking {len(companies)} active company(ies) for updates since {since}...")

    total_rows_written = 0
    review_rows = []
    for company in companies:
        # A company onboarded just now has never been synced — give it its own fresh
        # lookback rather than the shared `since`, or its real backfill silently gets skipped.
        company_since = (
            datetime.now() - timedelta(days=LOOKBACK_DAYS_IF_FIRST_RUN)
            if company["company"] in freshly_onboarded
            else since
        )
        emails = fetch_new_emails(company["sender_email"], company_since, subject_hint=company["company"])
        if not emails:
            print(f"  {company['company']}: no new emails")
            continue

        for email in emails:
            if not should_extract(email["subject"], email["body"]):
                print(f"  {company['company']}: skipped '{email['subject']}' (not a performance update)")
                continue

            result = extract_metrics(email["body"], company["schema"], email_date=email["date"])
            rows = rows_for_sheet(company["company"], result)
            append_metric_rows(spreadsheet_id, rows)
            total_rows_written += len(rows)

            new_metrics = [m for m in result.get("metrics", []) if m.get("is_new_metric")]
            for m in new_metrics:
                proposal = triage_metric(company["schema"], m)
                review_rows.append(review_row_for_sheet(company["company"], result.get("period", "unknown"), m, proposal))

            note = f" (new metric(s) seen: {[m['metric'] for m in new_metrics]})" if new_metrics else ""
            print(f"  {company['company']}: extracted {len(rows)} metric(s) from '{email['subject']}'{note}")

    if review_rows:
        append_review_rows(spreadsheet_id, review_rows)
        print(f"{len(review_rows)} new metric(s) sent to the '{REVIEW_TAB}' tab for review.")

    dashboard_data = build_dashboard_data(spreadsheet_id)
    with open(DASHBOARD_DATA_PATH, "w") as f:
        json.dump(dashboard_data, f, indent=2)
    print(f"Dashboard data refreshed ({len(dashboard_data['rows'])} row(s)).")

    _save_last_run(run_started_at)
    print(f"\nDone. {total_rows_written} row(s) written to the Metrics tab.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python run_pipeline.py <spreadsheet_id>")
        sys.exit(1)
    run(sys.argv[1])
