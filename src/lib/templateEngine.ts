import type { LeadProfile } from "../types";

export type TemplateVariable = {
  key: string;
  label: string;
  getValue: (lead: LeadProfile) => string | number;
};

export const templateVariables: TemplateVariable[] = [
  { key: "firstName", label: "First name", getValue: (lead) => lead.firstName },
  { key: "lastName", label: "Last name", getValue: (lead) => lead.lastName },
  { key: "fullName", label: "Full name", getValue: (lead) => `${lead.firstName} ${lead.lastName}` },
  { key: "company", label: "Company", getValue: (lead) => lead.company },
  { key: "position", label: "Position", getValue: (lead) => lead.position },
  { key: "location", label: "Location", getValue: (lead) => lead.location },
  { key: "industry", label: "Industry", getValue: () => "Information Technology" },
  { key: "publicId", label: "Public ID", getValue: (lead) => lead.displayName },
  { key: "memberId", label: "Member ID", getValue: (lead) => lead.id },
  { key: "mutualTotal", label: "Mutual count", getValue: () => 2 },
  { key: "mutualFirstFullName", label: "First mutual", getValue: () => "Ernest Wesley" },
  { key: "mutualSecondFullName", label: "Second mutual", getValue: () => "John Clark" }
];

export function renderTemplate(template: string, lead: LeadProfile): string {
  const variablesByKey = new Map(templateVariables.map((variable) => [variable.key, variable]));

  return template.replace(/\{([a-zA-Z0-9]+)\}/g, (match, key: string) => {
    const variable = variablesByKey.get(key);
    return variable === undefined ? match : String(variable.getValue(lead));
  });
}

export function insertVariable(template: string, variableKey: string): string {
  const token = `{${variableKey}}`;
  return template.endsWith(" ") || template.length === 0 ? `${template}${token}` : `${template} ${token}`;
}
