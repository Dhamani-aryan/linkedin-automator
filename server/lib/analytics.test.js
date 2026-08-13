import { describe, expect, it } from "vitest";
import { aggregateCampaignEvents, analyticsEventTypes, getCampaignAnalytics } from "./analytics.js";

const baseEvent = {
  runId: "run-1",
  profileId: "profile-1",
  campaignId: "campaign-1",
  campaignName: "Founder outreach",
  leadId: "lead-1",
  actionId: "action-1",
  source: "campaign_runner"
};

describe("campaign analytics", () => {
  it("builds zero-filled daily series and rates in the selected timezone", () => {
    const result = aggregateCampaignEvents([
      { ...baseEvent, id: "invite", type: analyticsEventTypes.INVITATION_SENT, observedAt: "2026-08-09T18:45:00.000Z" },
      { ...baseEvent, id: "accepted", type: analyticsEventTypes.INVITATION_ACCEPTED, observedAt: "2026-08-10T01:00:00.000Z" },
      { ...baseEvent, id: "message", type: analyticsEventTypes.MESSAGE_SENT, observedAt: "2026-08-10T02:00:00.000Z" },
      { ...baseEvent, id: "reply", type: analyticsEventTypes.REPLY_RECEIVED, observedAt: "2026-08-10T04:00:00.000Z" }
    ], {
      from: "2026-08-09",
      to: "2026-08-11",
      timeZone: "Asia/Calcutta"
    });

    expect(result.totals).toMatchObject({
      invitesSent: 1,
      accepted: 1,
      messagesSent: 1,
      replies: 1,
      acceptanceRate: 100,
      replyRate: 100
    });
    expect(result.daily).toEqual([
      expect.objectContaining({ date: "2026-08-09", invitesSent: 0 }),
      expect.objectContaining({ date: "2026-08-10", invitesSent: 1, accepted: 1, messagesSent: 1, replies: 1 }),
      expect.objectContaining({ date: "2026-08-11", messagesSent: 0 })
    ]);
  });

  it("deduplicates events by durable identity", () => {
    const event = {
      ...baseEvent,
      id: "same-event",
      type: analyticsEventTypes.MESSAGE_SENT,
      observedAt: "2026-08-10T02:00:00.000Z"
    };
    const result = aggregateCampaignEvents([event, event], {
      from: "2026-08-10",
      to: "2026-08-10"
    });

    expect(result.totals.messagesSent).toBe(1);
  });

  it("reads only live runs for the requested profile and campaign", async () => {
    const runs = [
      { id: "live", mode: "live", profileId: "profile-1", snapshot: { campaign: { id: "campaign-1", name: "Live" } }, leads: [] },
      { id: "dry", mode: "dry_run", profileId: "profile-1", snapshot: { campaign: { id: "campaign-1", name: "Dry" } }, leads: [] },
      { id: "other", mode: "live", profileId: "profile-2", snapshot: { campaign: { id: "campaign-2", name: "Other" } }, leads: [] }
    ];
    const result = await getCampaignAnalytics({
      profileId: "profile-1",
      campaignId: "campaign-1",
      from: "2026-08-10",
      to: "2026-08-10"
    }, {
      listRuns: async () => runs,
      readAudit: async (runId) => [{
        ts: "2026-08-10T02:00:00.000Z",
        runId,
        event: analyticsEventTypes.MESSAGE_SENT,
        leadId: "lead-1",
        actionId: "message-1",
        attempt: 1,
        detail: null
      }]
    });

    expect(result.totals.messagesSent).toBe(1);
    expect(result.campaigns).toEqual([expect.objectContaining({ id: "campaign-1", name: "Live" })]);
  });
});
