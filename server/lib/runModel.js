import { renderTemplate } from "./template.js";

export const leadStates = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  WAITING_ACCEPTANCE: "waiting_acceptance",
  WAITING_DELAY: "waiting_delay",
  REPLIED: "replied",
  COMPLETED: "completed",
  FAILED: "failed",
  NEEDS_REVIEW: "needs_review",
  STOPPED: "stopped"
});

export const runStates = Object.freeze({
  VALIDATING: "validating",
  RUNNING: "running",
  SLEEPING: "sleeping",
  STOPPING: "stopping",
  STOPPED: "stopped",
  COMPLETED: "completed",
  FAILED: "failed",
  NEEDS_ATTENTION: "needs_attention"
});

export const terminalLeadStates = new Set([
  leadStates.REPLIED,
  leadStates.COMPLETED,
  leadStates.FAILED,
  leadStates.NEEDS_REVIEW,
  leadStates.STOPPED
]);

export const executableActionTypes = new Set(["connection_request", "message"]);
export const automaticActionTypes = new Set(["wait_for_acceptance", "reply_check"]);
export const knownTemplateVariables = new Set([
  "firstName",
  "lastName",
  "fullName",
  "company",
  "position",
  "location",
  "industry",
  "publicId",
  "memberId",
  "mutualTotal",
  "mutualFirstFullName",
  "mutualSecondFullName"
]);

export function validateRun(snapshot) {
  const failures = [];
  const actions = Array.isArray(snapshot?.actions) ? snapshot.actions : [];
  const leads = Array.isArray(snapshot?.leads) ? snapshot.leads : [];

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [{ field: "snapshot", code: "INVALID_SNAPSHOT", message: "Run snapshot must be an object." }];
  }

  if (!snapshot.campaign?.id) {
    failures.push({ field: "campaign", code: "MISSING_CAMPAIGN", message: "Campaign snapshot is required." });
  }

  if (!actions.some((action) => executableActionTypes.has(action?.type) && action.automatic !== true)) {
    failures.push({
      field: "actions",
      code: "NO_EXECUTABLE_ACTION",
      message: "Add at least one connection request or message action."
    });
  }

  for (const [index, action] of actions.entries()) {
    if (!isPlainObject(action) || typeof action.id !== "string") {
      failures.push({ field: `actions.${index}`, code: "INVALID_ACTION", message: "Workflow action is malformed." });
      continue;
    }

    if (!executableActionTypes.has(action.type) && !automaticActionTypes.has(action.type)) {
      failures.push({ field: `actions.${index}.type`, code: "UNKNOWN_ACTION_TYPE", message: "Workflow action type is not supported." });
    }

    if (action.automatic === true) {
      const previous = actions[index - 1];
      const guardMatchesParent =
        (action.type === "wait_for_acceptance" && previous?.type === "connection_request") ||
        (action.type === "reply_check" && previous?.type === "message");
      if (!guardMatchesParent) {
        failures.push({
          field: `actions.${index}`,
          code: "UNATTACHED_GUARD",
          message: "Automatic guards must immediately follow their parent action."
        });
      }
    }

    if (typeof action.template === "string") {
      for (const token of extractTemplateVariables(action.template)) {
        if (!knownTemplateVariables.has(token)) {
          failures.push({
            field: `actions.${index}.template`,
            code: "UNKNOWN_TEMPLATE_VARIABLE",
            message: `Template variable {${token}} is not available.`,
            detail: { variable: token }
          });
        }
      }
    }

    if (action.type === "message" && action.delay) {
      const validUnit = ["minutes", "hours", "days"].includes(action.delay.unit);
      if (!Number.isFinite(action.delay.amount) || action.delay.amount < 0 || !validUnit) {
        failures.push({
          field: `actions.${index}.delay`,
          code: "INVALID_DELAY",
          message: "Message delays must be zero or a positive number of minutes, hours, or days."
        });
      }
    }
  }

  const queuedLeads = leads.filter((lead) => lead?.status !== "excluded");
  if (queuedLeads.length === 0) {
    failures.push({ field: "leads", code: "NO_QUEUED_LEADS", message: "Add at least one lead to process." });
  }

  for (const [index, lead] of queuedLeads.entries()) {
    if (typeof lead?.id !== "string" || typeof lead.linkedinUrl !== "string") {
      failures.push({ field: `leads.${index}`, code: "INVALID_LEAD", message: "Lead is missing an id or LinkedIn URL." });
    } else if (!isLinkedInUrl(lead.linkedinUrl)) {
      failures.push({ field: `leads.${index}.linkedinUrl`, code: "INVALID_LINKEDIN_URL", message: "Lead URL must be a LinkedIn profile URL." });
    }
  }

  failures.push(...validateSafety(snapshot.safety));
  return failures;
}

