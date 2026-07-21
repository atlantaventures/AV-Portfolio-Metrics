/**
 * Defensive parsing of Claude's JSON responses — ported from config/json_utils.py.
 *
 * Strips markdown fences and any conversational preamble/trailing text the model adds despite
 * instructions not to (seen in practice: a fence appearing after a sentence like "Looking at the
 * requested items...", not at the very start of the response).
 */
function parseJsonResponse_(raw) {
  var cleaned = raw.trim();
  if (cleaned.indexOf('```') !== -1) {
    cleaned = cleaned.split('```')[1];
    if (cleaned.indexOf('json') === 0) {
      cleaned = cleaned.substring(4);
    }
    cleaned = cleaned.trim();
  } else {
    var start = cleaned.indexOf('{');
    var end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      cleaned = cleaned.substring(start, end + 1);
    }
  }
  return JSON.parse(cleaned.trim());
}
