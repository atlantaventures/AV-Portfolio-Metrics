"""
Prompt templates for the portfolio tracker.

Three prompts, three jobs:
- ONBOARDING_PROMPT: run once per company, on one sample email, to propose a starting schema.
- EXTRACTION_PROMPT: run on every real update email, using that company's schema as a naming hint
  (not a gatekeeper) — see the rules baked into the prompt itself.
- TRIAGE_PROMPT: run once per metric extraction flagged as new, to catch cases where it's actually
  an existing metric under different wording rather than something genuinely new.
"""

CATEGORY_GUIDE = """Categories (used to decide which metrics get a dashboard scorecard vs. a plain table row):
- primary_revenue: the company's main top-line revenue or GMV-style metric. At most one per company.
- secondary_revenue: a second revenue-shaped metric (e.g. net revenue alongside gross). At most one.
- volume: a count/throughput metric (units shipped, customers, orders). At most one.
- profitability: a margin or profit percentage. At most one.
- health_rate: a percentage signaling customer/operational health (retention, on-time rate, conversion — churn counts too). At most one.
- other: everything else. Use this for the majority of metrics — segment breakdowns, detail metrics, one-off counts."""

GOOD_DIRECTION_GUIDE = """Also assign each metric a good_direction: "up" if a larger number is a healthier sign
(revenue, customers, retention rate), or "down" if a smaller number is healthier (churn, CAC, days-to-ship,
burn rate). Default to "up" unless the metric is clearly a cost, loss, or churn-shaped concept."""

ONBOARDING_PROMPT = """You are helping set up automated tracking of startup performance metrics from founder update emails.

Below is a sample email from a founder. Propose a metric schema: the distinct, quantifiable business metrics this founder reports on, with a short snake_case name and a unit for each.

Rules:
- Only include metrics clearly stated with a number in this email. Do not invent metrics that aren't present.
- Only include metrics about this company's OWN performance — not general market/industry data, benchmarks, or competitor figures the founder cites for context (e.g. an industry volume index, fuel prices, a market-wide conversion rate). If in doubt whether a number is about this company vs. the broader market, leave it out.
- Don't overlook simple headcount/team-size mentions ("we're now a team of 12") — these are metrics too.
- Use snake_case names (e.g. "monthly_revenue", "units_sold", "burn_rate").
- For units, use one of: USD, count, percent, USD_per_month — or another short label if none fit.
- Note any aliases: alternate phrases the founder used for the same metric (e.g. "topline" for revenue), so future emails with different wording still map correctly. Each alias must map to exactly one metric — if the founder reports the same abbreviation at multiple levels (e.g. a company-wide number and a per-segment number both called "GR"), do not give both metrics the same alias; keep the metric names and aliases distinct enough to tell them apart.
- Assign each metric a category, so the dashboard knows which few metrics deserve a scorecard vs. which are detail. {category_guide}
- {good_direction_guide}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape — a flat object
keyed by metric name, no wrapper:
{{
  "<metric_name>": {{"unit": "<unit>", "aliases": ["<phrase from email>"], "category": "<category>", "good_direction": "<up or down>"}}
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
- Determine the reporting period this email covers, using the email's send date above to resolve relative or year-less mentions (e.g. an email sent in 2026 that just says "June" means June 2026). Normalize to one of: "YYYY-MM" for a specific month, "YYYY-Q#" for a quarter, or "YYYY-MM-DD" for a weekly or daily report — use the specific date stated in the email if there is one, otherwise the email's send date above. Don't collapse a weekly report into a week number; use the actual date. If genuinely not stated or determinable, use "unknown".

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

RELEVANCE_PROMPT = """You are filtering a founder's inbox to find their business performance update emails,
out of everything else they send (scheduling, casual chat, unrelated threads).

Subject: {subject}

Beginning of the email:
---
{body_excerpt}
---

Is this a business performance / metrics update — the kind that reports on things like revenue, users,
growth, churn, operations, or team size? It doesn't need to be formal or use those exact words.

Answer with ONLY one word: YES or NO.
"""

TRIAGE_PROMPT = """You are reviewing one newly-seen metric from a portfolio company's founder update, to decide
whether it is genuinely a new metric or the same underlying metric as one already tracked, just phrased
or named differently.

This company's existing tracked metrics (name, unit, known aliases, category):
{schema_json}

The new metric just extracted from this email:
  name: {metric_name}
  value: {metric_value}
  unit: {metric_unit}

Decide:
- Is this the SAME underlying business metric as one already tracked above, just under a different name?
  (e.g. "money earned this year" and an existing "annual_run_rate" metric are the same thing.)
- A narrower breakout of an existing metric (e.g. a segment or product-line slice of a company-wide number)
  is NOT the same metric — treat that as genuinely new, not a duplicate.
- If it is a duplicate, name which existing metric it matches and how confident you are.
- If it is genuinely new, propose a category for it. {category_guide}
- If it is genuinely new, also propose a good_direction. {good_direction_guide}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{{
  "is_duplicate": <true or false>,
  "matches_metric": "<existing metric name, or null if not a duplicate>",
  "confidence": "<high, medium, or low>",
  "reasoning": "<one sentence>",
  "proposed_category": "<category, or null if is_duplicate is true>",
  "proposed_good_direction": "<up or down, or null if is_duplicate is true>",
  "proposed_label": "<short human-readable label for this metric, e.g. 'Annual Run Rate'>"
}}
"""
