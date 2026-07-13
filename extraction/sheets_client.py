"""
Google Sheets integration — this is the same pattern (gspread + a service account) you likely
already used for the job board pipeline's Sheet-writing step. If you have that service account
JSON already, you can reuse it here — just share this new Sheet with its email address too.

RUN THIS ON YOUR OWN MACHINE, same reason as gmail_client.py.
"""

import json
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
    Reads the Registry tab. Returns rows where status == "Active" AND priorities is filled in
    (priorities is the universal source of truth — a company with no stated priorities has no
    data displayed, even if it happens to already have a schema from before this was enforced).
    Each as: {"company": ..., "sender_email": ..., "schema": {...}}
    """
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(REGISTRY_TAB)
    rows = sheet.get_all_records()  # list of dicts, keyed by header row

    active = []
    for row in rows:
        if (
            str(row.get("status", "")).strip().lower() == "active"
            and str(row.get("schema_json", "")).strip()
            and str(row.get("priorities", "")).strip()
        ):
            # A hand-edit gone wrong (a typo, Sheets auto-converting straight quotes to "smart"
            # quotes) shouldn't take down every other company's sync — skip just this one row.
            try:
                schema = json.loads(row["schema_json"])
            except json.JSONDecodeError as e:
                print(f"  WARNING: {row['company']}'s schema_json is malformed JSON ({e}) — skipping this company.")
                continue
            active.append({
                "company": row["company"],
                "sender_email": row["sender_email"],
                "schema": schema,
            })
    return active


def get_companies_needing_onboarding(spreadsheet_id: str) -> list[dict]:
    """
    Reads the Registry tab. Returns Active rows with priorities set but schema_json still
    blank — these are ready for their first (automatic) schema proposal. Active rows with
    priorities still blank are NOT included here (see get_companies_waiting_on_priorities) —
    priorities is mandatory, so onboarding never runs without it.
    """
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(REGISTRY_TAB)
    rows = sheet.get_all_records()
    return [
        {
            "company": row["company"],
            "sender_email": row["sender_email"],
            "priorities": row["priorities"],
        }
        for row in rows
        if str(row.get("status", "")).strip().lower() == "active"
        and not str(row.get("schema_json", "")).strip()
        and str(row.get("priorities", "")).strip()
    ]


def get_companies_waiting_on_priorities(spreadsheet_id: str) -> list[str]:
    """Active companies with no schema yet AND no priorities set — stuck until a human fills it in."""
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(REGISTRY_TAB)
    rows = sheet.get_all_records()
    return [
        row["company"]
        for row in rows
        if str(row.get("status", "")).strip().lower() == "active"
        and not str(row.get("schema_json", "")).strip()
        and not str(row.get("priorities", "")).strip()
    ]


def append_metric_rows(spreadsheet_id: str, rows: list[list]) -> None:
    """rows are [company, period, metric, value, unit] — matches the Metrics tab column order."""
    if not rows:
        return
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(METRICS_TAB)
    sheet.append_rows(rows, value_input_option="USER_ENTERED")


def get_all_metric_rows(spreadsheet_id: str) -> list[dict]:
    """Reads every row of the Metrics tab, each as {"company", "period", "metric", "value", "unit"}."""
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(METRICS_TAB)
    return sheet.get_all_records()


def update_company_schema(spreadsheet_id: str, company: str, schema: dict) -> None:
    """Overwrites a company's schema_json cell in the Registry tab."""
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(REGISTRY_TAB)
    all_rows = sheet.get_all_records()
    header = sheet.row_values(1)
    schema_col = header.index("schema_json") + 1
    for i, row in enumerate(all_rows):
        if row.get("company") == company:
            sheet.update_cell(i + 2, schema_col, json.dumps(schema))
            return
    raise ValueError(f"No Registry row found for company '{company}'")


if __name__ == "__main__":
    # Quick manual test: python sheets_client.py <spreadsheet_id>
    import sys
    if len(sys.argv) != 2:
        print("Usage: python sheets_client.py <spreadsheet_id>")
        sys.exit(1)
    companies = get_active_companies(sys.argv[1])
    print(f"Found {len(companies)} active company(ies):")
    for c in companies:
        print(f"  - {c['company']} ({c['sender_email']}) — {list(c['schema'].keys())}")
