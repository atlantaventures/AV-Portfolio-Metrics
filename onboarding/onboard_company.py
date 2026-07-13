"""
Onboarding script — run this ONCE per new portfolio company.

Usage:
    python onboard_company.py path/to/sample_email.txt "what the user wants tracked"

What it does:
    1. Reads a sample founder update email, plus the human's stated priorities — mandatory,
       this is the universal source of truth for what gets tracked. No priorities, no schema.
    2. Sends both to Claude with the onboarding prompt to propose a small (at most 5-metric) schema.
    3. Prints the proposed schema so you can eyeball it before saving it.

In the real pipeline (run_pipeline.py), this happens automatically per company — see
propose_schema_from_sender, which pulls the sample email from Gmail and the priorities string
from the Registry's "priorities" column, instead of a human running this by hand. A company
with no priorities set is never onboarded, and never has any data displayed.
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
from models import ONBOARDING_MODEL  # noqa: E402

client = Anthropic()  # reads ANTHROPIC_API_KEY from environment


def propose_schema_from_sender(sender_email: str, subject_hint: str | None = None, user_priorities: str = "") -> dict:
    """
    Auto-onboarding path — pulls the sender's most recent real email via Gmail and proposes
    a schema from it directly, so a new company never needs a human to hand-supply a sample.
    subject_hint (the company name) disambiguates when multiple companies share one sender,
    e.g. a forwarding inbox during testing. user_priorities is mandatory — whatever the human
    typed into the Registry's "priorities" column, the universal source of truth for this tool.
    """
    if not user_priorities.strip():
        raise ValueError("priorities is mandatory — this company has none set, refusing to onboard.")

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extraction"))
    from gmail_client import fetch_most_recent_email  # noqa: E402

    email = fetch_most_recent_email(sender_email, subject_hint=subject_hint)
    if not email:
        raise ValueError(f"No emails found from {sender_email} to onboard from.")
    return propose_schema(email["body"], user_priorities=user_priorities)


def propose_schema(email_text: str, user_priorities: str) -> dict:
    """Send a sample email plus the human's mandatory priorities to Claude, get back a schema."""
    if not user_priorities.strip():
        raise ValueError("priorities is mandatory — refusing to propose a schema without it.")
    prompt = ONBOARDING_PROMPT.format(
        email_text=email_text,
        category_guide=CATEGORY_GUIDE,
        good_direction_guide=GOOD_DIRECTION_GUIDE,
        user_priorities=user_priorities.strip(),
    )
    response = client.messages.create(
        model=ONBOARDING_MODEL,
        max_tokens=2048,
        thinking={"type": "disabled"},
        messages=[{"role": "user", "content": prompt}],
    )
    text = next(block.text for block in response.content if block.type == "text")
    return parse_json_response(text)


def main():
    if len(sys.argv) != 3:
        print('Usage: python onboard_company.py path/to/sample_email.txt "what the user wants tracked"')
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        email_text = f.read()

    schema = propose_schema(email_text, user_priorities=sys.argv[2])

    print("\nProposed schema — review before saving:\n")
    print(json.dumps(schema, indent=2))
    print("\nIf this looks right, this JSON is what goes in the schema_json cell")
    print("for this company's row in the Registry tab.")


if __name__ == "__main__":
    main()
