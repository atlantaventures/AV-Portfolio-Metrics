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
from prompts import ONBOARDING_PROMPT, CATEGORY_GUIDE, GOOD_DIRECTION_GUIDE  # noqa: E402
from json_utils import parse_json_response  # noqa: E402

client = Anthropic()  # reads ANTHROPIC_API_KEY from environment


def propose_schema_from_sender(sender_email: str, subject_hint: str | None = None) -> dict:
    """
    Auto-onboarding path — pulls the sender's most recent real email via Gmail and proposes
    a schema from it directly, so a new company never needs a human to hand-supply a sample.
    subject_hint (the company name) disambiguates when multiple companies share one sender,
    e.g. a forwarding inbox during testing.
    """
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extraction"))
    from gmail_client import fetch_most_recent_email  # noqa: E402

    email = fetch_most_recent_email(sender_email, subject_hint=subject_hint)
    if not email:
        raise ValueError(f"No emails found from {sender_email} to onboard from.")
    return propose_schema(email["body"])


def propose_schema(email_text: str) -> dict:
    """Send a sample email to Claude and get back a proposed metric schema."""
    prompt = ONBOARDING_PROMPT.format(
        email_text=email_text, category_guide=CATEGORY_GUIDE, good_direction_guide=GOOD_DIRECTION_GUIDE
    )
    response = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=2048,
        thinking={"type": "disabled"},
        messages=[{"role": "user", "content": prompt}],
    )
    text = next(block.text for block in response.content if block.type == "text")
    return parse_json_response(text)


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
