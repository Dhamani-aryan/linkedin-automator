import { randomUUID } from "node:crypto";
import {
  attach,
  checkLinkedInAuth,
  closeTab,
  launch,
  listTabs,
  openTab
} from "./browserSession.js";
import { executeConnectionRequest } from "./actions/connectionRequest.js";
import { executeMessage } from "./actions/message.js";
import { AppError, ErrorCodes } from "./errors.js";
import {
  createCampaignRun,
  followUpSchedule,
  isRunFinished,
  leadStates,
  remainingDelayMs,
  runStates,
  summarizeRun,
  transition,
  updatePendingActionDelays,
  validateLiveRun,
  validateRun
} from "./runModel.js";
import {
  appendAudit,
  findLatestResumableRun,
  findSentActionMatches,
  listRuns,
  loadRun,
  readAudit,
  recoverInterruptedRuns,
  saveRun
} from "./runStore.js";
import { checkSafetyGate, randomizedDelayMs } from "./safetyPolicy.js";

const authCacheMs = 10 * 60_000;
const acceptanceRecheckMs = 4 * 60 * 60_000;

let activeRunId = null;
let controlWake = null;
let authCache = null;

export async function initializeRunner() {
  const recovered = await recoverInterruptedRuns();
  const recoveredRun = recovered
    .filter((candidate) => [runStates.RUNNING, runStates.PAUSED, runStates.NEEDS_ATTENTION].includes(candidate.state))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  const run = recoveredRun ?? await findLatestResumableRun();
  if (!run) return;

  if ([runStates.NEEDS_ATTENTION, runStates.STOPPED].includes(run.state)) {
    activeRunId = run.id;
    return;
  }
  scheduleRunLoop(run);
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
  if (mode === "live") {
    const sentMatches = await findSentActionMatches(snapshot);
    if (sentMatches.length > 0) {
      const deliveryLabel = sentMatches.length === 1 ? "delivery was" : "deliveries were";
      return {
        ok: false,
        validationFailures: [{
          field: "leads",
          code: "DUPLICATE_LIVE_DELIVERY",
          message: `${sentMatches.length} selected lead/action ${deliveryLabel} already sent in this campaign. Duplicate live start blocked.`,
          detail: { matches: sentMatches }
        }]
      };
    }
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
  scheduleRunLoop(run);

  return { ok: true, runId: run.id, run: decorateRun(run) };
}

export async function getCampaignRun(runId) {
  const run = await loadRun(runId);
  return decorateRun(run);
}

export async function getActiveCampaignRun() {
  if (activeRunId === null) {
    const resumable = await findLatestResumableRun();
    if (!resumable) return { ok: true, run: null };
    activeRunId = resumable.id;
  }
  return { ok: true, run: await getCampaignRun(activeRunId) };
}

export async function listCampaignRuns(profileId) {
  const runs = (await listRuns())
    .filter((run) => !profileId || run.profileId === profileId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return { ok: true, runs: runs.map(decorateRun) };
}

export async function stopCampaignRun(runId) {
  const run = await loadRun(runId);
  if ([runStates.COMPLETED, runStates.FAILED, runStates.STOPPED].includes(run.state)) {
    return { ok: true, run: decorateRun(run) };
  }
  if (run.state === runStates.NEEDS_ATTENTION) {
    run.stopRequested = true;
    return await finalizeStopped(run);
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

export async function resumeCampaignRun(runId, proposedActions = []) {
  let run = await loadRun(runId);
  if (![runStates.PAUSED, runStates.STOPPED].includes(run.state)) {
    return { ok: true, run: decorateRun(run) };
  }
  const restarting = run.state === runStates.STOPPED;
  if (restarting && run.leads.some((lead) => lead.state === leadStates.NEEDS_REVIEW)) {
    run.stopRequested = false;
    run.state = runStates.NEEDS_ATTENTION;
    run.updatedAt = new Date().toISOString();
    await saveRun(run);
    activeRunId = run.id;
    return { ok: true, run: decorateRun(run) };
  }
  const delayUpdate = updatePendingActionDelays(run, proposedActions);
  run = delayUpdate.run;
  for (const update of delayUpdate.updates) {
    await appendAudit(run.id, {
      event: "workflow_delay_updated",
      actionId: update.actionId,
      outcome: "ok",
      detail: update
    });
  }
  run.pauseRequested = false;
  run.stopRequested = false;
  run.stopReason = null;
  run.state = runStates.RUNNING;
  run.updatedAt = new Date().toISOString();
  await appendAudit(run.id, { event: restarting ? "run_restarted" : "run_resumed", outcome: "running" });
  await saveRun(run);
  if (restarting || activeRunId !== run.id) {
    scheduleRunLoop(run);
  } else {
    controlWake?.();
  }
  return { ok: true, run: decorateRun(run) };
}

export async function retryCampaignRun(runId) {
  if (activeRunId !== null && activeRunId !== runId) {
    throw new AppError("ACTIVE_RUN_EXISTS", "Another campaign run is already active.", { activeRunId });
  }

  const run = await loadRun(runId);
  if (run.state !== runStates.NEEDS_ATTENTION) {
    throw new AppError("RUN_NOT_RETRYABLE", "Only a run that needs attention can retry its current lead.");
  }

  const leadIndex = run.leads.findIndex((lead) => lead.state === leadStates.NEEDS_REVIEW && isSafeToRetry(lead));
  if (leadIndex < 0) {
    throw new AppError(
      "RUN_RETRY_UNSAFE",
      "This action cannot be retried because Send may already have been clicked or the existing draft is unknown."
    );
  }

  const now = new Date().toISOString();
  const lead = transition(run.leads[leadIndex], { type: "RETRY", now }, run.snapshot.actions);
  run.leads[leadIndex] = lead;
  run.retryLeadId = lead.id;
  run.state = runStates.RUNNING;
  run.updatedAt = now;
  await appendAudit(run.id, {
    event: "retry_requested",
    leadId: lead.id,
    actionId: run.snapshot.actions[lead.actionCursor]?.id,
    outcome: "running"
  });
  await saveRun(run);
  scheduleRunLoop(run);
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
    run = await reconcileFollowUpDelays(run);

    const now = new Date();
    const selected = pickNextLead(run, now);
    if (selected === null) {
      await sleepRunUntilNextLead(run, now);
      continue;
    }

    const action = run.snapshot.actions[selected.lead.actionCursor];
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
    const actionRun = await loadRun(run.id);
    if (actionRun.state === runStates.NEEDS_ATTENTION) return;
    if (isRunFinished(actionRun)) continue;
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

  const existingTab = run.retryLeadId === lead.id
    ? await findOpenProfileTab(lead.lead.linkedinUrl)
    : null;
  const tab = existingTab ?? await openTab("about:blank");
  const session = await attach(tab.id);
  let keepProfileTabOpen = false;
  try {
    const result = await executeAction({
      session,
      lead: lead.lead,
      action,
      mode: run.mode,
      reuseCurrentPage: existingTab !== null,
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
        type: "PAUSED",
        outcome: result.outcome,
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
      const completedAt = new Date().toISOString();
      lead = transition(lead, {
        type: "ACTION_SUCCEEDED",
        outcome: result.outcome,
        detail: result.detail,
        now: completedAt
      }, run.snapshot.actions);
      const schedule = followUpSchedule(lead, run.snapshot.actions);
      if (schedule) {
        lead = transition(lead, {
          type: "WAITING_DELAY",
          actionId: schedule.actionId,
          nextEligibleAt: schedule.dueAt,
          now: completedAt
        }, run.snapshot.actions);
        await appendAudit(run.id, {
          event: "workflow_delay_scheduled",
          leadId: lead.id,
          actionId: schedule.actionId,
          outcome: "sleeping",
          detail: schedule
        });
      }
    }

    run.leads[leadIndex] = lead;
    delete run.retryLeadId;
    run.updatedAt = new Date().toISOString();
    await saveRun(run);
  } finally {
    session.close();
    if (tab?.id && !keepProfileTabOpen) await closeTab(tab.id).catch(() => false);
  }
}

async function reconcileFollowUpDelays(run) {
  let changed = false;
  for (const [index, lead] of run.leads.entries()) {
    if (![leadStates.QUEUED, leadStates.WAITING_DELAY].includes(lead.state)) continue;
    const schedule = followUpSchedule(lead, run.snapshot.actions);
    if (!schedule || (lead.state === leadStates.WAITING_DELAY && lead.nextEligibleAt === schedule.dueAt)) continue;

    run.leads[index] = transition(lead, {
      type: "WAITING_DELAY",
      actionId: schedule.actionId,
      nextEligibleAt: schedule.dueAt,
      now: new Date().toISOString()
    }, run.snapshot.actions);
    await appendAudit(run.id, {
      event: "workflow_delay_reconciled",
      leadId: lead.id,
      actionId: schedule.actionId,
      outcome: "sleeping",
      detail: schedule
    });
    changed = true;
  }

  if (!changed) return run;
  run.updatedAt = new Date().toISOString();
  await saveRun(run);
  return run;
}

function scheduleRunLoop(run) {
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
}

function isSafeToRetry(lead) {
  const attempt = lead.attempts.at(-1);
  if (attempt?.errorCode === ErrorCodes.ELEMENT_NOT_FOUND) return true;
  return attempt?.errorCode === ErrorCodes.AMBIGUOUS_OUTCOME &&
    attempt.detail?.reason === "The composer text did not exactly match the resolved template. Send was not clicked.";
}

async function findOpenProfileTab(linkedinUrl) {
  const expectedUrl = normalizeProfileUrl(linkedinUrl);
  const tabs = await listTabs();
  return tabs.find((tab) => tab.type === "page" && normalizeProfileUrl(tab.url) === expectedUrl) ?? null;
}

function normalizeProfileUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
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
    if (lead.nextEligibleAt && remainingDelayMs(lead.nextEligibleAt, now) > 0) continue;
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

  const tab = await openTab("about:blank");
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
  run.pauseRequested = false;
  run.sleepingUntil = null;
  run.sleepingReason = null;
  run.stoppedAt = now;
  run.updatedAt = now;
  await appendAudit(run.id, { event: "run_stopped", outcome: "stopped" });
  await saveRun(run);
  if (activeRunId === run.id) activeRunId = null;
  return { ok: true, run: decorateRun(run) };
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
  await interruptibleSleep(runId, remainingDelayMs(iso));
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
