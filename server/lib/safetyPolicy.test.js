import { describe, expect, it } from "vitest";
import {
  checkBatchCooldown,
  checkDailyCaps,
  checkWorkingWindow,
  randomizedDelayMs
} from "./safetyPolicy.js";

const safety = {
  dailyActionLimit: 3,
  dailyInviteLimit: 2,
  minDelaySeconds: 10,
  maxDelaySeconds: 20,
  batchSize: 2,
  cooldownAfterBatchMinutes: 30,
  workingHoursStart: "09:00",
  workingHoursEnd: "17:00"
};

describe("safetyPolicy", () => {
  it("blocks outside same-day working hours", () => {
    const result = checkWorkingWindow(
      safety,
      new Date("2026-08-09T02:00:00.000Z"),
      "UTC"
    );

    expect(result).toMatchObject({
      allowed: false,
      reason: "outside_working_hours",
      sleepingUntil: "2026-08-09T09:00:00.000Z"
    });
  });

  it("allows overnight windows around midnight", () => {
    const result = checkWorkingWindow(
      { ...safety, workingHoursStart: "22:00", workingHoursEnd: "02:00" },
      new Date("2026-08-09T23:30:00.000Z"),
      "UTC"
    );

    expect(result.allowed).toBe(true);
  });

  it("counts rolling daily invite caps from audit entries", () => {
    const audit = [
      { ts: "2026-08-09T09:00:00.000Z", outcome: "sent", detail: { actionType: "connection_request" } },
      { ts: "2026-08-09T10:00:00.000Z", outcome: "sent", detail: { actionType: "connection_request" } },
      { ts: "2026-08-08T08:59:00.000Z", outcome: "sent", detail: { actionType: "connection_request" } }
    ];

    const result = checkDailyCaps(safety, audit, "connection_request", new Date("2026-08-09T10:30:00.000Z"));

    expect(result).toMatchObject({
      allowed: false,
      reason: "daily_invite_limit_reached",
      sleepingUntil: "2026-08-10T09:00:01.000Z"
    });
  });

  it("enforces batch cooldown after the batch boundary", () => {
    const audit = [
      { ts: "2026-08-09T09:00:00.000Z", outcome: "sent", detail: { actionType: "message" } },
      { ts: "2026-08-09T09:05:00.000Z", outcome: "sent", detail: { actionType: "message" } }
    ];

    const result = checkBatchCooldown(safety, audit, new Date("2026-08-09T09:10:00.000Z"));

    expect(result).toMatchObject({
      allowed: false,
      reason: "batch_cooldown",
      sleepingUntil: "2026-08-09T09:35:00.000Z"
    });
  });

  it("keeps randomized delay within bounds", () => {
    expect(randomizedDelayMs(safety, () => 0)).toBe(10_000);
    expect(randomizedDelayMs(safety, () => 1)).toBe(20_000);
  });
});
