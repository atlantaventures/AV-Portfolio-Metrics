/**
 * Cheap pre-filter that runs before extraction — ported from extraction/relevance_filter.py.
 * Deliberately lightweight: sees only the subject and the first ~500 characters of the body, not
 * the schema, not the full email. The goal is a large class of obviously-irrelevant emails (from
 * the same sender, but not a performance update) never reaching the expensive extraction call.
 */

var BODY_EXCERPT_CHARS = 500;

// Subjects containing one of these are treated as relevant with no API call at all — "update"
// alone covers ~95% of real founder updates. Anything that doesn't match still falls through to
// isRelevantUpdate_() below, so the rare real update titled differently isn't just discarded.
var SUBJECT_KEYWORDS = ['update', 'recap', 'report', 'snapshot', 'roundup', 'digest', 'summary'];

function subjectHintsAtUpdate_(subject) {
  var lowered = subject.toLowerCase();
  return SUBJECT_KEYWORDS.some(function (keyword) {
    return lowered.indexOf(keyword) !== -1;
  });
}

/** True if this looks like a business performance update worth extracting from. Always calls Claude. */
function isRelevantUpdate_(subject, body) {
  var prompt = renderTemplate_(RELEVANCE_PROMPT, {
    subject: subject,
    body_excerpt: body.substring(0, BODY_EXCERPT_CHARS),
  });
  var text = callClaude_(prompt, RELEVANCE_MODEL, 10);
  return text.trim().toUpperCase().indexOf('YES') === 0;
}

/**
 * The actual entry point the pipeline calls. Fast path first (free, keyword-based); Claude-
 * reasoned fallback second, only when the fast path doesn't already say yes.
 */
function shouldExtract_(subject, body) {
  if (subjectHintsAtUpdate_(subject)) return true;
  return isRelevantUpdate_(subject, body);
}
