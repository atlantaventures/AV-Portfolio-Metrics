/**
 * The one place model names live. No hardcoded default — each of the three must be set as a
 * Script Property (Project Settings -> Script Properties, same place ANTHROPIC_API_KEY lives)
 * named RELEVANCE_MODEL, EXTRACTION_MODEL, and ONBOARDING_MODEL. See maintenance docs for what
 * to do when Anthropic retires a model snapshot.
 */

var RELEVANCE_MODEL = requireModel_('RELEVANCE_MODEL');
var EXTRACTION_MODEL = requireModel_('EXTRACTION_MODEL');
var ONBOARDING_MODEL = requireModel_('ONBOARDING_MODEL');

/** Reads a required model Script Property; throws if it's unset or blank. */
function requireModel_(propertyName) {
  var value = PropertiesService.getScriptProperties().getProperty(propertyName);
  if (!value || !value.trim()) {
    throw new Error(
      'Script Property "' + propertyName + '" is not set (Project Settings -> Script Properties).'
    );
  }
  return value.trim();
}
