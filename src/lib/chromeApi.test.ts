import { describe, expect, it } from "vitest";
import { mergeResolvedProfileData } from "./chromeApi";
import type { LeadProfile } from "../types";

const lead: LeadProfile = {
  id: "lead-1",
  linkedinUrl: "https://www.linkedin.com/sales/lead/example",
  displayName: "Imported profile",
  firstName: "",
  lastName: "",
  company: "Imported Company",
  position: "Imported title",
  location: "",
  sourceId: "source-1",
  status: "to_process",
  addedAt: "2026-08-18T00:00:00.000Z"
};

describe("mergeResolvedProfileData", () => {
  it("merges non-empty enrichment fields and keeps imported fallbacks", () => {
    expect(mergeResolvedProfileData(lead, {
      id: lead.id,
      requestedUrl: lead.linkedinUrl,
      resolved: true,
      displayName: "Taylor Example",
      firstName: "Taylor",
      lastName: "Example",
      personalLinkedInUrl: "https://www.linkedin.com/in/sample-founder",
      position: "",
      company: "Example Engines",
      companyLinkedinUrl: "https://www.linkedin.com/company/example-engines",
      publicId: "sample-founder"
    })).toMatchObject({
      displayName: "Taylor Example",
      firstName: "Taylor",
      lastName: "Example",
      linkedinUrl: "https://www.linkedin.com/in/sample-founder",
      position: "Imported title",
      company: "Example Engines",
      companyLinkedinUrl: "https://www.linkedin.com/company/example-engines",
      publicId: "sample-founder"
    });
  });
});
