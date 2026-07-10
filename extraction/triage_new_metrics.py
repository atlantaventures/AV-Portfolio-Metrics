"""
Triage for metrics extraction flags as new — catches the case where a founder just used different
wording for a metric that's already tracked (e.g. "money earned this year" vs. an existing
"annual_run_rate"), instead of quietly splitting one metric's history across two names.

Deliberately separate from Gmail/Sheets plumbing, same reason as extract_core.py: give it a
company's schema + one new metric, get back a proposal. A human still approves every proposal —
see apply_reviews.py — this only ever proposes, never merges on its own.
"""

import json
import os
import sys
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "config"))
from prompts import TRIAGE_PROMPT, CATEGORY_GUIDE, GOOD_DIRECTION_GUIDE  # noqa: E402
from json_utils import parse_json_response  # noqa: E402

client = Anthropic()


def triage_metric(schema: dict, metric: dict) -> dict:
    """
    schema: this company's schema_json (existing metric names -> {unit, aliases, category}).
    metric: one row from an extraction result, e.g. {"metric": "money_earned_this_year", "value": 1820000, "unit": "USD"}.

    Returns:
        {
          "is_duplicate": false,
          "matches_metric": null,
          "confidence": "high",
          "reasoning": "...",
          "proposed_category": "other",
          "proposed_label": "Money Earned This Year"
        }
    """
    prompt = TRIAGE_PROMPT.format(
        schema_json=json.dumps(schema, indent=2),
        metric_name=metric["metric"],
        metric_value=metric["value"],
        metric_unit=metric["unit"],
        category_guide=CATEGORY_GUIDE,
        good_direction_guide=GOOD_DIRECTION_GUIDE,
    )
    response = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=1024,
        thinking={"type": "disabled"},
        messages=[{"role": "user", "content": prompt}],
    )
    text = next(block.text for block in response.content if block.type == "text")
    return parse_json_response(text)


def review_row_for_sheet(company: str, period: str, metric: dict, proposal: dict) -> list:
    """Flatten one triage proposal into a Pending Review-tab row."""
    return [
        company,
        period,
        metric["metric"],
        metric["value"],
        metric["unit"],
        proposal.get("is_duplicate"),
        proposal.get("matches_metric") or "",
        proposal.get("confidence"),
        proposal.get("reasoning"),
        proposal.get("proposed_category") or "",
        proposal.get("proposed_good_direction") or "",
        proposal.get("proposed_label"),
        "Pending",
    ]


if __name__ == "__main__":
    # Quick manual test: python triage_new_metrics.py path/to/schema.json <metric_name> <value> <unit>
    if len(sys.argv) != 5:
        print("Usage: python triage_new_metrics.py path/to/schema.json <metric_name> <value> <unit>")
        sys.exit(1)
    with open(sys.argv[1]) as f:
        schema = json.load(f)
    metric = {"metric": sys.argv[2], "value": float(sys.argv[3]), "unit": sys.argv[4]}
    result = triage_metric(schema, metric)
    print(json.dumps(result, indent=2))
