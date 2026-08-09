import { randomUUID } from "node:crypto";
import {
  attach,
  checkLinkedInAuth,
  closeTab,
  launch,
  openTab
} from "./browserSession.js";
import { executeConnectionRequest } from "./actions/connectionRequest.js";
import { executeMessage } from "./actions/message.js";
import { AppError, ErrorCodes } from "./errors.js";
import {
  createCampaignRun,
  delayToMs,
  isRunFinished,
  leadStates,
  runStates,
  summarizeRun,
  transition,
  validateLiveRun,
  validateRun
} from "./runModel.js";
import { appendAudit, loadRun, readAudit, recoverInterruptedRuns, saveRun } from "./runStore.js";
import { checkSafetyGate, randomizedDelayMs } from "./safetyPolicy.js";

const authCacheMs = 10 * 60_000;
const acceptanceRecheckMs = 4 * 60 * 60_000;

let activeRunId = null;
let controlWake = null;
let authCache = null;

export async function initializeRunner() {
  await recoverInterruptedRuns();
}

export async function startCampaignRun(snapshot) {
  const mode = snapshot.mode === "live" ? "live" : "dry_run";

  if (activeRunId !== null) {
    throw new AppError("ACTIVE_RUN_EXISTS", "A campaign run is already active.", { activeRunId });
  }

  const validationFailures = [
    ...validateRun(snapshot),
    ...validateLiveRun({ ...snapshot, mode })
  ];
  if (validationFailures.length > 0) {
    return { ok: false, validationFailures };
  }

  const run = {
    ...createCampaignRun({
      runId: randomUUID(),
      snapshot,
      mode,
      now: new Date()
    }),
    state: runStates.RUNNING,
    validationFailures: []
  };

  await saveRun(run);
  await appendAudit(run.id, { event: "run_started", outcome: "ok", detail: { mode } });
  activeRunId = run.id;
  void runLoop(run.id).catch(async (error) => {
    const failedRun = await loadRun(run.id).catch(() => run);
    if (failedRun.state === runStates.NEEDS_ATTENTION) {
      await appendAudit(run.id, {
        event: "run_paused",
        outcome: "needs_attention",
        errorCode: error instanceof AppError ? error.code : "RUNNER_NEEDS_ATTENTION",
        detail: { message: error instanceof Error ? error.message : "Runner paused." }
      });
      await saveRun(failedRun);
      return;
    }
    failedRun.state = runStates.FAILED;
    failedRun.updatedAt = new Date().toISOString();
    await appendAudit(run.id, {
      event: "run_failed",
      outcome: "failed",
      errorCode: error instanceof AppError ? error.code : "RUNNER_ERROR",
      detail: { message: error instanceof Error ? error.message : "Runner failed." }
    });
    await saveRun(failedRun);
    if (activeRunId === run.id) activeRunId = null;
  });

  return { ok: true, runId: run.id, run: decorateRun(run) };
}

export async function getCampaignRun(runId) {
  const run = await loadRun(runId);
  return decorateRun(run);
}

export async function getActiveCampaignRun() {
  if (activeRunId === null) return { ok: true, run: null };
  return { ok: true, run: await getCampaignRun(activeRunId) };
}

export async function stopCampaignRun(runId) {
  const run = await loadRun(runId);
  if ([runStates.COMPLETED, runStates.FAILED, runStates.STOPPED].includes(run.state)) {
    return { ok: true, run: decorateRun(run) };
  }
  run.stopRequested = true;
  run.state = runStates.STOPPING;
  run.updatedAt = new Date().toISOString();
  await appendAudit(run.id, { event: "stop_requested", outcome: "ok" });
  await saveRun(run);
  controlWake?.();
  return { ok: true, run: decorateRun(run) };
}

