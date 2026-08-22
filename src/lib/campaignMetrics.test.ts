import { describe, expect, it } from "vitest";
import type { CampaignRun } from "../types";
import { campaignListMetrics } from "./campaignMetrics";

describe("campaignListMetrics", () => {
  it("summarizes Linked Helper-style profile outcomes across campaign runs", () => {
    const run = {
      updatedAt: "2026-08-22T16:20:00.000Z",
      snapshot: {
        campaign: { id: "campaign-1" },
        actions: [
          { id: "invite", type: "connection_request" },
          { id: "message", type: "message" }
        ]
      },
      leads: [
        {
          id: "lead-1",
          lead: { linkedinUrl: "https://www.linkedin.com/in/one" },
          state: "replied",
          acceptedAt: "2026-08-22T16:10:00.000Z",
          attempts: [
            { actionId: "invite", completedAt: "2026-08-22T16:05:00.000Z", outcome: "sent", errorCode: null, detail: { actionType: "connection_request" } },
            { actionId: "message", completedAt: "2026-08-22T16:15:00.000Z", outcome: "sent", errorCode: null, detail: { actionType: "message" } },
            { actionId: "message", completedAt: "2026-08-22T16:20:00.000Z", outcome: "replied", errorCode: null, detail: { actionType: "reply_check" } }
          ]
        },
        {
          id: "lead-2",
          lead: { linkedinUrl: "https://www.linkedin.com/in/two" },
          state: "waiting_delay",
          acceptedAt: null,
          attempts: [
            { actionId: "message", completedAt: "2026-08-22T16:18:00.000Z", outcome: "sent", errorCode: null, detail: { actionType: "message" } }
          ]
        },
        {
          id: "lead-3",
          lead: { linkedinUrl: "https://www.linkedin.com/in/three" },
          state: "failed",
          acceptedAt: null,
          attempts: [
            { actionId: "message", completedAt: "2026-08-22T16:19:00.000Z", outcome: "failed", errorCode: "SEND_FAILED", detail: { actionType: "message" } }
          ]
        }
      ]
    } as unknown as CampaignRun;

    expect(campaignListMetrics("campaign-1", [run])).toEqual({
      processing: 1,
      processed: 3,
      successful: 2,
      failed: 1,
      invited: 1,
      accepted: 1,
      messaged: 2,
      replied: 1
    });
  });

  it("uses only the latest run for the current processing count", () => {
    const older = minimalRun("2026-08-22T10:00:00.000Z", "waiting_delay");
    const latest = minimalRun("2026-08-22T11:00:00.000Z", "completed");

    expect(campaignListMetrics("campaign-1", [older, latest]).processing).toBe(0);
  });

  it("keeps needs-review outcomes separate from failed leads", () => {
    const run = minimalRun("2026-08-22T12:00:00.000Z", "completed");
    run.leads[0].state = "needs_review";
    run.leads[0].attempts = [{
      actionId: "message",
      attempt: 1,
      startedAt: "2026-08-22T11:59:59.000Z",
      completedAt: "2026-08-22T12:00:00.000Z",
      outcome: "needs_review",
      errorCode: "AMBIGUOUS_OUTCOME",
      detail: { actionType: "message" }
    }];

    expect(campaignListMetrics("campaign-1", [run]).failed).toBe(0);
  });
});

function minimalRun(updatedAt: string, state: "waiting_delay" | "completed") {
  return {
    updatedAt,
    snapshot: { campaign: { id: "campaign-1" }, actions: [] },
    leads: [{
      id: updatedAt,
      lead: { linkedinUrl: `https://www.linkedin.com/in/${updatedAt}` },
      state,
      acceptedAt: null,
      attempts: []
    }]
  } as unknown as CampaignRun;
}
