/**
 * Prompt templates for the portfolio tracker — ported verbatim from config/prompts.py.
 *
 * Do not rewrite or "improve" the wording here — it's already tuned. Diff this file against
 * config/prompts.py if the Python prompts ever change.
 *
 * Three prompts, three jobs:
 * - ONBOARDING_PROMPT: run once per company, on one sample email plus the human's stated
 *   priorities — mandatory, the universal source of truth for what gets tracked. Proposes a
 *   small, fixed set of metrics — at most one per category, five categories total. This is the
 *   one place scope gets decided; extraction never discovers anything beyond it.
 * - EXTRACTION_PROMPT: run on every real update email, pulling values for exactly the metrics
 *   chosen at onboarding. Anything else the email mentions is ignored, not captured "just in case."
 * - RELEVANCE_PROMPT: run on every incoming email (after a free keyword fast-path) to decide
 *   whether it's a performance update worth extracting from at all, before either of the above
 *   ever runs.
 *
 * Placeholders like {user_priorities} are filled in by renderTemplate_() in Utils.gs — see that
 * file for how substitution works and why the JSON example braces below are left untouched.
 */

var CATEGORY_GUIDE = 'There are exactly five categories, one metric each, at most five metrics total for a company:\n' +
  '- primary_revenue: the company\'s main top-line revenue or GMV-style metric.\n' +
  '- secondary_revenue: a second revenue-shaped metric (e.g. net revenue alongside gross).\n' +
  '- volume: a count/throughput metric (units shipped, customers, orders).\n' +
  '- profitability: a margin or profit percentage.\n' +
  '- health_rate: a percentage signaling customer/operational health (retention, on-time rate, conversion — churn counts too).\n' +
  'Not every company will have a clean fit for all five — skip a category rather than forcing a weak metric into it.';

var GOOD_DIRECTION_GUIDE = 'Also assign each metric a good_direction: "up" if a larger number is a healthier sign\n' +
  '(revenue, customers, retention rate), or "down" if a smaller number is healthier (churn, CAC, days-to-ship,\n' +
  'burn rate). Default to "up" unless the metric is clearly a cost, loss, or churn-shaped concept.';

var ONBOARDING_PROMPT = 'You are helping set up automated tracking of startup performance metrics from founder update emails.\n' +
  '\n' +
  'The human running this tool has stated what they want tracked for this company — this is the universal\n' +
  'source of truth for what matters here, not a hint:\n' +
  '\n' +
  '  {user_priorities}\n' +
  '\n' +
  'Below is a sample email from this founder, used ONLY to find the actual numbers for what\'s listed above —\n' +
  'never as a source of which metrics to track. Propose a metric schema covering EXACTLY the items named above,\n' +
  'nothing more: one metric per item named, up to five, each placed in whichever category fits best.\n' +
  '\n' +
  'Hard rules:\n' +
  '- Propose a metric ONLY if it is explicitly named above. Do not add a metric because it seems important,\n' +
  '  healthy to track, or because the email happens to state a number for it — if the human didn\'t name it,\n' +
  '  it does not go in the schema, no exceptions.\n' +
  '- Do not skip an explicitly named item just because it\'s awkward to categorize — every one of the five\n' +
  '  categories can hold anything; pick whichever fits best rather than dropping it.\n' +
  '- {category_guide}\n' +
  '- Map by meaning, not literal wording — but only within the SAME underlying business concept. "Take-home\n' +
  '  earnings" can map to a stated "net revenue" figure because they\'re the same concept differently phrased.\n' +
  '  A named item is a genuinely different concept from anything the email reports (e.g. "annual recurring\n' +
  '  revenue" for a company that only reports one-time freight/transaction revenue, with no recurring-revenue\n' +
  '  concept anywhere in the email) is NOT a wording variant of the closest available number — it is absent.\n' +
  '- If an item named above has no number for its actual concept stated anywhere in this email, leave it out\n' +
  '  of the schema entirely. Never substitute a different, unrelated number just because it\'s the closest\n' +
  '  available figure — inventing a value (or mislabeling an unrelated metric to fill the name) is worse than\n' +
  '  omitting the item.\n' +
  '- If more than five items are named above, keep only the first five and ignore the rest.\n' +
  '- Only metrics about this company\'s OWN performance — not general market/industry data, benchmarks, or\n' +
  '  competitor figures the founder cites for context. If in doubt whether a number is about this company vs.\n' +
  '  the broader market, leave it out.\n' +
  '- Use snake_case names (e.g. "monthly_revenue", "units_sold", "burn_rate").\n' +
  '- For units, use one of: USD, count, percent, USD_per_month — or another short label if none fit.\n' +
  '- Note any aliases: alternate phrases the founder used for the same metric (e.g. "topline" for revenue), so\n' +
  '  future emails with different wording still map correctly.\n' +
  '- {good_direction_guide}\n' +
  '\n' +
  'Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape — a flat object\n' +
  'keyed by metric name, no wrapper, at most five entries:\n' +
  '{\n' +
  '  "<metric_name>": {"unit": "<unit>", "aliases": ["<phrase from email>"], "category": "<category>", "good_direction": "<up or down>"}\n' +
  '}\n' +
  '\n' +
  'Email:\n' +
  '---\n' +
  '{email_text}\n' +
  '---\n';