export async function pauseCampaignRun(runId) {
  const run = await loadRun(runId);
  if ([runStates.COMPLETED, runStates.FAILED, runStates.STOPPED].includes(run.state)) {
    return { ok: true, run: decorateRun(run) };
  }
  if (run.state === runStates.NEEDS_ATTENTION) {
    throw new AppError("RUN_NEEDS_ATTENTION", "Resolve the run issue before pausing or resuming it.");
  }
  if (run.pauseRequested && run.state === runStates.PAUSED) {
    return { ok: true, run: decorateRun(run) };
  }
  run.pauseRequested = true;
  run.state = runStates.PAUSED;
  run.sleepingUntil = null;
  run.sleepingReason = null;
  run.updatedAt = new Date().toISOString();
  await appendAudit(run.id, { event: "pause_requested", outcome: "paused" });
  await saveRun(run);
  controlWake?.();
  return { ok: true, run: decorateRun(run) };
}

export async function resumeCampaignRun(runId) {
  const run = await loadRun(runId);
  if (run.state !== runStates.PAUSED || !run.pauseRequested) {
    return { ok: true, run: decorateRun(run) };
  }
  run.pauseRequested = false;
  run.state = runStates.RUNNING;
  run.updatedAt = new Date().toISOString();
  await appendAudit(run.id, { event: "run_resumed", outcome: "running" });
  await saveRun(run);
  controlWake?.();
  return { ok: true, run: decorateRun(run) };
}

async function runLoop(runId) {
  await launch("https://www.linkedin.com/feed/");

  while (true) {
    let run = await loadRun(runId);
    if (run.stopRequested) {
      await finalizeStopped(run);
      return;
    }

    if (run.pauseRequested) {
      await waitWhilePaused(run.id);
      continue;
    }

    if (isRunFinished(run)) {
      run.state = runStates.COMPLETED;
      run.sleepingUntil = null;
      run.sleepingReason = null;
      run.updatedAt = new Date().toISOString();
      await appendAudit(run.id, { event: "run_completed", outcome: "ok" });
      await saveRun(run);
      if (activeRunId === run.id) activeRunId = null;
      return;
    }

    await ensureAuthenticated(run);
    run = await loadRun(runId);

    const now = new Date();
    const selected = pickNextLead(run, now);
    if (selected === null) {
      await sleepRunUntilNextLead(run, now);
      continue;
    }

    const action = run.snapshot.actions[selected.lead.actionCursor];
    const delayMs = action.type === "message" ? delayToMs(action.delay) : 0;
    if (
      selected.lead.state === leadStates.QUEUED &&
      delayMs > 0 &&
      !selected.lead.delaysSatisfiedActionIds?.includes(action.id)
    ) {
      selected.lead = transition(selected.lead, {
        type: "WAITING_DELAY",
        actionId: action.id,
        nextEligibleAt: new Date(now.getTime() + delayMs).toISOString(),
        now: now.toISOString()
      }, run.snapshot.actions);
      run.leads[selected.index] = selected.lead;
      await appendAudit(run.id, {
        event: "workflow_delay_scheduled",
        leadId: selected.lead.id,
        actionId: action.id,
        outcome: "sleeping",
        detail: { delayMs }
      });
      await saveRun({ ...run, state: runStates.RUNNING, updatedAt: new Date().toISOString() });
      continue;
    }

    if (selected.lead.state === leadStates.WAITING_DELAY) {
      selected.lead = transition(selected.lead, {
        type: "DELAY_ELAPSED",
        actionId: action.id,
        now: now.toISOString()
      }, run.snapshot.actions);
      run.leads[selected.index] = selected.lead;
      await saveRun({ ...run, updatedAt: new Date().toISOString() });
    }

    const auditEntries = await readAudit(run.id);
    const safety = checkSafetyGate(run.snapshot.safety, auditEntries, action.type, new Date(), run.snapshot.safety.timeZone);
    if (!safety.allowed) {
      run.state = runStates.SLEEPING;
      run.sleepingUntil = safety.sleepingUntil;
      run.sleepingReason = safety.reason;
      run.updatedAt = new Date().toISOString();
      await appendAudit(run.id, { event: "safety_sleep", outcome: "sleeping", detail: safety });
      await saveRun(run);
      await interruptibleSleepUntil(run.id, safety.sleepingUntil);
      continue;
    }

    await executeLeadAction(run, selected.index, action);
    await interruptibleSleep(run.id, randomizedDelayMs(run.snapshot.safety));
  }
}

