import type { CampaignRun, CampaignRunLead } from "../types";

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
  const latestRun = [...campaignRuns].sort((left, right) =>
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  )[0];
  const processed = new Set<string>();
  const successful = new Set<string>();
  const failed = new Set<string>();
  const invited = new Set<string>();
  const accepted = new Set<string>();
  const messaged = new Set<string>();
  const replied = new Set<string>();

  for (const run of campaignRuns) {
    const actionTypes = new Map(run.snapshot.actions.map((action) => [action.id, action.type]));
    for (const leadRun of run.leads) {
      const key = leadIdentity(leadRun);
      const completedAttempts = leadRun.attempts.filter((attempt) => attempt.completedAt !== null);
      if (completedAttempts.length > 0) processed.add(key);
      if (leadRun.state === "failed" || completedAttempts.some((attempt) => attempt.outcome === "failed")) failed.add(key);
      if (leadRun.acceptedAt || completedAttempts.some((attempt) => attempt.outcome === "accepted")) accepted.add(key);
      if (leadRun.state === "replied" || completedAttempts.some((attempt) => attempt.outcome === "replied")) replied.add(key);

      for (const attempt of completedAttempts) {
        const actionType = attempt.detail?.actionType ?? actionTypes.get(attempt.actionId);
        if (successfulOutcomes.has(attempt.outcome ?? "")) successful.add(key);
        if (actionType === "connection_request" && successfulOutcomes.has(attempt.outcome ?? "")) invited.add(key);
        if (actionType === "message" && attempt.outcome === "sent") messaged.add(key);
      }
    }
  }

  return {
    processing: latestRun?.leads.filter((lead) => activeLeadStates.has(lead.state)).length ?? 0,
    processed: processed.size,
    successful: successful.size,
    failed: failed.size,
    invited: invited.size,
    accepted: accepted.size,
    messaged: messaged.size,
    replied: replied.size
  };
}

function leadIdentity(leadRun: CampaignRunLead) {
  return leadRun.lead.linkedinUrl || leadRun.id;
}
