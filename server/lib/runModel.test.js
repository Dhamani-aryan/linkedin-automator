import { describe, expect, it } from "vitest";
import {
  createCampaignRun,
  leadStates,
  runStates,
  transition,
  validateRun
} from "./runModel.js";

const safety = {
  dailyActionLimit: 100,
  dailyInviteLimit: 30,
  minDelaySeconds: 5,
  maxDelaySeconds: 10,
  batchSize: 5,
  cooldownAfterBatchMinutes: 15,
  workingHoursStart: "09:00",
  workingHoursEnd: "17:00"
};

const lead = {
  id: "lead-1",
  linkedinUrl: "https://www.linkedin.com/in/example",
  displayName: "Example Lead",
  firstName: "Example",
  lastName: "Lead",
  company: "Acme",
  position: "Founder",
  location: "Remote",
  status: "to_process"
};

const actions = [
  {
    id: "connect",
    type: "connection_request",
    automatic: false,
    template: "Hi {firstName}"
  },
  {
    id: "connect-wait",
    type: "wait_for_acceptance",
    automatic: true
  },
  {
    id: "message",
    type: "message",
    automatic: false,
    template: "Hi {unknown}",
    delay: { amount: 1, unit: "days" }
  },
  {
    id: "message-reply",
    type: "reply_check",
    automatic: true
  }
];

describe("validateRun", () => {
  it("accepts a valid snapshot", () => {
    const failures = validateRun({
      profileId: "profile-1",
      campaign: { id: "campaign-1" },
      actions: actions.map((action) =>
        action.id === "message" ? { ...action, template: "Hi {company}" } : action
      ),
      leads: [lead],
      safety
    });

    expect(failures).toEqual([]);
  });

  it("reports unknown template variables", () => {
    const failures = validateRun({
      profileId: "profile-1",
      campaign: { id: "campaign-1" },
      actions,
      leads: [lead],
      safety
    });

    expect(failures).toContainEqual(expect.objectContaining({
      code: "UNKNOWN_TEMPLATE_VARIABLE",
      detail: { variable: "unknown" }
    }));
  });

  it("requires safety limits", () => {
    const failures = validateRun({
      profileId: "profile-1",
      campaign: { id: "campaign-1" },
      actions: [actions[0]],
      leads: [lead]
    });

    expect(failures).toContainEqual(expect.objectContaining({ code: "MISSING_SAFETY" }));
  });
});

describe("transition", () => {
  it("moves a dry-run connection request into acceptance waiting", () => {
    const run = createCampaignRun({
      runId: "run-1",
      snapshot: {
        profileId: "profile-1",
        campaign: { id: "campaign-1" },
        actions,
        leads: [lead],
        safety
      },
      mode: "dry_run",
      now: new Date("2026-08-09T10:00:00.000Z")
    });
    expect(run.state).toBe(runStates.VALIDATING);

    const runningLead = transition(run.leads[0], {
      type: "ACTION_STARTED",
      actionId: "connect",
      now: "2026-08-09T10:00:01.000Z"
    }, actions);
    const waitingLead = transition(runningLead, {
      type: "WAITING_ACCEPTANCE",
      nextEligibleAt: "2026-08-10T10:00:01.000Z",
      outcome: "dry_run_ok",
      now: "2026-08-09T10:00:02.000Z"
    }, actions);

    expect(waitingLead.state).toBe(leadStates.WAITING_ACCEPTANCE);
    expect(waitingLead.attempts[0]).toMatchObject({
      actionId: "connect",
      outcome: "dry_run_ok",
      completedAt: "2026-08-09T10:00:02.000Z"
    });
  });

  it("throws on illegal completion without a started attempt", () => {
    const run = createCampaignRun({
      runId: "run-1",
      snapshot: {
        profileId: "profile-1",
        campaign: { id: "campaign-1" },
        actions,
        leads: [lead],
        safety
      },
      mode: "dry_run"
    });

    expect(() => transition(run.leads[0], { type: "ACTION_SUCCEEDED" }, actions)).toThrow(/Illegal transition/);
  });
});
