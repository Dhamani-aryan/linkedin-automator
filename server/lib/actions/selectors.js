export const selectors = Object.freeze({
  loginForm: 'input[name="session_key"], input[name="session_password"], form[action*="login"]',
  profileRoot: "main, body",
  connectButtonText: "connect",
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
