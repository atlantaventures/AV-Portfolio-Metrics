"""Shared helper for parsing Claude's JSON responses across onboarding, extraction, and triage."""

import json


def parse_json_response(raw: str) -> dict:
    """
    Defensive parsing — strip markdown fences and any conversational preamble/trailing text the
    model adds despite instructions not to (seen in practice: a fence appearing after a sentence
    like "Looking at the requested items...", not at the very start of the response).
    """
    cleaned = raw.strip()
    if "```" in cleaned:
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1:
            cleaned = cleaned[start:end + 1]
    return json.loads(cleaned.strip())
