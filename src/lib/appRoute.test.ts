import { describe, expect, it } from "vitest";
import { readAppRoute, routeToHash } from "./appRoute";

describe("campaign routes", () => {
  it("reads and writes a LinkedIn profile campaign index", () => {
    const route = { kind: "campaigns", profileId: "profile / one" } as const;
    expect(routeToHash(route)).toBe("#/profiles/profile%20%2F%20one/campaigns");
    expect(readAppRoute(routeToHash(route))).toEqual(route);
  });

  it("reads and writes a campaign-specific workspace", () => {
    const route = {
      kind: "workspace",
      profileId: "profile-1",
      campaignId: "campaign-1",
      tab: "leads"
    } as const;
    expect(routeToHash(route)).toBe("#/workspace/profile-1/campaign-1/leads");
    expect(readAppRoute(routeToHash(route))).toEqual(route);
  });

  it("keeps old workspace links readable", () => {
    expect(readAppRoute("#/workspace/profile-1/safety")).toEqual({
      kind: "workspace",
      profileId: "profile-1",
      campaignId: undefined,
      tab: "safety"
    });
  });
});