var EXTRACTION_PROMPT = 'You are extracting structured performance data from a founder update email for a specific portfolio company.\n' +
  '\n' +
  'This company tracks exactly these metrics (chosen deliberately at onboarding — nothing else matters for this tool):\n' +
  '{schema_json}\n' +
  '\n' +
  'This email was sent on: {email_date}\n' +
  '\n' +
  'Below is a new update email from this founder. Extract a value ONLY for the metrics listed above.\n' +
  '\n' +
  'Rules:\n' +
  '- Only extract a metric if THIS email states a number for it. Never estimate, infer, or carry forward a\n' +
  '  value from a previous period. If a known metric is simply absent from this email, leave it out entirely.\n' +
  '- If the email restates a known metric using different wording than its aliases, still map it to that\n' +
  '  metric — use judgment, not just the literal alias list.\n' +
  '- Ignore every other number in the email, no matter how prominent — this tool intentionally tracks only\n' +
  '  the metrics listed above, not everything the founder reports.\n' +
  '- Determine the reporting period this email covers, using the email\'s send date above to resolve relative\n' +
  '  or year-less mentions (e.g. an email sent in 2026 that just says "June" means June 2026). Normalize to\n' +
  '  "YYYY-MM" for the month this email\'s data belongs to, or "YYYY-Q#" only if the company reports purely on\n' +
  '  a quarterly cadence with no monthly figures at all. A weekly update still belongs to "YYYY-MM" — use the\n' +
  '  month it falls in, not a week number; this tool tracks monthly trends, not weekly ones. If genuinely not\n' +
  '  determinable, use "unknown".\n' +
  '\n' +
  'Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:\n' +
  '{\n' +
  '  "period": "<normalized period this email covers>",\n' +
  '  "metrics": [\n' +
  '    {"metric": "<name>", "value": <number>, "unit": "<unit>"}\n' +
  '  ]\n' +
  '}\n' +
  '\n' +
  'Email:\n' +
  '---\n' +
  '{email_text}\n' +
  '---\n';

var RELEVANCE_PROMPT = 'You are filtering a founder\'s inbox to find their business performance update emails,\n' +
  'out of everything else they send (scheduling, casual chat, unrelated threads).\n' +
  '\n' +
  'Subject: {subject}\n' +
  '\n' +
  'Beginning of the email:\n' +
  '---\n' +
  '{body_excerpt}\n' +
  '---\n' +
  '\n' +
  'Is this a business performance / metrics update — the kind that reports on things like revenue, users,\n' +
  'growth, churn, operations, or team size? It doesn\'t need to be formal or use those exact words.\n' +
  '\n' +
  'Answer with ONLY one word: YES or NO.\n';
