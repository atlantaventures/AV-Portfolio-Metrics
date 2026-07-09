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
- Only include metrics about this company's OWN performance — not general market/industry data, benchmarks, or competitor figures the founder cites for context (e.g. an industry volume index, fuel prices, a market-wide conversion rate). If in doubt whether a number is about this company vs. the broader market, leave it out.
- Don't overlook simple headcount/team-size mentions ("we're now a team of 12") — these are metrics too.
- Use snake_case names (e.g. "monthly_revenue", "units_sold", "burn_rate").
- For units, use one of: USD, count, percent, USD_per_month — or another short label if none fit.
- Note any aliases: alternate phrases the founder used for the same metric (e.g. "topline" for revenue), so future emails with different wording still map correctly. Each alias must map to exactly one metric — if the founder reports the same abbreviation at multiple levels (e.g. a company-wide number and a per-segment number both called "GR"), do not give both metrics the same alias; keep the metric names and aliases distinct enough to tell them apart.

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

This email was sent on: {email_date}

Below is a new update email from this founder. Extract every metric explicitly stated in this email.

Rules:
- Only extract a metric if THIS email states a number for it. Never estimate, infer, or carry forward a value from a previous period. If a known metric is simply absent from this email, leave it out entirely — do not include it with a null or repeated value.
- Only extract metrics about this company's OWN performance — not general market/industry data, benchmarks, or competitor figures the founder cites for context (e.g. an industry volume index, fuel prices, a market-wide conversion rate), even if a known metric or a "new metric" would otherwise match. If in doubt whether a number is about this company vs. the broader market, leave it out.
- If the email states a metric NOT in the known schema, still extract it — assign it a sensible new snake_case name. Don't discard it just because it's new.
- If the email restates a known metric using different wording than the schema's aliases, map it to the existing metric name rather than creating a duplicate.
- Determine the reporting period this email covers, using the email's send date above to resolve relative or year-less mentions (e.g. an email sent in 2026 that just says "June" means June 2026). Normalize to one of: "YYYY-MM" for a specific month, "YYYY-Q#" for a quarter, "YYYY-Www" for a specific week. If genuinely not stated or determinable, use "unknown".

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{{
  "period": "<normalized period this email covers>",
  "metrics": [
    {{"metric": "<name>", "value": <number>, "unit": "<unit>", "is_new_metric": <true or false>}}
  ]
}}

Email:
---
{email_text}
---
"""
