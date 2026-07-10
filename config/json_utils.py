"""Shared helper for parsing Claude's JSON responses across onboarding, extraction, and triage."""

import json


def parse_json_response(raw: str) -> dict:
    """Defensive parsing — strip markdown fences if the model adds them despite instructions."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    return json.loads(cleaned.strip())