async function executeLeadAction(run, leadIndex, action) {
  let lead = run.leads[leadIndex];
  lead = transition(lead, {
    type: "ACTION_STARTED",
    actionId: action.id,
    now: new Date().toISOString()
  }, run.snapshot.actions);
  run.leads[leadIndex] = lead;
  run.state = runStates.RUNNING;
  run.sleepingUntil = null;
  run.sleepingReason = null;
  run.updatedAt = new Date().toISOString();
  await appendAudit(run.id, {
    leadId: lead.id,
    actionId: action.id,
    attempt: lead.attempts.at(-1)?.attempt,
    event: "action_started",
    outcome: "started",
    detail: { actionType: action.type }
  });
  await saveRun(run);

  const tab = await openTab(lead.lead.linkedinUrl);
  const session = await attach(tab.id);
  let keepProfileTabOpen = false;
  try {
    const result = await executeAction({
      session,
      lead: lead.lead,
      action,
      mode: run.mode,
      shouldStop: async () => (await loadRun(run.id)).stopRequested,
      shouldPause: async () => (await loadRun(run.id)).pauseRequested
    });
    keepProfileTabOpen = Boolean(result.errorCode && !result.stopped);
    if (keepProfileTabOpen) {
      result.detail = {
        ...result.detail,
        profileTabKeptOpen: true
      };
    }
    await appendAudit(run.id, {
      leadId: lead.id,
      actionId: action.id,
      attempt: lead.attempts.at(-1)?.attempt,
      event: result.event ?? "action_completed",
      outcome: result.outcome,
      errorCode: result.errorCode ?? null,
      detail: result.detail
    });

    if (result.stopped) {
      lead = transition(lead, {
        type: "STOPPED",
        outcome: result.outcome,
        errorCode: result.errorCode,
        detail: result.detail,
        now: new Date().toISOString()
      }, run.snapshot.actions);
      run.stopRequested = true;
      run.state = runStates.STOPPING;
    } else if (result.paused) {
      lead = transition(lead, {
        type: "PAUSED",
        outcome: result.outcome,
        detail: result.detail,
        now: new Date().toISOString()
      }, run.snapshot.actions);
      run.pauseRequested = true;
      run.state = runStates.PAUSED;
    } else if (result.errorCode) {
      lead = transition(lead, {
        type: "NEEDS_REVIEW",
        outcome: result.outcome,
        errorCode: result.errorCode,
        detail: result.detail,
        now: new Date().toISOString()
      }, run.snapshot.actions);
      run.state = runStates.NEEDS_ATTENTION;
    } else if (action.type === "connection_request") {
      lead = transition(lead, {
        type: "WAITING_ACCEPTANCE",
        outcome: result.outcome,
        detail: result.detail,
        nextEligibleAt: new Date(Date.now() + acceptanceRecheckMs).toISOString(),
        now: new Date().toISOString()
      }, run.snapshot.actions);
    } else {
      lead = transition(lead, {
        type: "ACTION_SUCCEEDED",
        outcome: result.outcome,
        detail: result.detail,
        now: new Date().toISOString()
      }, run.snapshot.actions);
    }

    run.leads[leadIndex] = lead;
    run.updatedAt = new Date().toISOString();
    await saveRun(run);
  } finally {
    session.close();
    if (tab?.id && !keepProfileTabOpen) await closeTab(tab.id).catch(() => false);
  }
}

async function executeAction(args) {
  if (args.action.type === "connection_request") return await executeConnectionRequest(args);
  if (args.action.type === "message") return await executeMessage(args);
  return {
    outcome: "needs_review",
    errorCode: ErrorCodes.LAYOUT_MISMATCH,
    detail: { reason: `Unsupported action type ${args.action.type}` }
  };
}