export function validateLiveRun(snapshot) {
  if (snapshot?.mode !== "live") return [];

  const failures = [];
  const leads = Array.isArray(snapshot.leads)
    ? snapshot.leads.filter((lead) => lead?.status !== "excluded")
    : [];
  const actions = Array.isArray(snapshot.actions)
    ? snapshot.actions.filter((action) => action?.automatic !== true && executableActionTypes.has(action?.type))
    : [];
  const confirmation = snapshot.liveConfirmation;

  if (leads.length !== 1) {
    failures.push({
      field: "leads",
      code: "LIVE_REQUIRES_ONE_LEAD",
      message: "Controlled live sending requires exactly one selected lead."
    });
  }

  if (actions.length !== 1 || actions[0]?.type !== "message") {
    failures.push({
      field: "actions",
      code: "LIVE_REQUIRES_ONE_MESSAGE",
      message: "Controlled live sending requires exactly one message action."
    });
  }

  const firstAction = actions[0];
  const firstLead = leads[0];
  const firstMessage = firstAction?.type === "message" && firstLead
    ? renderTemplate(firstAction.template ?? "", firstLead, { missingVariable: "empty" }).text
    : "";
  if (firstMessage.length === 0) {
    failures.push({
      field: "actions",
      code: "EMPTY_LIVE_MESSAGE",
      message: "The first live message must contain text."
    });
  }

  if (confirmation?.confirmed !== true) {
    failures.push({
      field: "liveConfirmation",
      code: "LIVE_CONFIRMATION_REQUIRED",
      message: "Confirm the exact lead and first message before starting a live run."
    });
  } else if (
    confirmation.leadId !== firstLead?.id ||
    confirmation.firstMessageText !== firstMessage
  ) {
    failures.push({
      field: "liveConfirmation",
      code: "LIVE_CONFIRMATION_MISMATCH",
      message: "The live-send confirmation does not match the selected lead and resolved message."
    });
  }

  return failures;
}

export function createCampaignRun({ runId, snapshot, mode, now = new Date() }) {
  const createdAt = now.toISOString();
  return {
    id: runId,
    profileId: snapshot.profileId,
    mode,
    state: runStates.VALIDATING,
    createdAt,
    updatedAt: createdAt,
    stopRequested: false,
    sleepingUntil: null,
    sleepingReason: null,
    validationFailures: [],
    snapshot,
    leads: snapshot.leads
      .filter((lead) => lead.status !== "excluded")
      .map((lead) => createLeadRun(lead, snapshot.actions, createdAt))
  };
}

export function createLeadRun(lead, actions, nowIso) {
  return {
    id: lead.id,
    lead,
    state: leadStates.QUEUED,
    actionCursor: firstExecutableCursor(actions),
    attempts: [],
    delaysSatisfiedActionIds: [],
    nextEligibleAt: nowIso,
    lastErrorCode: null,
    conversationSeenAt: null
  };
}

