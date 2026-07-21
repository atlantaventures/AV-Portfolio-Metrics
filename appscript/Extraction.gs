/**
 * Core extraction logic — ported from extraction/extract_core.py. Runs on every real founder
 * update email that passes the relevance filter: given email text + a company's fixed schema,
 * returns structured metric rows.
 */

/**
 * Returns {"period": "2026-03", "metrics": [{"metric": "revenue", "value": 82000, "unit": "USD"}, ...]}.
 */
function extractMetrics_(emailText, schema, emailDate) {
  var prompt = renderTemplate_(EXTRACTION_PROMPT, {
    schema_json: JSON.stringify(schema, null, 2),
    email_date: emailDate || 'unknown',
    email_text: emailText,
  });
  var text = callClaude_(prompt, EXTRACTION_MODEL, 2048);
  return parseJsonResponse_(text);
}

/**
 * Flattens one extraction result into Metrics-tab rows:
 * [company, period, metric, value, unit, source_email_subject, source_email_date].
 * The last two columns are traceability only, carrying the subject/date of the email this
 * particular row came from — see appendMetricRows_() in SheetsClient.gs for how they're kept in
 * sync when a later email in the same month overwrites an earlier one's value.
 */
function rowsForSheet_(company, extractionResult, sourceEmail) {
  var period = extractionResult.period || 'unknown';
  var metrics = extractionResult.metrics || [];
  return metrics.map(function (m) {
    return [company, period, m.metric, m.value, m.unit, sourceEmail.subject, sourceEmail.date];
  });
}
