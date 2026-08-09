export const templateVariables = Object.freeze({
  firstName: (lead) => lead.firstName ?? "",
  lastName: (lead) => lead.lastName ?? "",
  fullName: (lead) => `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim(),
  company: (lead) => lead.company ?? "",
  position: (lead) => lead.position ?? "",
  location: (lead) => lead.location ?? "",
  industry: () => "Information Technology",
  publicId: (lead) => lead.displayName ?? "",
  memberId: (lead) => lead.id ?? "",
  mutualTotal: () => 2,
  mutualFirstFullName: () => "Ernest Wesley",
  mutualSecondFullName: () => "John Clark"
});

export function renderTemplate(template, lead, { missingVariable = "keep_token" } = {}) {
  const missing = [];
  const rendered = template.replace(/\{([a-zA-Z0-9]+)\}/g, (match, key) => {
    const resolver = templateVariables[key];
    if (!resolver) {
      missing.push(key);
      return missingVariable === "empty" ? "" : match;
    }
    return String(resolver(lead));
  });

  return { text: rendered, missing };
}
