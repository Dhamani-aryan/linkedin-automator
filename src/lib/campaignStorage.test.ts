import { describe, expect, it } from "vitest";
import { createLeadFromUrl } from "./campaignStorage";

describe("createLeadFromUrl", () => {
  it("uses the collected profile name for personalization", () => {
    const lead = createLeadFromUrl(
      "https://www.linkedin.com/in/sample-recipient/",
      "source-1",
      "  Casey   Khandelwal  "
    );

    expect(lead.displayName).toBe("Casey Example");
    expect(lead.firstName).toBe("Casey");
    expect(lead.lastName).toBe("Khandelwal");
  });

  it("does not treat a profile URL slug as a person's name", () => {
    const lead = createLeadFromUrl("https://www.linkedin.com/in/sample-recipient/", "source-1");

    expect(lead.displayName).toBe("LinkedIn profile");
    expect(lead.firstName).toBe("");
    expect(lead.lastName).toBe("");
  });
});
