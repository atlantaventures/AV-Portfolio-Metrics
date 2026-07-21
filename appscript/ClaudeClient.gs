/**
 * Claude API integration — replaces the Python `anthropic` SDK with a plain UrlFetchApp call to
 * the same Messages API endpoint, same prompts, same model IDs.
 *
 * The API key lives in Script Properties (Extensions -> Apps Script -> Project Settings ->
 * Script Properties), never in this source file — see SETUP.md.
 */

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_API_VERSION = '2023-06-01';

var CLAUDE_MAX_ATTEMPTS = 4; // 1 initial try + 3 retries
var CLAUDE_RETRY_BASE_DELAY_MS = 1000; // doubles each retry: 1s, 2s, 4s

/**
 * Calls the Claude Messages API with a single user turn and thinking disabled (matching every
 * call site in the Python pipeline — none of the three prompts use extended thinking). Returns
 * the first text block's content, mirroring
 * `next(block.text for block in response.content if block.type == "text")`.
 *
 * Retries with exponential backoff on 429 (rate limit) and 5xx (transient server error)
 * responses only — a 4xx like a bad request or bad API key will never succeed on retry, so
 * those still fail immediately. Without this, a single transient error on one email silently
 * dropped that email's data forever: processEmails_'s per-email try/catch (Pipeline.gs) logs and
 * moves on, and the next run's "since" window starts after this run's start time, so the failed
 * email would never be fetched again.
 */
function callClaude_(prompt, model, maxTokens) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set in Script Properties (Project Settings -> Script ' +
        'Properties). See SETUP.md step 3.'
    );
  }

  var payload = {
    model: model,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: prompt }],
  };

  var lastError = null;

  for (var attempt = 0; attempt < CLAUDE_MAX_ATTEMPTS; attempt++) {
    var response = UrlFetchApp.fetch(CLAUDE_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': CLAUDE_API_VERSION,
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    var statusCode = response.getResponseCode();

    if (statusCode === 200) {
      var body = JSON.parse(response.getContentText());
      var textBlock = null;
      for (var i = 0; i < body.content.length; i++) {
        if (body.content[i].type === 'text') {
          textBlock = body.content[i];
          break;
        }
      }
      if (!textBlock) {
        throw new Error('Claude response contained no text block.');
      }
      return textBlock.text;
    }

    var errorBody = JSON.parse(response.getContentText());
    var message = (errorBody && errorBody.error && errorBody.error.message) || response.getContentText();
    lastError = new Error('Claude API error (' + statusCode + '): ' + message);

    var isRetryable = statusCode === 429 || statusCode >= 500;
    if (!isRetryable || attempt === CLAUDE_MAX_ATTEMPTS - 1) {
      throw lastError;
    }

    Utilities.sleep(CLAUDE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
  }

  throw lastError;
}
