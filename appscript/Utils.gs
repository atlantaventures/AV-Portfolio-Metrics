/**
 * Small shared helpers used across the pipeline.
 */

/**
 * Fills {token} placeholders in a prompt template. Python's .format() escapes literal braces as
 * "{{" / "}}"; here the prompt templates already contain literal single braces (the JSON example
 * shapes), so this only ever substitutes a "{word}" token — a bare "{" followed by a quote or
 * other non-word character (as in every JSON example in Prompts.gs) never matches and is left
 * untouched.
 */
function renderTemplate_(template, values) {
  return template.replace(/\{(\w+)\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
  });
}

/** Returns a Date `months` months before `fromDate` (or now, if omitted). */
function monthsAgo_(months, fromDate) {
  var base = fromDate ? new Date(fromDate.getTime()) : new Date();
  base.setMonth(base.getMonth() - months);
  return base;
}
