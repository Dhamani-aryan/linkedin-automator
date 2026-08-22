import type { CampaignRun, CampaignRunAttempt, CampaignRunLead, LeadProfile } from "../types";

export type CampaignOutcomeKey = "invited" | "accepted" | "messaged" | "replied" | "failed";

export type CampaignOutcomeRecord = {
  lead: LeadProfile;
  occurredAt: string | null;
  replyText: string | null;
  detail: string | null;
};

export type CampaignOutcomeRecords = Record<CampaignOutcomeKey, CampaignOutcomeRecord[]>;

export type CampaignListMetrics = {
  processing: number;
  processed: number;
  successful: number;
  failed: number;
  invited: number;
  accepted: number;
  messaged: number;
  replied: number;
};

const activeLeadStates = new Set(["running", "waiting_acceptance", "waiting_delay"]);
const successfulOutcomes = new Set(["sent", "dry_run_ok", "accepted", "ok"]);

export function campaignListMetrics(campaignId: string, runs: CampaignRun[]): CampaignListMetrics {
  const campaignRuns = runs.filter((run) => run.snapshot.campaign.id === campaignId);
  const outcomes = campaignOutcomeRecords(campaignId, runs);
  const latestRun = [...campaignRuns].sort((left, right) =>
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  )[0];
  const processed = new Set<string>();
  const successful = new Set<string>();

  for (const run of campaignRuns) {
    for (const leadRun of run.leads) {
      const key = leadIdentity(leadRun);
      const completedAttempts = leadRun.attempts.filter((attempt) => attempt.completedAt !== null);
      if (completedAttempts.length > 0) processed.add(key);

      for (const attempt of completedAttempts) {
        if (successfulOutcomes.has(attempt.outcome ?? "")) successful.add(key);
      }
    }
  }

  return {
    processing: latestRun?.leads.filter((lead) => activeLeadStates.has(lead.state)).length ?? 0,
    processed: processed.size,
    successful: successful.size,
    failed: outcomes.failed.length,
    invited: outcomes.invited.length,
    accepted: outcomes.accepted.length,
    messaged: outcomes.messaged.length,
    replied: outcomes.replied.length
  };
}

export function campaignOutcomeRecords(campaignId: string, runs: CampaignRun[]): CampaignOutcomeRecords {
  const records = {
    invited: new Map<string, CampaignOutcomeRecord>(),
    accepted: new Map<string, CampaignOutcomeRecord>(),
    messaged: new Map<string, CampaignOutcomeRecord>(),
    replied: new Map<string, CampaignOutcomeRecord>(),
    failed: new Map<string, CampaignOutcomeRecord>()
  };

  for (const run of runs.filter((candidate) => candidate.snapshot.campaign.id === campaignId)) {
    const actionTypes = new Map(run.snapshot.actions.map((action) => [action.id, action.type]));
    for (const leadRun of run.leads) {
      const key = leadIdentity(leadRun);
      const attempts = leadRun.attempts.filter((attempt) => attempt.completedAt !== null);
      const invitedAttempt = latestAttempt(attempts, (attempt) =>
        (attempt.detail?.actionType ?? actionTypes.get(attempt.actionId)) === "connection_request" &&
        successfulOutcomes.has(attempt.outcome ?? ""));
      const acceptedAttempt = latestAttempt(attempts, (attempt) => attempt.outcome === "accepted");
      const messageAttempt = latestAttempt(attempts, (attempt) =>
        (attempt.detail?.actionType ?? actionTypes.get(attempt.actionId)) === "message" && attempt.outcome === "sent");
      const replyAttempt = latestAttempt(attempts, (attempt) => attempt.outcome === "replied");
      const failedAttempt = latestAttempt(attempts, (attempt) => attempt.outcome === "failed");

      if (invitedAttempt) upsertRecord(records.invited, key, leadRun, invitedAttempt, run.updatedAt);
      if (leadRun.acceptedAt || acceptedAttempt) {
        upsertRecord(records.accepted, key, leadRun, acceptedAttempt, leadRun.acceptedAt ?? run.updatedAt);
      }
      if (messageAttempt) upsertRecord(records.messaged, key, leadRun, messageAttempt, run.updatedAt);
      if (leadRun.state === "replied" || replyAttempt) {
        upsertRecord(records.replied, key, leadRun, replyAttempt, run.updatedAt);
      }
      if (leadRun.state === "failed" || failedAttempt) {
        upsertRecord(records.failed, key, leadRun, failedAttempt, run.updatedAt);
      }
    }
  }

  return {
    invited: sortedRecords(records.invited),
    accepted: sortedRecords(records.accepted),
    messaged: sortedRecords(records.messaged),
    replied: sortedRecords(records.replied),
    failed: sortedRecords(records.failed)
  };
}

function latestAttempt(attempts: CampaignRunAttempt[], predicate: (attempt: CampaignRunAttempt) => boolean) {
  return attempts.filter(predicate).sort((left, right) =>
    Date.parse(right.completedAt ?? "") - Date.parse(left.completedAt ?? ""))[0] ?? null;
}

function upsertRecord(
  records: Map<string, CampaignOutcomeRecord>,
  key: string,
  leadRun: CampaignRunLead,
  attempt: CampaignRunAttempt | null,
  fallbackOccurredAt: string
) {
  const occurredAt = attempt?.completedAt ?? fallbackOccurredAt;
  const current = records.get(key);
  if (current?.occurredAt && Date.parse(current.occurredAt) > Date.parse(occurredAt)) return;
  const replyText = attempt?.detail?.replyText;
  const reason = attempt?.detail?.reason;
  records.set(key, {
    lead: leadRun.lead,
    occurredAt,
    replyText: typeof replyText === "string" ? replyText : null,
    detail: typeof reason === "string" ? reason : attempt?.errorCode ?? null
  });
}

function sortedRecords(records: Map<string, CampaignOutcomeRecord>) {
  return [...records.values()].sort((left, right) =>
    Date.parse(right.occurredAt ?? "") - Date.parse(left.occurredAt ?? ""));
}

function leadIdentity(leadRun: CampaignRunLead) {
  return leadRun.lead.linkedinUrl || leadRun.id;
}
