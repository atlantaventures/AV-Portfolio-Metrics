"""
Core extraction logic — the piece that runs on every real founder update email.

This is deliberately separate from Gmail/Sheets plumbing so it can be tested and reasoned
about on its own: give it email text + a company's schema, get back structured metric rows.
"""

import json
import os
import sys
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "config"))
from prompts import EXTRACTION_PROMPT  # noqa: E402
from json_utils import parse_json_response  # noqa: E402
from models import EXTRACTION_MODEL  # noqa: E402

client = Anthropic()


def extract_metrics(email_text: str, schema: dict, email_date: str = "unknown") -> dict:
    """
    Returns:
        {
          "period": "2026-03",
          "metrics": [
            {"metric": "revenue", "value": 82000, "unit": "USD"},
            ...
          ]
        }
    """
    prompt = EXTRACTION_PROMPT.format(
        schema_json=json.dumps(schema, indent=2),
        email_date=email_date,
        email_text=email_text,
    )
    response = client.messages.create(
        model=EXTRACTION_MODEL,
        max_tokens=2048,
        thinking={"type": "disabled"},
        messages=[{"role": "user", "content": prompt}],
    )
    text = next(block.text for block in response.content if block.type == "text")
    return parse_json_response(text)


def rows_for_sheet(company: str, extraction_result: dict) -> list[list]:
    """Flatten one extraction result into Metrics-tab rows: [company, period, metric, value, unit]."""
    period = extraction_result.get("period", "unknown")
    return [
        [company, period, m["metric"], m["value"], m["unit"]]
        for m in extraction_result.get("metrics", [])
    ]


if __name__ == "__main__":
    # Quick manual test hook: python extract_core.py path/to/email.txt path/to/schema.json
    if len(sys.argv) != 3:
        print("Usage: python extract_core.py path/to/email.txt path/to/schema.json")
        sys.exit(1)
    with open(sys.argv[1]) as f:
        email_text = f.read()
    with open(sys.argv[2]) as f:
        schema = json.load(f)
    result = extract_metrics(email_text, schema)
    print(json.dumps(result, indent=2))
