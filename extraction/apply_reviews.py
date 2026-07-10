"""
Applies human-approved rows from the "Pending Review" tab — the one write step in this whole
pipeline that changes a company's schema or rewrites metric history, so it's deliberately its own
script, run by hand, never on the automatic schedule.

Workflow:
    1. run_pipeline.py flags new metrics and writes triage proposals to "Pending Review" (status: Pending).
    2. A human reads each row and changes its status cell to "Approved" or "Rejected" in the Sheet, by hand.
    3. Run this script. For every "Approved" row it either:
         - merges: adds the founder's phrase as an alias on the matched metric, and relabels every
           existing Metrics row for this company from the new metric name to the matched one, or
         - adds: adds a new schema_json entry with the proposed category/label.
       Then marks the row "Applied" so re-running this script never double-processes it.

Usage:
    python apply_reviews.py <spreadsheet_id>
"""

import sys
from sheets_client import (
    get_active_companies,
    get_reviews_by_status,
    set_review_status,
    update_company_schema,
    relabel_metric_rows,
)


def apply(spreadsheet_id: str) -> None:
    approved = get_reviews_by_status(spreadsheet_id, "Approved")
    if not approved:
        print("No approved reviews to apply.")
        return

    companies_by_name = {c["company"]: c for c in get_active_companies(spreadsheet_id)}

    for row in approved:
        company_name = row["company"]
        company = companies_by_name.get(company_name)
        if not company:
            print(f"  Skipping '{row['metric']}' for {company_name}: company not found in Registry.")
            continue

        schema = company["schema"]
        is_duplicate = str(row.get("is_duplicate")).strip().lower() in ("true", "1", "yes")

        if is_duplicate:
            target = row["matches_metric"]
            if target not in schema:
                print(f"  Skipping '{row['metric']}' for {company_name}: matched metric '{target}' not in schema.")
                continue
            aliases = schema[target].setdefault("aliases", [])
            if isinstance(aliases, str):  # some existing schema rows store aliases as a plain string
                aliases = [aliases]
            if row["metric"] not in aliases:
                aliases.append(row["metric"])
            schema[target]["aliases"] = aliases
            relabeled = relabel_metric_rows(spreadsheet_id, company_name, row["metric"], target)
            print(f"  {company_name}: merged '{row['metric']}' into '{target}' ({relabeled} row(s) relabeled).")
        else:
            schema[row["metric"]] = {
                "unit": row["unit"],
                "aliases": [],
                "category": row.get("proposed_category") or "other",
                "good_direction": row.get("proposed_good_direction") or "up",
            }
            print(f"  {company_name}: added '{row['metric']}' as a new metric (category: {schema[row['metric']]['category']}).")

        update_company_schema(spreadsheet_id, company_name, schema)
        set_review_status(spreadsheet_id, row["_row_number"], "Applied")

    print(f"\nDone. {len(approved)} approved review(s) applied.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python apply_reviews.py <spreadsheet_id>")
        sys.exit(1)
    apply(sys.argv[1])
