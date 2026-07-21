/**
 * Gmail integration — replaces extraction/gmail_client.py's OAuth/token-file flow with the
 * built-in GmailApp service. No credentials.json, no token.json: the one-time consent screen
 * the user clicks through during authorization (see SETUP.md) grants exactly the
 * gmail.readonly scope declared in appsscript.json — read access only, same guarantee the
 * Python README calls out.
 *
 * GmailApp.getPlainBody() is used in place of _extract_body()'s manual multipart/base64
 * walk — it already prefers the text/plain part of a message the same way _extract_body()
 * does, so this is a like-for-like substitution rather than a behavior change; GmailApp simply
 * doesn't expose raw MIME parts the way the Gmail API client library does.
 */

// Dropped before matching a company name against a subject line — founders write the brand
// name, rarely the full formal name (e.g. "Carpool", not "Carpool Logistics"). Ported verbatim
// from extraction/gmail_client.py's _GENERIC_COMPANY_WORDS.
var GENERIC_COMPANY_WORDS_ = [
  'the', 'inc', 'llc', 'corp', 'corporation', 'co', 'company', 'group',
  'technologies', 'tech', 'labs', 'logistics', 'solutions', 'systems', 'holdings',
];

/**
 * Builds a lenient Gmail subject filter from a company name: strips generic corporate words and
 * OR's together whatever's left, instead of requiring the full name verbatim. Ported verbatim
 * from _subject_query() in extraction/gmail_client.py.
 */
function subjectQuery_(companyName) {
  var words = companyName.split(/\s+/).filter(function (w) {
    return GENERIC_COMPANY_WORDS_.indexOf(w.toLowerCase()) === -1;
  });
  if (words.length === 0) {
    words = companyName.split(/\s+/);
  }
  if (words.length === 1) {
    return 'subject:' + words[0];
  }
  return 'subject:(' + words.join(' OR ') + ')';
}

/** Gmail search's `after:` operator wants a date, not a timestamp — day granularity only. */
function formatDateForGmailQuery_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
}

/**
 * GmailApp.search() caps a single call at 500 threads; page through with start/max so a
 * high-volume sender's wide backfill window doesn't silently truncate.
 */
function searchThreadsPaged_(query) {
  var threads = [];
  var start = 0;
  var pageSize = 500;
  while (true) {
    var page = GmailApp.search(query, start, pageSize);
    threads = threads.concat(page);
    if (page.length < pageSize) break;
    start += pageSize;
  }
  return threads;
}

/**
 * Returns {subject, date, body} for every message from `senderEmail` received strictly after
 * `sinceDate`, sorted oldest-first. subjectHint (the company name) narrows the query further —
 * needed when multiple companies share one sender address. Mirrors fetch_new_emails() in
 * gmail_client.py.
 *
 * Gmail's `after:` operator is day-granular, so a `since` timestamp mid-day still needs an
 * exact filter on the message date afterward, or the day's earlier messages would be re-pulled.
 *
 * The oldest-first sort matters beyond just display order: Gmail returns threads newest-first,
 * and a sender who emails multiple times a month (e.g. weekly updates) has those all land in
 * the same "YYYY-MM" extraction period. appendMetricRows_() in SheetsClient.gs upserts rather
 * than appends, so whichever email is processed *last* for a given month wins — sorting here
 * ensures "last processed" always means "most recent by date," not "whichever order Gmail's
 * thread listing happened to return."
 */
function fetchNewEmails_(senderEmail, sinceDate, subjectHint) {
  var query = 'from:' + senderEmail + ' after:' + formatDateForGmailQuery_(sinceDate);
  if (subjectHint) {
    query += ' ' + subjectQuery_(subjectHint);
  }

  var threads = searchThreadsPaged_(query);
  var emails = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (message.getDate().getTime() > sinceDate.getTime()) {
        emails.push({
          subject: message.getSubject(),
          date: message.getDate(),
          body: message.getPlainBody(),
        });
      }
    });
  });
  emails.sort(function (a, b) {
    return a.date.getTime() - b.date.getTime();
  });
  return emails;
}

/**
 * Returns the single most recent email from `senderEmail` as {subject, date, body}, or null if
 * there isn't one. Used for auto-onboarding — pulling a real sample to propose a schema from.
 * Mirrors fetch_most_recent_email() in gmail_client.py.
 */
function fetchMostRecentEmail_(senderEmail, subjectHint) {
  var query = 'from:' + senderEmail;
  if (subjectHint) {
    query += ' ' + subjectQuery_(subjectHint);
  }

  var threads = GmailApp.search(query, 0, 1);
  if (threads.length === 0) {
    return null;
  }
  var messages = threads[0].getMessages();
  var mostRecent = messages[messages.length - 1];
  return {
    subject: mostRecent.getSubject(),
    date: mostRecent.getDate(),
    body: mostRecent.getPlainBody(),
  };
}
