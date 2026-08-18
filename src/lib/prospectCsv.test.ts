import { describe, expect, it } from "vitest";
import { buildProspectCsv, prospectCsvFilename } from "./prospectCsv";
import type { LeadProfile, LeadSource } from "../types";

const lead: LeadProfile = {
  id: "lead-1",
  linkedinUrl: "https://www.linkedin.com/in/sample-founder/",
  displayName: "Taylor Example",
  firstName: "Taylor",
  lastName: "Example",
  company: "Analytical, Engines Ltd.",
  position: "Founder",
  headline: "Founder & Mathematician",
  companyLinkedinUrl: "https://www.linkedin.com/company/example-engines/",
  location: "London, United Kingdom",
  about: "Builds \"thinking machines\"\nwith careful notes.",
  sourceId: "source-1",
  status: "accepted",
  addedAt: "2026-08-18T10:00:00.000Z"
};

const source: LeadSource = {
  id: "source-1",
  kind: "sales_navigator",
  name: "UK founders",
  sourceUrl: "https://www.linkedin.com/sales/search/people",
  profileCount: 1,
  createdAt: "2026-08-18T09:00:00.000Z"
};

describe("prospect CSV", () => {
  it("exports CRM fields and safely quotes commas, quotes, and newlines", () => {
    const csv = buildProspectCsv({ campaignName: "Founder outreach", leads: [lead], sources: [source] });

    expect(csv.startsWith("\uFEFFRecord ID,First Name,Last Name")).toBe(true);
    expect(csv).toContain('"Analytical, Engines Ltd."');
    expect(csv).toContain('"Builds ""thinking machines""\nwith careful notes."');
    expect(csv).toContain("https://www.linkedin.com/company/example-engines/");
    expect(csv).toContain(",sample-founder,Founder outreach,accepted,UK founders,sales_navigator,");
  });

  it("creates a stable dated filename", () => {
    expect(prospectCsvFilename("  Founder / UK Outreach  ", new Date("2026-08-18T12:00:00.000Z")))
      .toBe("founder-uk-outreach-prospects-2026-08-18.csv");
  });
});
