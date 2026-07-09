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

client = Anthropic()


def _parse_json_response(raw: str) -> dict:
    """Defensive parsing — strip markdown fences if the model adds them despite instructions."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    return json.loads(cleaned.strip())


def extract_metrics(email_text: str, schema: dict) -> dict:
    """
    Returns:
        {
          "period": "March 2026",
          "metrics": [
            {"metric": "revenue", "value": 82000, "unit": "USD", "is_new_metric": false},
            ...
          ]
        }
    """
    prompt = EXTRACTION_PROMPT.format(
        schema_json=json.dumps(schema, indent=2),
        email_text=email_text,
    )
    response = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return _parse_json_response(response.content[0].text)


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
