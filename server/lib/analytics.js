import { listRuns, readAudit } from "./runStore.js";

export const analyticsEventTypes = Object.freeze({
  INVITATION_SENT: "connection_request_sent",
  INVITATION_ACCEPTED: "connection_accepted",
  MESSAGE_SENT: "message_sent",
  REPLY_RECEIVED: "reply_received"
});

const trackedEventTypes = new Set(Object.values(analyticsEventTypes));

export async function getCampaignAnalytics(filters = {}, dependencies = {}) {
  const list = dependencies.listRuns ?? listRuns;
  const read = dependencies.readAudit ?? readAudit;
  const runs = await list();
  const events = [];

  for (const run of runs) {
    if (run.mode !== "live") continue;
    if (filters.profileId && run.profileId !== filters.profileId) continue;
    if (filters.campaignId && run.snapshot?.campaign?.id !== filters.campaignId) continue;

    const leads = new Map((run.leads ?? []).map((lead) => [lead.id, lead.lead]));
    for (const entry of await read(run.id)) {
      if (!trackedEventTypes.has(entry.event)) continue;
      events.push({
        id: eventIdentity(entry),
        type: entry.event,
        occurredAt: entry.ts,
        observedAt: entry.ts,
        runId: run.id,
        profileId: run.profileId,
        campaignId: run.snapshot?.campaign?.id ?? null,
        campaignName: run.snapshot?.campaign?.name ?? "Untitled campaign",
        leadId: entry.leadId,
        actionId: entry.actionId,
        leadName: leads.get(entry.leadId)?.fullName ?? leads.get(entry.leadId)?.name ?? "Unknown lead",
        source: entry.detail?.source ?? "campaign_runner",
        detail: entry.detail ?? null
      });
    }
  }

  return aggregateCampaignEvents(events, filters);
}

export function aggregateCampaignEvents(events, filters = {}, now = new Date()) {
  const timeZone = validTimeZone(filters.timeZone) ? filters.timeZone : "UTC";
  const defaultTo = endOfUtcDay(now);
  const defaultFrom = startOfUtcDay(new Date(defaultTo.getTime() - 29 * 86_400_000));
  const from = parseBoundary(filters.from, false) ?? defaultFrom;
  const to = parseBoundary(filters.to, true) ?? defaultTo;
  const fromKey = isDateKey(filters.from) ? filters.from : dateKey(from, timeZone);
  const toKey = isDateKey(filters.to) ? filters.to : dateKey(to, timeZone);
  const uniqueEvents = deduplicateEvents(events)
    .filter((event) => {
      const at = Date.parse(event.observedAt ?? event.occurredAt);
      if (!Number.isFinite(at)) return false;
      const key = dateKey(at, timeZone);
      return key >= fromKey && key <= toKey;
    })
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));

  const dailyByDate = new Map();
  for (const date of enumerateDateKeys(fromKey, toKey)) {
    dailyByDate.set(date, emptyTotals(date));
  }

  const campaigns = new Map();
  const totals = emptyTotals();
  for (const event of uniqueEvents) {
    applyEvent(totals, event);
    const date = dateKey(event.observedAt, timeZone);
    if (!dailyByDate.has(date)) dailyByDate.set(date, emptyTotals(date));
    applyEvent(dailyByDate.get(date), event);

    const campaign = campaigns.get(event.campaignId) ?? {
      id: event.campaignId,
      name: event.campaignName,
      ...emptyTotals()
    };
    applyEvent(campaign, event);
    campaigns.set(event.campaignId, campaign);
  }

  return {
    range: { from: from.toISOString(), to: to.toISOString(), timeZone },
    totals: withRates(totals),
    daily: [...dailyByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
    campaigns: [...campaigns.values()]
      .map(withRates)
      .sort((left, right) => right.messagesSent - left.messagesSent || left.name.localeCompare(right.name)),
    events: uniqueEvents
  };
}

function applyEvent(target, event) {
  if (event.type === analyticsEventTypes.INVITATION_SENT) target.invitesSent += 1;
  if (event.type === analyticsEventTypes.INVITATION_ACCEPTED) target.accepted += 1;
  if (event.type === analyticsEventTypes.MESSAGE_SENT) target.messagesSent += 1;
  if (event.type === analyticsEventTypes.REPLY_RECEIVED) target.replies += 1;
}

function emptyTotals(date) {
  return {
    ...(date ? { date } : {}),
    invitesSent: 0,
    accepted: 0,
    messagesSent: 0,
    replies: 0
  };
}

function withRates(value) {
  return {
    ...value,
    acceptanceRate: percentage(value.accepted, value.invitesSent),
    replyRate: percentage(value.replies, value.messagesSent)
  };
}

function percentage(numerator, denominator) {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function deduplicateEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const identity = event.id ?? [
      event.type,
      event.runId,
      event.leadId,
      event.actionId,
      event.detail?.externalMessageId ?? event.occurredAt
    ].join(":");
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function eventIdentity(entry) {
  return [entry.runId, entry.event, entry.leadId, entry.actionId, entry.attempt, entry.ts].join(":");
}

function dateKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function enumerateDateKeys(fromKey, toKey) {
  const dates = [];
  const end = Date.parse(`${toKey}T00:00:00.000Z`);
  for (let cursor = Date.parse(`${fromKey}T00:00:00.000Z`); cursor <= end; cursor += 86_400_000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

function parseBoundary(value, endOfDay) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function endOfUtcDay(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999));
}

function validTimeZone(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
