import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template.js";

const lead = {
  id: "lead-1",
  firstName: "Taylor",
  lastName: "Example",
  displayName: "Taylor Example",
  company: "Example Engines",
  position: "Mathematician",
  location: "London"
};

describe("renderTemplate", () => {
  it("resolves known lead variables", () => {
    expect(renderTemplate("Hi {firstName} from {company}", lead)).toEqual({
      text: "Hi Taylor from Example Engines",
      missing: []
    });
  });

  it("can keep or blank unknown variables", () => {
    expect(renderTemplate("Hi {unknown}", lead)).toEqual({
      text: "Hi {unknown}",
      missing: ["unknown"]
    });
    expect(renderTemplate("Hi {unknown}", lead, { missingVariable: "empty" })).toEqual({
      text: "Hi ",
      missing: ["unknown"]
    });
  });
});
