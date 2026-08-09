import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendAudit,
  createRunStore,
  loadRun,
  readAudit,
  recoverInterruptedRuns,
  saveRun
} from "./runStore.js";
import { leadStates, runStates } from "./runModel.js";

let tempDir = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function tempStore() {
  tempDir = await mkdtemp(join(tmpdir(), "linkedin-run-store-"));
  return createRunStore({ runsDir: tempDir });
}

describe("runStore", () => {
  it("writes and reads run state atomically", async () => {
    const store = await tempStore();
    const run = { id: "run_1", state: runStates.RUNNING, leads: [] };

    await saveRun(run, store);

    await expect(loadRun("run_1", store)).resolves.toEqual(run);
  });

  it("appends audit entries as NDJSON", async () => {
    const store = await tempStore();

    await appendAudit("run_1", { event: "started", leadId: "lead-1" }, store);
    await appendAudit("run_1", { event: "completed", outcome: "ok" }, store);

    expect(await readAudit("run_1", store)).toEqual([
      expect.objectContaining({ event: "started", leadId: "lead-1" }),
      expect.objectContaining({ event: "completed", outcome: "ok" })
    ]);
  });

  it("requires review when restart interrupts an in-flight attempt", async () => {
    const store = await tempStore();
    await saveRun({
      id: "run_1",
      state: runStates.RUNNING,
      leads: [
        {
          id: "lead-1",
          state: leadStates.RUNNING,
          attempts: [{ actionId: "connect", startedAt: "2026-08-09T10:00:00.000Z", completedAt: null }],
          nextEligibleAt: "2026-08-09T10:00:00.000Z"
        }
      ]
    }, store);

    const recovered = await recoverInterruptedRuns(store, new Date("2026-08-09T11:00:00.000Z"));

    expect(recovered[0]).toMatchObject({
      state: runStates.NEEDS_ATTENTION,
      leads: [{ state: leadStates.NEEDS_REVIEW, lastErrorCode: "CONTROLLER_RESTART_DURING_ATTEMPT" }]
    });
    await expect(loadRun("run_1", store)).resolves.toMatchObject({ state: runStates.NEEDS_ATTENTION });
  });

  it("resumes a sleeping run without changing its absolute due time", async () => {
    const store = await tempStore();
    await saveRun({
      id: "run_sleeping",
      state: runStates.SLEEPING,
      stopRequested: false,
      pauseRequested: false,
      sleepingUntil: "2026-08-09T11:00:00.000Z",
      leads: [{
        id: "lead-1",
        state: leadStates.WAITING_DELAY,
        attempts: [],
        nextEligibleAt: "2026-08-09T12:00:00.000Z"
      }]
    }, store);

    const [recovered] = await recoverInterruptedRuns(store, new Date("2026-08-09T10:30:00.000Z"));

    expect(recovered).toMatchObject({
      state: runStates.RUNNING,
      stopRequested: false,
      pauseRequested: false,
      sleepingUntil: null,
      leads: [{ state: leadStates.WAITING_DELAY, nextEligibleAt: "2026-08-09T12:00:00.000Z" }]
    });
  });

  it("keeps a paused run paused with its original due time", async () => {
    const store = await tempStore();
    await saveRun({
      id: "run_paused",
      state: runStates.PAUSED,
      stopRequested: false,
      pauseRequested: true,
      leads: [{
        id: "lead-1",
        state: leadStates.WAITING_DELAY,
        attempts: [],
        nextEligibleAt: "2026-08-09T12:00:00.000Z"
      }]
    }, store);

    const [recovered] = await recoverInterruptedRuns(store, new Date("2026-08-09T11:30:00.000Z"));

    expect(recovered).toMatchObject({
      state: runStates.PAUSED,
      pauseRequested: true,
      leads: [{ nextEligibleAt: "2026-08-09T12:00:00.000Z" }]
    });
  });
});
