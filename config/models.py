"""
The one place model names live. Anthropic periodically retires older model snapshots — when
that happens, every Claude call in this pipeline will start failing with an API error, all at
once, on every run. If that happens: check https://docs.anthropic.com for current model names
and update the constants below. Nothing else in the codebase needs to change.

Each constant is named for the job it does, not the model tier, so swapping which model handles
a given job later (e.g. if a cheaper model turns out to be good enough, or a better one ships)
is also just a one-line change here.

A note on naming, since it's easy to assume the wrong thing here: an undated name like
"claude-sonnet-5" looks like it should auto-update, but per Anthropic's own docs, models from
this generation onward use a dateless format that is STILL a pinned snapshot, not an evergreen
pointer — it carries the same eventual-retirement risk as a dated ID. The one real exception is
"claude-haiku-4-5" (used below), which predates that convention and is a genuine alias that
Anthropic can re-point to a newer snapshot without any code change here.
"""

RELEVANCE_MODEL = "claude-haiku-4-5"  # genuine rolling alias — verified 15/15 accuracy vs Sonnet
EXTRACTION_MODEL = "claude-sonnet-5"  # precision matters — no review gate catches mistakes anymore
ONBOARDING_MODEL = "claude-sonnet-5"  # runs rarely; needs to follow the priorities-only rule strictly
