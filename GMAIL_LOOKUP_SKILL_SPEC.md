# Gmail Lookup Skill — design spec (not built yet)

A possible future companion to Portfolio Pulse, not a replacement for it. Where the pipeline
runs unattended on a schedule and maintains a persistent Sheet of history, this is the opposite
shape on purpose: on-demand, human-in-the-loop, no schedule, no persistent store of its own.
Someone asks a question in chat, the Skill goes and looks, right now, and the person sees the
answer immediately and can sanity-check it — that's the actual safety property this has that
the automated pipeline doesn't.

Do not build this as "the automated pipeline, but inside a Skill." It solves a different
problem: flexible, ad hoc questions a rigid 5-metric schema can't answer, at the cost of not
being a stable, always-current, background artifact. Keep it that way — see "Why this isn't
the same tool" at the bottom before changing scope.

## Reuses the real Registry — does not invent its own

Company name, sender email, and priorities already live in Portfolio Pulse's Registry tab and
are already trusted. This Skill reads that same tab rather than keeping a separate list that
could drift out of sync with the real pipeline.

## Capability 1 — Answer ad hoc questions

Example prompts this should handle: "show me updates from Carpool for the last 4 months," "check
ARR for The Perlant over the last 6 months."

**Step 1 — Resolve the company. Never guess.**
Look up the name in the Registry. Not found, or ambiguous (matches more than one row) → stop and
ask which company was meant. Pull that row's `sender_email`.

**Step 2 — Resolve the time window to explicit dates.**
Convert "last N months" to a concrete start/end date, anchored to today. State the resolved
window back in the answer so the person can verify the scope themselves.

**Step 3 — Search with a fixed, explicit query pattern. Never freeform.**
`from:<sender_email> after:<start date>`, plus `subject:(<company name, minus generic words like
"Inc"/"Group"/"Logistics">)` if that sender is shared by more than one Registry row. This is the
exact pattern `gmail_client.py`'s `_subject_query` already uses — reuse it, don't reinvent it.

**Step 4 — Branch on intent. Don't treat every question the same.**
- "Show me updates from X for the last N months" → a **timeline**. Process every matching email,
  one entry per email, chronological.
- "Check [metric] for X over the last N months" → a **single metric's trend**. Still process
  every matching email, but pull only that one metric from each; note explicitly when a given
  email doesn't mention it rather than skipping silently.

**Step 5 — Handle zero/ambiguous results out loud.**
No matches → say so plainly, state the exact sender and window used, don't fall back to older
data or guess. Metric asked for but absent from a specific email → say "not mentioned in this
update," never estimate or carry forward a prior value.

**Step 6 — Extraction discipline — identical to the pipeline's own rule.**
Only state a number if that specific email states it. Never infer, average, or fill a gap.
Judgment is fine for matching wording ("topline" = revenue); never fine for whether a number is
real.

**Step 7 — Every fact cites its source.**
Every number in the answer gets the source email's date next to it. There's no Sheet row to
double-check later here — the answer has to carry its own proof.

**Step 8 — Fixed output shape.**
Always: a dated list, oldest to newest, one line per reading — metric → value → source date.
Consistent formatting is part of "predictable," even when the numbers are right.

## Capability 2 — Add a company via chat

Example: "Add The Perlant to system, sender email is x@gmail.com."

**Step 1 — Parse, then confirm before writing anything.**
Echo the parsed fields back explicitly ("About to add: company = The Perlant, sender =
x@gmail.com — confirm?") before touching the Sheet. Same propose-then-human-confirms discipline
the whole pipeline already runs on.

**Step 2 — Check for duplicates and conflicts first, out loud.**
Does a similarly-named company already exist? Does this sender already belong to a *different*
company in the Registry? (Real case this summer: one sender forwarding for four different
companies.) Either hit → stop and ask, don't silently add a conflicting row.

**Step 3 — Enforce mandatory priorities. No exceptions, no bypass.**
If priorities isn't given, ask for it before writing. Never create a row with blank priorities
"for now" — that would quietly reintroduce the exact assumed-intent problem priorities exists to
remove.

**Step 4 — Write ONLY the Registry row. Nothing else.**
Write `company`, `sender_email`, `status = Active`, `priorities`. Do **not** also run onboarding
(fetch a sample email, propose a schema) from inside the Skill. That stays the real pipeline's
job, on its own schedule, using its one tested prompt. Two independent code paths that could each
decide "what to track" differently is the exact failure mode to avoid — keep that decision
singular.

**Step 5 — Confirm what was written, verbatim.**
There's no PR review for a chat-driven Sheet edit — the transcript is the audit trail, so the
confirmation message needs to be complete and unambiguous.

## Honest limitations to keep in front of whoever uses this

- Not zero-config — it still needs the Registry as a reference; "ask it anything, no setup" isn't
  quite true.
- Answer-to-answer consistency isn't guaranteed the way a stored Sheet row is. Ask the same
  question twice, get two live-computed answers — probably the same, not guaranteed identical.
- "Last N months" across multiple emails is a real retrieval task done live, in one pass — a
  miniature version of the backfill problem, not a trivial lookup. It can miss one, especially
  under the same sender/subject ambiguity already seen this summer.
- Removes the pinned-model-version risk if it truly runs on whatever model the Skill runtime
  currently uses — but trades it for silent behavior drift if that underlying model changes with
  no version pin and no warning. Not obviously a net risk reduction, just a different risk.

## Open questions to verify before actually building this

- Can a Skill call Gmail search with the exact operators (`from:`, `after:`, `subject:`) the way
  `gmail_client.py` does, via the connector?
- Can it read the Registry tab (Google Sheets) the same way, and write to it for Capability 2?
- Is there any way to log/review what got written via chat after the fact, beyond the chat
  transcript itself?

## Why this isn't the same tool as Portfolio Pulse

Portfolio Pulse's whole value is that nobody has to ask — it's a passive, always-current
dashboard. This Skill is the opposite: useful, on-demand, safer per-answer, but only produces a
result when someone thinks to ask. It's a complement for flexible exploration, not a lower-
maintenance replacement for the standing dashboard.
