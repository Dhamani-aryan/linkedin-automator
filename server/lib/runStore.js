import { constants } from "node:fs";
import { access, appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { leadStates, runStates } from "./runModel.js";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultRunsDir = join(rootDir, ".local", "runs");

export function createRunStore({ runsDir = defaultRunsDir } = {}) {
  return {
    runsDir,
    getRunDir: (runId) => join(runsDir, safeRunId(runId)),
    getStatePath: (runId) => join(runsDir, safeRunId(runId), "state.json"),
    getAuditPath: (runId) => join(runsDir, safeRunId(runId), "audit.log")
  };
}

export async function saveRun(run, store = createRunStore()) {
  const statePath = store.getStatePath(run.id);
  await mkdir(dirname(statePath), { recursive: true });
  await atomicWriteJson(statePath, run);
  return run;
}

export async function loadRun(runId, store = createRunStore()) {
  const statePath = store.getStatePath(runId);
  const raw = await readFile(statePath, "utf8");
  return JSON.parse(raw);
}

export async function appendAudit(runId, entry, store = createRunStore()) {
  const auditPath = store.getAuditPath(runId);
  await mkdir(dirname(auditPath), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    runId,
    leadId: null,
    actionId: null,
    attempt: null,
    event: null,
    outcome: null,
    errorCode: null,
    detail: null,
    ...entry
  });
  await appendFile(auditPath, `${line}\n`, "utf8");
}

export async function readAudit(runId, store = createRunStore()) {
  const auditPath = store.getAuditPath(runId);
  if (!(await exists(auditPath))) return [];
  const raw = await readFile(auditPath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function listRunIds(store = createRunStore()) {
  if (!(await exists(store.runsDir))) return [];
  const entries = await readdir(store.runsDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

export async function recoverInterruptedRuns(store = createRunStore(), now = new Date()) {
  const recovered = [];
  for (const runId of await listRunIds(store)) {
    const run = await loadRun(runId, store);
    if (![runStates.RUNNING, runStates.SLEEPING, runStates.PAUSED, runStates.STOPPING].includes(run.state)) {
      continue;
    }

    const nowIso = now.toISOString();
    const leads = run.leads.map((lead) => recoverLead(lead, nowIso));
    const interruptedAttempt = leads.some((lead) =>
      lead.state === leadStates.NEEDS_REVIEW &&
      lead.lastErrorCode === "CONTROLLER_RESTART_DURING_ATTEMPT"
    );
    const wasPaused = run.state === runStates.PAUSED;
    const wasStopping = run.state === runStates.STOPPING;
    const state = interruptedAttempt
      ? runStates.NEEDS_ATTENTION
      : wasPaused
        ? runStates.PAUSED
        : wasStopping
          ? runStates.STOPPED
          : runStates.RUNNING;
    const nextRun = {
      ...run,
      state,
      stopRequested: wasStopping,
      pauseRequested: wasPaused,
      stopReason: wasStopping ? "stop_completed_after_restart" : null,
      sleepingUntil: null,
      sleepingReason: null,
      updatedAt: nowIso,
      leads
    };

    await appendAudit(run.id, {
      ts: nowIso,
      event: "controller_restart_recovery",
      outcome: state === runStates.RUNNING ? "resumed" : state
    }, store);
    await saveRun(nextRun, store);
    recovered.push(nextRun);
  }
  return recovered;
}

async function atomicWriteJson(path, value) {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function recoverLead(lead, nowIso) {
  if (lead.state !== leadStates.RUNNING) return lead;
  const latestAttempt = lead.attempts.at(-1);
  if (latestAttempt && latestAttempt.completedAt === null) {
    return {
      ...lead,
      state: leadStates.NEEDS_REVIEW,
      lastErrorCode: "CONTROLLER_RESTART_DURING_ATTEMPT",
      nextEligibleAt: null,
      updatedAt: nowIso
    };
  }
  return {
    ...lead,
    state: leadStates.QUEUED,
    nextEligibleAt: lead.nextEligibleAt ?? nowIso,
    updatedAt: nowIso
  };
}

export async function findLatestResumableRun(store = createRunStore()) {
  const runs = await Promise.all((await listRunIds(store)).map((runId) => loadRun(runId, store)));
  const latestRun = runs
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
  if (
    latestRun?.state !== runStates.STOPPED ||
    !latestRun.leads.some((lead) => [
      leadStates.QUEUED,
      leadStates.WAITING_ACCEPTANCE,
      leadStates.WAITING_DELAY,
      leadStates.NEEDS_REVIEW
    ].includes(lead.state))
  ) {
    return null;
  }
  return latestRun;
}

export async function findSentActionMatches(snapshot, store = createRunStore()) {
  const selectedActions = new Set(
    (snapshot.actions ?? [])
      .filter((action) => action?.type === "message" && action.automatic !== true)
      .map((action) => action.id)
  );
  const selectedLeads = new Map(
    (snapshot.leads ?? [])
      .filter((lead) => lead?.status !== "excluded")
      .map((lead) => [normalizeLinkedInUrl(lead.linkedinUrl), lead])
  );
  const matches = [];

  for (const runId of await listRunIds(store)) {
    const run = await loadRun(runId, store);
    if (run.snapshot?.campaign?.id !== snapshot.campaign?.id) continue;
    for (const lead of run.leads ?? []) {
      const linkedinUrl = normalizeLinkedInUrl(lead.lead?.linkedinUrl);
      const selectedLead = selectedLeads.get(linkedinUrl);
      if (!selectedLead) continue;
      for (const attempt of lead.attempts ?? []) {
        if (attempt.outcome !== "sent" || attempt.errorCode !== null || !selectedActions.has(attempt.actionId)) continue;
        matches.push({
          priorRunId: run.id,
          leadId: selectedLead.id,
          linkedinUrl,
          actionId: attempt.actionId,
          sentAt: attempt.completedAt
        });
      }
    }
  }

  return matches;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function safeRunId(runId) {
  if (typeof runId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error("Invalid run id.");
  }
  return runId;
}

function normalizeLinkedInUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return String(value ?? "").replace(/\/$/, "").toLowerCase();
  }
}
