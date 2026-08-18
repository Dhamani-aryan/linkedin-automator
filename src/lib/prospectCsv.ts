import type { LeadProfile, LeadSource } from "../types";

const headers = [
  "Record ID",
  "First Name",
  "Last Name",
  "Full Name",
  "Job Title",
  "Headline",
  "Company Name",
  "Personal LinkedIn URL",
  "Company LinkedIn URL",
  "Sales Navigator URL",
  "Location",
  "Industry",
  "Email",
  "Phone",
  "Website",
  "About",
  "Connection Degree",
  "Public Identifier",
  "Campaign Name",
  "Lead Status",
  "Source Name",
  "Source Type",
  "Source URL",
  "Added At"
] as const;

type ProspectCsvInput = {
  campaignName: string;
  leads: LeadProfile[];
  sources: LeadSource[];
};

export function buildProspectCsv({ campaignName, leads, sources }: ProspectCsvInput) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const rows: Array<Array<string>> = [
    [...headers],
    ...leads.map((lead) => {
      const source = sourceById.get(lead.sourceId);
      return [
        lead.id,
        lead.firstName,
        lead.lastName,
        fullName(lead),
        lead.position,
        lead.headline ?? "",
        lead.company,
        lead.linkedinUrl,
        lead.companyLinkedinUrl ?? "",
        lead.salesNavigatorUrl ?? "",
        lead.location,
        lead.industry ?? "",
        lead.email ?? "",
        lead.phone ?? "",
        lead.website ?? "",
        lead.about ?? "",
        lead.connectionDegree ?? "",
        lead.publicId ?? publicIdentifier(lead.linkedinUrl),
        campaignName,
        lead.status,
        source?.name ?? "Imported list",
        source?.kind ?? "",
        source?.sourceUrl ?? "",
        lead.addedAt
      ];
    })
  ];

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function prospectCsvFilename(campaignName: string, date = new Date()) {
  const safeName = campaignName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "campaign";
  return `${safeName}-prospects-${date.toISOString().slice(0, 10)}.csv`;
}

function fullName(lead: LeadProfile) {
  const fromParts = `${lead.firstName} ${lead.lastName}`.trim();
  return fromParts || (lead.displayName === "LinkedIn profile" ? "" : lead.displayName);
}

function publicIdentifier(value: string) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/in\/([^/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
