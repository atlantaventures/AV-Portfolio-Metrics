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
REVIEW_TAB = "Pending Review"
REVIEW_HEADER = [
    "company", "period", "metric", "value", "unit",
    "is_duplicate", "matches_metric", "confidence", "reasoning",
    "proposed_category", "proposed_good_direction", "proposed_label", "status",
]


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
        if str(row.get("status", "")).strip().lower() == "active" and str(row.get("schema_json", "")).strip():
            active.append({
                "company": row["company"],
                "sender_email": row["sender_email"],
                "schema": json.loads(row["schema_json"]),
            })
    return active


def get_companies_needing_onboarding(spreadsheet_id: str) -> list[dict]:
    """
    Reads the Registry tab. Returns Active rows whose schema_json is still blank — these are
    companies waiting on their first (automatic) schema proposal before extraction can run.
    """
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(REGISTRY_TAB)
    rows = sheet.get_all_records()
    return [
        {"company": row["company"], "sender_email": row["sender_email"]}
        for row in rows
        if str(row.get("status", "")).strip().lower() == "active" and not str(row.get("schema_json", "")).strip()
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


def append_review_rows(spreadsheet_id: str, rows: list[list]) -> None:
    """
    rows match REVIEW_HEADER's column order. Creates the "Pending Review" tab with a header
    row if it doesn't exist yet — this is the surface a human reviews before anything gets merged.
    """
    if not rows:
        return
    spreadsheet = _get_client().open_by_key(spreadsheet_id)
    try:
        sheet = spreadsheet.worksheet(REVIEW_TAB)
    except gspread.WorksheetNotFound:
        sheet = spreadsheet.add_worksheet(title=REVIEW_TAB, rows=1, cols=len(REVIEW_HEADER))
        sheet.append_row(REVIEW_HEADER)
    sheet.append_rows(rows, value_input_option="USER_ENTERED")


def get_reviews_by_status(spreadsheet_id: str, status: str) -> list[dict]:
    """Reads the Pending Review tab, returning rows (as dicts keyed by REVIEW_HEADER) matching status."""
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(REVIEW_TAB)
    all_rows = sheet.get_all_records()
    matches = []
    for i, row in enumerate(all_rows):
        if row.get("status") == status:
            row["_row_number"] = i + 2  # +1 for header, +1 for 1-indexing
            matches.append(row)
    return matches


def set_review_status(spreadsheet_id: str, row_number: int, status: str) -> None:
    """row_number is the 1-indexed sheet row, e.g. from get_reviews_by_status's "_row_number"."""
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(REVIEW_TAB)
    status_col = REVIEW_HEADER.index("status") + 1
    sheet.update_cell(row_number, status_col, status)


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


def relabel_metric_rows(spreadsheet_id: str, company: str, old_metric: str, new_metric: str) -> int:
    """
    Rewrites every Metrics-tab row for this company under old_metric to new_metric — used when a
    human approves a merge, so the metric's full history lands under one name instead of splitting.
    Returns the number of rows relabeled.
    """
    sheet = _get_client().open_by_key(spreadsheet_id).worksheet(METRICS_TAB)
    all_rows = sheet.get_all_records()
    header = sheet.row_values(1)
    metric_col = header.index("metric") + 1
    relabeled = 0
    for i, row in enumerate(all_rows):
        if row.get("company") == company and row.get("metric") == old_metric:
            sheet.update_cell(i + 2, metric_col, new_metric)
            relabeled += 1
    return relabeled


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