export function transition(leadRun, event, actions = []) {
  const now = event.now ?? new Date().toISOString();
  const lead = clone(leadRun);

  switch (event.type) {
    case "ACTION_STARTED":
      assertState(lead, [leadStates.QUEUED, leadStates.WAITING_ACCEPTANCE, leadStates.WAITING_DELAY]);
      lead.state = leadStates.RUNNING;
      lead.attempts.push({
        actionId: event.actionId,
        attempt: countAttemptsForAction(lead, event.actionId) + 1,
        startedAt: now,
        completedAt: null,
        outcome: null,
        errorCode: null,
        detail: event.detail ?? null
      });
      return touch(lead, now);

    case "ACTION_SUCCEEDED":
      assertState(lead, [leadStates.RUNNING]);
      completeLatestAttempt(lead, event.outcome ?? "ok", null, event.detail ?? null, now);
      lead.actionCursor = nextExecutableCursor(actions, lead.actionCursor + 1);
      lead.state = lead.actionCursor >= actions.length ? leadStates.COMPLETED : leadStates.QUEUED;
      lead.nextEligibleAt = event.nextEligibleAt ?? now;
      lead.lastErrorCode = null;
      return touch(lead, now);

    case "WAITING_ACCEPTANCE":
      assertState(lead, [leadStates.RUNNING, leadStates.WAITING_ACCEPTANCE]);
      if (lead.state === leadStates.RUNNING) {
        completeLatestAttempt(lead, event.outcome ?? "pending", null, event.detail ?? null, now);
      }
      lead.state = leadStates.WAITING_ACCEPTANCE;
      lead.nextEligibleAt = event.nextEligibleAt;
      lead.lastErrorCode = null;
      return touch(lead, now);

    case "ACCEPTANCE_CONFIRMED":
      assertState(lead, [leadStates.WAITING_ACCEPTANCE]);
      lead.actionCursor = nextExecutableCursor(actions, lead.actionCursor + 1);
      lead.state = lead.actionCursor >= actions.length ? leadStates.COMPLETED : leadStates.QUEUED;
      lead.nextEligibleAt = now;
      lead.lastErrorCode = null;
      return touch(lead, now);

    case "WAITING_DELAY":
      assertState(lead, [leadStates.RUNNING, leadStates.QUEUED]);
      lead.state = leadStates.WAITING_DELAY;
      lead.nextEligibleAt = event.nextEligibleAt;
      return touch(lead, now);

    case "DELAY_ELAPSED":
      assertState(lead, [leadStates.WAITING_DELAY]);
      lead.state = leadStates.QUEUED;
      lead.nextEligibleAt = now;
      if (event.actionId && !lead.delaysSatisfiedActionIds.includes(event.actionId)) {
        lead.delaysSatisfiedActionIds.push(event.actionId);
      }
      return touch(lead, now);

    case "REPLIED":
      assertState(lead, [leadStates.RUNNING, leadStates.QUEUED, leadStates.WAITING_DELAY]);
      if (lead.state === leadStates.RUNNING) {
        completeLatestAttempt(lead, event.outcome ?? "replied", null, event.detail ?? null, now);
      }
      lead.state = leadStates.REPLIED;
      lead.conversationSeenAt = event.conversationSeenAt ?? now;
      lead.nextEligibleAt = null;
      return touch(lead, now);

    case "ACTION_FAILED":
      assertState(lead, [leadStates.RUNNING]);
      completeLatestAttempt(lead, event.outcome ?? "failed", event.errorCode, event.detail ?? null, now);
      lead.state = leadStates.FAILED;
      lead.lastErrorCode = event.errorCode ?? null;
      lead.nextEligibleAt = null;
      return touch(lead, now);

    case "NEEDS_REVIEW":
      if (lead.state === leadStates.RUNNING) {
        completeLatestAttempt(lead, event.outcome ?? "needs_review", event.errorCode, event.detail ?? null, now);
      }
      lead.state = leadStates.NEEDS_REVIEW;
      lead.lastErrorCode = event.errorCode ?? null;
      lead.nextEligibleAt = null;
      return touch(lead, now);

    case "STOPPED":
      if (terminalLeadStates.has(lead.state)) return touch(lead, now);
      lead.state = leadStates.STOPPED;
      lead.nextEligibleAt = null;
      return touch(lead, now);

    default:
      throw new Error(`Unsupported lead transition event: ${event.type}`);
  }
}