function pickNextLead(run, now) {
  const eligibleStates = new Set([leadStates.QUEUED, leadStates.WAITING_DELAY]);
  for (const [index, lead] of run.leads.entries()) {
    if (!eligibleStates.has(lead.state)) continue;
    if (lead.nextEligibleAt && Date.parse(lead.nextEligibleAt) > now.getTime()) continue;
    if (lead.actionCursor >= run.snapshot.actions.length) continue;
    return { index, lead };
  }
  return null;
}

async function sleepRunUntilNextLead(run, now) {
  const nextTime = run.leads
    .filter((lead) => [leadStates.QUEUED, leadStates.WAITING_ACCEPTANCE, leadStates.WAITING_DELAY].includes(lead.state))
    .map((lead) => lead.nextEligibleAt)
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)[0];

  if (!nextTime) {
    await interruptibleSleep(run.id, 5_000);
    return;
  }

  run.state = runStates.SLEEPING;
  run.sleepingUntil = new Date(Math.max(nextTime, now.getTime() + 1000)).toISOString();
  run.sleepingReason = "waiting_for_next_eligible_lead";
  run.updatedAt = new Date().toISOString();
  await saveRun(run);
  await interruptibleSleepUntil(run.id, run.sleepingUntil);
}

async function ensureAuthenticated(run) {
  if (authCache && Date.now() - authCache.checkedAt < authCacheMs && authCache.ok) return;

  const tab = await openTab("https://www.linkedin.com/feed/");
  const session = await attach(tab.id);
  try {
    const auth = await checkLinkedInAuth(session);
    authCache = { ...auth, checkedAt: Date.now() };
    if (!auth.ok) {
      run.state = runStates.NEEDS_ATTENTION;
      run.updatedAt = new Date().toISOString();
      await appendAudit(run.id, {
        event: "auth_probe",
        outcome: "failed",
        errorCode: auth.errorCode,
        detail: auth
      });
      await saveRun(run);
      throw new AppError(auth.errorCode, "LinkedIn needs attention before the campaign can continue.", auth);
    }
    await appendAudit(run.id, { event: "auth_probe", outcome: "ok", detail: { state: auth.state } });
  } finally {
    session.close();
    if (tab?.id) await closeTab(tab.id).catch(() => false);
  }
}

async function finalizeStopped(run) {
  const now = new Date().toISOString();
  run.state = runStates.STOPPED;
  run.sleepingUntil = null;
  run.sleepingReason = null;
  run.updatedAt = now;
  run.leads = run.leads.map((lead) =>
    transition(lead, { type: "STOPPED", now }, run.snapshot.actions)
  );
  await appendAudit(run.id, { event: "run_stopped", outcome: "stopped" });
  await saveRun(run);
  if (activeRunId === run.id) activeRunId = null;
}

async function waitWhilePaused(runId) {
  while (true) {
    const run = await loadRun(runId);
    if (run.stopRequested || !run.pauseRequested) return;
    if (run.state !== runStates.PAUSED) {
      run.state = runStates.PAUSED;
      run.sleepingUntil = null;
      run.sleepingReason = null;
      run.updatedAt = new Date().toISOString();
      await saveRun(run);
    }
    await waitForControl(5_000);
  }
}

async function interruptibleSleepUntil(runId, iso) {
  await interruptibleSleep(runId, Math.max(0, Date.parse(iso) - Date.now()));
}

async function interruptibleSleep(runId, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const run = await loadRun(runId);
    if (run.stopRequested || run.pauseRequested) return;
    await waitForControl(Math.min(5_000, end - Date.now()));
  }
}

function waitForControl(timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    controlWake = () => {
      clearTimeout(timeout);
      controlWake = null;
      resolve();
    };
  });
}

function decorateRun(run) {
  return {
    ok: true,
    ...run,
    summary: summarizeRun(run)
  };
}
