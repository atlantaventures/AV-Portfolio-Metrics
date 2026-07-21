/**
 * The one place model names live — ported verbatim from config/models.py.
 *
 * Anthropic periodically retires older model snapshots — when that happens, every Claude call
 * in this pipeline will start failing with an API error, all at once, on every run. If that
 * happens: check https://docs.anthropic.com for current model names and update the constants
 * below. Nothing else in this project needs to change.
 *
 * "claude-haiku-4-5" is a genuine rolling alias (Anthropic can re-point it to a newer snapshot
 * without any code change here). "claude-sonnet-5" looks evergreen but is still a pinned
 * snapshot per Anthropic's naming convention — it carries the same eventual-retirement risk as
 * a dated ID.
 */

var RELEVANCE_MODEL = 'claude-haiku-4-5'; // genuine rolling alias — verified 15/15 accuracy vs Sonnet
var EXTRACTION_MODEL = 'claude-sonnet-5'; // precision matters — no review gate catches mistakes anymore
var ONBOARDING_MODEL = 'claude-sonnet-5'; // runs rarely; needs to follow the priorities-only rule strictly
