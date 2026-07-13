"""
Cheap pre-filter that runs before extraction — decides whether an email is even worth sending
to the full extraction call (which drags along the company's whole schema as input tokens).

Deliberately lightweight: sees only the subject and the first ~500 characters of the body, not
the schema, not the full email. The goal is a large class of obviously-irrelevant emails (from
the same sender, but not a performance update) never reaching the expensive call at all.
"""

import os
import sys
from dotenv import load_dotenv
from anthropic import Anthropic

load_dotenv()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "config"))
from prompts import RELEVANCE_PROMPT  # noqa: E402
from models import RELEVANCE_MODEL  # noqa: E402

client = Anthropic()

BODY_EXCERPT_CHARS = 500

# Subjects containing one of these are treated as relevant with no API call at all — "update"
# alone covers ~95% of real founder updates. Anything that doesn't match still falls through to
# is_relevant_update() below, so the rare real update titled differently isn't just discarded.
SUBJECT_KEYWORDS = ["update", "recap", "report", "snapshot", "roundup", "digest", "summary"]


def _subject_hints_at_update(subject: str) -> bool:
    lowered = subject.lower()
    return any(keyword in lowered for keyword in SUBJECT_KEYWORDS)


def is_relevant_update(subject: str, body: str) -> bool:
    """True if this looks like a business performance update worth extracting from. Always calls Claude."""
    prompt = RELEVANCE_PROMPT.format(subject=subject, body_excerpt=body[:BODY_EXCERPT_CHARS])
    response = client.messages.create(
        model=RELEVANCE_MODEL,
        max_tokens=10,
        thinking={"type": "disabled"},
        messages=[{"role": "user", "content": prompt}],
    )
    text = next(block.text for block in response.content if block.type == "text")
    return text.strip().upper().startswith("YES")


def should_extract(subject: str, body: str) -> bool:
    """
    The actual entry point run_pipeline.py should call. Fast path first (free, keyword-based);
    Claude-reasoned fallback second, only when the fast path doesn't already say yes.
    """
    if _subject_hints_at_update(subject):
        return True
    return is_relevant_update(subject, body)


if __name__ == "__main__":
    # Quick manual test: python relevance_filter.py "<subject>" "<body text or excerpt>"
    if len(sys.argv) != 3:
        print('Usage: python relevance_filter.py "<subject>" "<body text>"')
        sys.exit(1)
    result = should_extract(sys.argv[1], sys.argv[2])
    print("RELEVANT" if result else "NOT RELEVANT")
