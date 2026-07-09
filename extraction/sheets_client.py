"""
Google Sheets integration — this is the same pattern (gspread + a service account) you likely
already used for the job board pipeline's Sheet-writing step. If you have that service account
JSON already, you can reuse it here — just share this new Sheet with its email address too.

RUN THIS ON YOUR OWN MACHINE, same reason as gmail_client.py.
"""

import os
import gspread
from google.oauth2.service_account import Credentials

SERVICE_ACCOUNT_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "service_account.json")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

REGISTRY_TAB = "Registry"
METRICS_TAB = "Metrics"


def _get_client():
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_PATH, scopes=SCOPES)
    return gspread.authorize(creds)


def get_active_companies(spreadsheet_id: str) -> list[dict]:
    """
    Reads the Registry tab. Returns rows where status == "Active", each as:
        {"company": ..., "sender_email": ..., "schema": {...}}
    """
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(REGISTRY_TAB)
    rows = sheet.get_all_records()  # list of dicts, keyed by header row

    active = []
    for row in rows:
        if row.get("status") == "Active":
            import json
            active.append({
                "company": row["company"],
                "sender_email": row["sender_email"],
                "schema": json.loads(row["schema_json"]),
            })
    return active


def append_metric_rows(spreadsheet_id: str, rows: list[list]) -> None:
    """rows are [company, period, metric, value, unit] — matches the Metrics tab column order."""
    if not rows:
        return
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(METRICS_TAB)
    sheet.append_rows(rows, value_input_option="USER_ENTERED")


if __name__ == "__main__":
    # Quick manual test: python sheets_client.py <spreadsheet_id>
    import sys
    if len(sys.argv) != 2:
        print("Usage: python sheets_client.py <spreadsheet_id>")
        sys.exit(1)
    companies = get_active_companies(sys.argv[1])
    print(f"Found {len(companies)} active company(ies):")
    for c in companies:
        print(f"  - {c['company']} ({c['sender_email']}) — {list(c['schema'].get('metrics', {}).keys())}")
