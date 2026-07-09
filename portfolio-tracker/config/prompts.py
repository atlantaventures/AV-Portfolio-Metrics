"""
Prompt templates for the portfolio tracker.

Two prompts, two jobs:
- ONBOARDING_PROMPT: run once per company, on one sample email, to propose a starting schema.
- EXTRACTION_PROMPT: run on every real update email, using that company's schema as a naming hint
  (not a gatekeeper) — see the rules baked into the prompt itself.
"""

ONBOARDING_PROMPT = """You are helping set up automated tracking of startup performance metrics from founder update emails.

Below is a sample email from a founder. Propose a metric schema: the distinct, quantifiable business metrics this founder reports on, with a short snake_case name and a unit for each.

Rules:
- Only include metrics clearly stated with a number in this email. Do not invent metrics that aren't present.
- Use snake_case names (e.g. "monthly_revenue", "units_sold", "burn_rate").
- For units, use one of: USD, count, percent, USD_per_month — or another short label if none fit.
- Note any aliases: alternate phrases the founder used for the same metric (e.g. "topline" for revenue), so future emails with different wording still map correctly.

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{{
  "metrics": {{
    "<metric_name>": {{"unit": "<unit>", "aliases": ["<phrase from email>"]}}
  }}
}}

Email:
---
{email_text}
---
"""

EXTRACTION_PROMPT = """You are extracting structured performance data from a founder update email for a specific portfolio company.

This company's known metric schema (built during onboarding) is:
{schema_json}

Below is a new update email from this founder. Extract every metric explicitly stated in this email.

Rules:
- Only extract a metric if THIS email states a number for it. Never estimate, infer, or carry forward a value from a previous period. If a known metric is simply absent from this email, leave it out entirely — do not include it with a null or repeated value.
- If the email states a metric NOT in the known schema, still extract it — assign it a sensible new snake_case name. Don't discard it just because it's new.
- If the email restates a known metric using different wording than the schema's aliases, map it to the existing metric name rather than creating a duplicate.
- Determine the reporting period from the email if possible (e.g. "March 2026", "Q1 2026", "week of April 6"). If genuinely not stated, use "unknown".

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{{
  "period": "<period this email covers>",
  "metrics": [
    {{"metric": "<name>", "value": <number>, "unit": "<unit>", "is_new_metric": <true or false>}}
  ]
}}

Email:
---
{email_text}
---
"""
