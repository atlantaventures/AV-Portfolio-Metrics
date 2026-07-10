"""
Regenerates dashboard/data.json from the live Google Sheet — this is what makes the dashboard
dynamic. index.html never talks to the Sheet directly; it only ever fetches this local JSON file,
so nothing in the browser code needs to change. Run this after run_pipeline.py (or chained onto
the end of it) so every sync refreshes what the dashboard shows.

Usage:
    python build_data.py <spreadsheet_id>
"""

import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extraction"))
from sheets_client import get_active_companies, get_all_metric_rows  # noqa: E402

DATA_PATH = os.path.join(os.path.dirname(__file__), "data.json")


def build(spreadsheet_id: str) -> dict:
    companies = get_active_companies(spreadsheet_id)

    categories = {}
    good_direction = {}
    for company in companies:
        metrics = company["schema"]
        categories[company["company"]] = {
            name: info.get("category", "other") for name, info in metrics.items()
        }
        for name, info in metrics.items():
            if info.get("good_direction", "up") == "down":
                good_direction[name] = "down"

    rows = [
        {
            "company": row["company"],
            "period": row["period"],
            "metric": row["metric"],
            "value": row["value"],
            "unit": row["unit"],
        }
        for row in get_all_metric_rows(spreadsheet_id)
    ]

    return {
        "lastSynced": datetime.now().strftime("%Y-%m-%d"),
        "categories": categories,
        "goodDirection": good_direction,
        "rows": rows,
    }


def main():
    if len(sys.argv) != 2:
        print("Usage: python build_data.py <spreadsheet_id>")
        sys.exit(1)

    data = build(sys.argv[1])
    with open(DATA_PATH, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Wrote {len(data['rows'])} row(s) across {len(data['categories'])} company(ies) to {DATA_PATH}")


if __name__ == "__main__":
    main()
