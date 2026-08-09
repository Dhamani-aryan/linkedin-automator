export const selectors = Object.freeze({
  loginForm: 'input[name="session_key"], input[name="session_password"], form[action*="login"]',
  profileRoot: "main, body",
  profileMessageControl:
    '[data-view-name="profile-primary-message"] a[href*="/messaging/compose/"], [data-view-name="profile-primary-message"] button',
  profileOverflowControl: '[data-view-name="profile-overflow-button"] button',
  connectButtonText: "connect",
  moreButtonText: "more",
  pendingButtonText: "pending",
  messageButtonText: "message",
  firstDegreeText: "1st"
});

export function sanitizeSnippet(value, maxLength = 2000) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/(csrf-token|session|li_at|JSESSIONID)[^"'<> ]+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}