export function summarizeRun(run) {
  const counts = Object.fromEntries(Object.values(leadStates).map((state) => [state, 0]));
  for (const lead of run.leads) {
    counts[lead.state] += 1;
  }

  return {
    total: run.leads.length,
    queued: counts[leadStates.QUEUED],
    running: counts[leadStates.RUNNING],
    sleeping: counts[leadStates.WAITING_ACCEPTANCE] + counts[leadStates.WAITING_DELAY],
    completed: counts[leadStates.COMPLETED],
    failed: counts[leadStates.FAILED],
    needsReview: counts[leadStates.NEEDS_REVIEW],
    replied: counts[leadStates.REPLIED],
    stopped: counts[leadStates.STOPPED]
  };
}

export function isRunFinished(run) {
  return run.leads.every((lead) => terminalLeadStates.has(lead.state));
}

export function delayToMs(delay) {
  if (!delay || delay.amount === 0) return 0;
  const multipliers = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
  return delay.amount * multipliers[delay.unit];
}

function firstExecutableCursor(actions) {
  return nextExecutableCursor(actions, 0);
}

function nextExecutableCursor(actions, startIndex) {
  for (let index = startIndex; index < actions.length; index += 1) {
    if (executableActionTypes.has(actions[index]?.type) && actions[index]?.automatic !== true) {
      return index;
    }
  }
  return actions.length;
}

function validateSafety(safety) {
  const failures = [];
  if (!isPlainObject(safety)) {
    return [{ field: "safety", code: "MISSING_SAFETY", message: "Safety limits snapshot is required." }];
  }

  for (const key of ["dailyActionLimit", "dailyInviteLimit", "minDelaySeconds", "maxDelaySeconds", "batchSize", "cooldownAfterBatchMinutes"]) {
    if (!Number.isFinite(safety[key]) || safety[key] < 0) {
      failures.push({ field: `safety.${key}`, code: "INVALID_SAFETY_LIMIT", message: "Safety limits must be non-negative numbers." });
    }
  }

  if (safety.dailyInviteLimit > safety.dailyActionLimit) {
    failures.push({
      field: "safety.dailyInviteLimit",
      code: "INVITE_LIMIT_EXCEEDS_ACTION_LIMIT",
      message: "Daily invite limit cannot exceed the total daily action limit."
    });
  }

  if (safety.minDelaySeconds > safety.maxDelaySeconds) {
    failures.push({
      field: "safety.maxDelaySeconds",
      code: "INVALID_DELAY_RANGE",
      message: "Maximum action delay must be greater than or equal to the minimum delay."
    });
  }

  if (!isTime(safety.workingHoursStart) || !isTime(safety.workingHoursEnd)) {
    failures.push({
      field: "safety.workingHours",
      code: "INVALID_WORKING_HOURS",
      message: "Working hours must use HH:MM format."
    });
  }

  return failures;
}

function completeLatestAttempt(lead, outcome, errorCode, detail, now) {
  const latest = lead.attempts.at(-1);
  if (!latest || latest.completedAt !== null) {
    throw new Error("Cannot complete an action that has not started.");
  }
  latest.completedAt = now;
  latest.outcome = outcome;
  latest.errorCode = errorCode;
  latest.detail = detail;
}

function countAttemptsForAction(lead, actionId) {
  return lead.attempts.filter((attempt) => attempt.actionId === actionId).length;
}

function assertState(lead, allowedStates) {
  if (!allowedStates.includes(lead.state)) {
    throw new Error(`Illegal transition from ${lead.state}.`);
  }
}

function extractTemplateVariables(template) {
  return [...template.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map((match) => match[1]);
}

function isLinkedInUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith("linkedin.com") && (/^\/in\/[^/]+/.test(url.pathname) || /^\/sales\/lead\/[^/]+/.test(url.pathname));
  } catch {
    return false;
  }
}

function isTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function touch(lead, now) {
  lead.updatedAt = now;
  return lead;
}
