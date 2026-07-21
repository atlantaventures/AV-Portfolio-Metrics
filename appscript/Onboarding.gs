/**
 * Onboarding — ported from onboarding/onboard_company.py's propose_schema_from_sender() /
 * propose_schema(). Runs automatically per company inside Pipeline.gs, pulling the sample email
 * from Gmail and the priorities string from the Registry's "priorities" column.
 */

/**
 * Pulls the sender's most recent real email via Gmail and proposes a schema from it directly, so
 * a new company never needs a human to hand-supply a sample. subjectHint (the company name)
 * disambiguates when multiple companies share one sender. userPriorities is mandatory — whatever
 * the human typed into the Registry's "priorities" column, the universal source of truth for
 * this tool.
 */
function proposeSchemaFromSender_(senderEmail, subjectHint, userPriorities) {
  if (!userPriorities || !userPriorities.trim()) {
    throw new Error('priorities is mandatory — this company has none set, refusing to onboard.');
  }

  var email = fetchMostRecentEmail_(senderEmail, subjectHint);
  if (!email) {
    throw new Error('No emails found from ' + senderEmail + ' to onboard from.');
  }
  return proposeSchema_(email.body, userPriorities);
}

/** Sends a sample email plus the human's mandatory priorities to Claude, gets back a schema. */
function proposeSchema_(emailText, userPriorities) {
  if (!userPriorities || !userPriorities.trim()) {
    throw new Error('priorities is mandatory — refusing to propose a schema without it.');
  }
  var prompt = renderTemplate_(ONBOARDING_PROMPT, {
    email_text: emailText,
    category_guide: CATEGORY_GUIDE,
    good_direction_guide: GOOD_DIRECTION_GUIDE,
    user_priorities: userPriorities.trim(),
  });
  var text = callClaude_(prompt, ONBOARDING_MODEL, 2048);
  return parseJsonResponse_(text);
}
