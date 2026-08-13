import type {
  CampaignRun,
  CampaignAnalytics,
  CampaignSummary,
  CampaignWorkflowAction,
  HumanTouchSettings,
  LeadProfile
} from "../types";

type ApiFailure = {
  ok: false;
  error?: {
    code: string;
    message: string;
    detail?: unknown;
  };
  validationFailures?: Array<{
    field: string;
    code: string;
    message: string;
    detail?: unknown;
  }>;
};

const defaultHeaders = {
  "content-type": "application/json"
};

export type CampaignRunSnapshot = {
  profileId: string;
  campaign: CampaignSummary;
  actions: CampaignWorkflowAction[];
  leads: LeadProfile[];
  safety: HumanTouchSettings & { timeZone?: string };
  mode: "dry_run" | "live";
  liveConfirmation?: {
    confirmed: true;
    leadIds: string[];
    actionIds: string[];
    firstMessageText: string;
  };
};

export async function startCampaignRun(snapshot: CampaignRunSnapshot): Promise<CampaignRun> {
  const result = await request<{ ok: true; runId: string; run: CampaignRun } | ApiFailure>("/api/campaign-runs", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify(snapshot)
  });
  if (!result.ok) throw failureToError(result);
  return result.run;
}

export async function getCampaignRun(runId: string): Promise<CampaignRun> {
  return request<CampaignRun>(`/api/campaign-runs/${encodeURIComponent(runId)}`);
}

export async function startCampaignBatch(snapshots: CampaignRunSnapshot[]): Promise<CampaignRun[]> {
  const result = await request<{ ok: true; batchId: string; runs: CampaignRun[] } | ApiFailure>(
    "/api/campaign-runs/batch",
    {
      method: "POST",
      headers: defaultHeaders,
      body: JSON.stringify({ snapshots })
    }
  );
  if (!result.ok) throw failureToError(result);
  return result.runs;
}

export async function listCampaignRuns(profileId: string): Promise<CampaignRun[]> {
  const result = await request<{ ok: true; runs: CampaignRun[] }>(
    `/api/campaign-runs?profileId=${encodeURIComponent(profileId)}`
  );
  return result.runs;
}

export async function getCampaignAnalytics(filters: {
  profileId: string;
  campaignId?: string;
  from: string;
  to: string;
  timeZone: string;
}): Promise<CampaignAnalytics> {
  const query = new URLSearchParams({
    profileId: filters.profileId,
    from: filters.from,
    to: filters.to,
    timeZone: filters.timeZone
  });
  if (filters.campaignId) query.set("campaignId", filters.campaignId);
  return request<CampaignAnalytics>(`/api/analytics/campaigns?${query.toString()}`);
}

export async function getActiveCampaignRun(): Promise<CampaignRun | null> {
  const result = await request<{ ok: true; run: CampaignRun | null }>("/api/campaign-runs/active", undefined, {
    ignoreMissingEndpoint: true
  });
  return result.run;
}

export async function stopCampaignRun(runId: string): Promise<CampaignRun> {
  const result = await request<{ ok: true; run: CampaignRun }>(`/api/campaign-runs/${encodeURIComponent(runId)}/stop`, {
    method: "POST"
  });
  return result.run;
}

export async function pauseCampaignRun(runId: string): Promise<CampaignRun> {
  const result = await request<{ ok: true; run: CampaignRun }>(`/api/campaign-runs/${encodeURIComponent(runId)}/pause`, {
    method: "POST"
  });
  return result.run;
}

export async function resumeCampaignRun(runId: string, actions: CampaignWorkflowAction[]): Promise<CampaignRun> {
  const result = await request<{ ok: true; run: CampaignRun }>(`/api/campaign-runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ actions })
  });
  return result.run;
}

export async function retryCampaignRun(runId: string): Promise<CampaignRun> {
  const result = await request<{ ok: true; run: CampaignRun }>(`/api/campaign-runs/${encodeURIComponent(runId)}/retry`, {
    method: "POST"
  });
  return result.run;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options: { ignoreMissingEndpoint?: boolean } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("The local campaign runner is unavailable. Restart the app and try again.");
  }

  const body = await response.json() as T | ApiFailure;
  if (!response.ok && options.ignoreMissingEndpoint && isMissingEndpoint(body)) {
    return { ok: true, run: null } as T;
  }
  if (!response.ok || isFailure(body)) {
    throw failureToError(body as ApiFailure);
  }
  return body as T;
}

function failureToError(failure: ApiFailure) {
  if (isMissingEndpoint(failure)) {
    return new Error("The campaign runner endpoint is not available yet. Restart the local controller or dev server and try again.");
  }
  if (failure.validationFailures?.length) {
    return new Error(failure.validationFailures.map((item: { message: string }) => item.message).join(" "));
  }
  return new Error(failure.error?.message ?? "Campaign runner request failed.");
}

function isMissingEndpoint(value: unknown): boolean {
  return (
    isFailure(value) &&
    value.error?.code === "NOT_FOUND" &&
    value.error.message === "Endpoint not found."
  );
}

function isFailure(value: unknown): value is ApiFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false
  );
}
