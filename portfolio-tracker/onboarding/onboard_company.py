"""
Onboarding script — run this ONCE per new portfolio company.

Usage:
    python onboard_company.py path/to/sample_email.txt

What it does:
    1. Reads a sample founder update email.
    2. Sends it to Claude with the onboarding prompt to propose a metric schema.
    3. Prints the proposed schema so you can eyeball it before saving it.

What it does NOT do (yet):
    Write the approved schema into the Google Sheet Registry tab — that's a few lines using
    the Sheets API (gspread), added once we wire up your Google credentials on your machine.
    For now this prints JSON you can paste into the schema_json column by hand, or pipe to a file.
"""

import sys
import json
import os
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "config"))
from prompts import ONBOARDING_PROMPT  # noqa: E402

client = Anthropic()  # reads ANTHROPIC_API_KEY from environment


def propose_schema(email_text: str) -> dict:
    """Send a sample email to Claude and get back a proposed metric schema."""
    prompt = ONBOARDING_PROMPT.format(email_text=email_text)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    return json.loads(raw)


def main():
    if len(sys.argv) != 2:
        print("Usage: python onboard_company.py path/to/sample_email.txt")
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        email_text = f.read()

    schema = propose_schema(email_text)

    print("\nProposed schema — review before saving:\n")
    print(json.dumps(schema, indent=2))
    print("\nIf this looks right, this JSON is what goes in the schema_json cell")
    print("for this company's row in the Registry tab.")


if __name__ == "__main__":
    main()
