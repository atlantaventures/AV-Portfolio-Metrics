"""
Prompt templates for the portfolio tracker.

Two prompts, two jobs:
- ONBOARDING_PROMPT: run once per company, on one sample email plus the human's stated
  priorities — mandatory, the universal source of truth for what gets tracked. Proposes a
  small, fixed set of metrics — at most one per category, five categories total. This is the
  one place scope gets decided; extraction never discovers anything beyond it.
- EXTRACTION_PROMPT: run on every real update email, pulling values for exactly the metrics
  chosen at onboarding. Anything else the email mentions is ignored, not captured "just in case."
"""

CATEGORY_GUIDE = """There are exactly five categories, one metric each, at most five metrics total for a company:
- primary_revenue: the company's main top-line revenue or GMV-style metric.
- secondary_revenue: a second revenue-shaped metric (e.g. net revenue alongside gross).
- volume: a count/throughput metric (units shipped, customers, orders).
- profitability: a margin or profit percentage.
- health_rate: a percentage signaling customer/operational health (retention, on-time rate, conversion — churn counts too).
Not every company will have a clean fit for all five — skip a category rather than forcing a weak metric into it."""

GOOD_DIRECTION_GUIDE = """Also assign each metric a good_direction: "up" if a larger number is a healthier sign
(revenue, customers, retention rate), or "down" if a smaller number is healthier (churn, CAC, days-to-ship,
burn rate). Default to "up" unless the metric is clearly a cost, loss, or churn-shaped concept."""

ONBOARDING_PROMPT = """You are helping set up automated tracking of startup performance metrics from founder update emails.

The human running this tool has stated what they want tracked for this company — this is the universal
source of truth for what matters here, not a hint:

  {user_priorities}

Below is a sample email from this founder, used ONLY to find the actual numbers for what's listed above —
never as a source of which metrics to track. Propose a metric schema covering EXACTLY the items named above,
nothing more: one metric per item named, up to five, each placed in whichever category fits best.

Hard rules:
- Propose a metric ONLY if it is explicitly named above. Do not add a metric because it seems important,
  healthy to track, or because the email happens to state a number for it — if the human didn't name it,
  it does not go in the schema, no exceptions.
- Do not skip an explicitly named item just because it's awkward to categorize — every one of the five
  categories can hold anything; pick whichever fits best rather than dropping it.
- {category_guide}
- If an item named above has no number stated anywhere in this email, leave it out of the schema entirely
  rather than inventing a value for it.
- If more than five items are named above, keep only the first five and ignore the rest.
- Only metrics about this company's OWN performance — not general market/industry data, benchmarks, or
  competitor figures the founder cites for context. If in doubt whether a number is about this company vs.
  the broader market, leave it out.
- Use snake_case names (e.g. "monthly_revenue", "units_sold", "burn_rate").
- For units, use one of: USD, count, percent, USD_per_month — or another short label if none fit.
- Note any aliases: alternate phrases the founder used for the same metric (e.g. "topline" for revenue), so
  future emails with different wording still map correctly.
- {good_direction_guide}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape — a flat object
keyed by metric name, no wrapper, at most five entries:
{{
  "<metric_name>": {{"unit": "<unit>", "aliases": ["<phrase from email>"], "category": "<category>", "good_direction": "<up or down>"}}
}}

Email:
---
{email_text}
---
"""

EXTRACTION_PROMPT = """You are extracting structured performance data from a founder update email for a specific portfolio company.

This company tracks exactly these metrics (chosen deliberately at onboarding — nothing else matters for this tool):
{schema_json}

This email was sent on: {email_date}

Below is a new update email from this founder. Extract a value ONLY for the metrics listed above.

Rules:
- Only extract a metric if THIS email states a number for it. Never estimate, infer, or carry forward a
  value from a previous period. If a known metric is simply absent from this email, leave it out entirely.
- If the email restates a known metric using different wording than its aliases, still map it to that
  metric — use judgment, not just the literal alias list.
- Ignore every other number in the email, no matter how prominent — this tool intentionally tracks only
  the metrics listed above, not everything the founder reports.
- Determine the reporting period this email covers, using the email's send date above to resolve relative
  or year-less mentions (e.g. an email sent in 2026 that just says "June" means June 2026). Normalize to
  "YYYY-MM" for the month this email's data belongs to, or "YYYY-Q#" only if the company reports purely on
  a quarterly cadence with no monthly figures at all. A weekly update still belongs to "YYYY-MM" — use the
  month it falls in, not a week number; this tool tracks monthly trends, not weekly ones. If genuinely not
  determinable, use "unknown".

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{{
  "period": "<normalized period this email covers>",
  "metrics": [
    {{"metric": "<name>", "value": <number>, "unit": "<unit>"}}
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
