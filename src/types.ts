export type ChromeTabSummary = {
  id: string | null;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl: string | null;
};

export type ChromeStatus = {
  ok: true;
  connected: boolean;
  cdpPort: number;
  profileDir: string;
  ownedProcess: boolean;
  launchedAt: string | null;
  tabs: ChromeTabSummary[];
};

export type LinkedInAccount = {
  id: string;
  email: string;
  name: string;
  state: "stopped" | "starting" | "running" | "error";
  role: "Owner";
  chromeProfileMode: "single-local-profile";
  archived: boolean;
  lastError?: string;
};

export type CampaignStatus = "ready" | "running" | "sleeping" | "stopped";

export type CampaignSummary = {
  id: string;
  name: string;
  status: CampaignStatus;
  profilesTotal: number;
  profilesToProcess: number;
  processing: number;
  processed: number;
  successful: number;
  failed: number;
  accepted: number;
  replied: number;
};

export type LeadProfile = {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  company: string;
  position: string;
  location: string;
  status: "to_process" | "processing" | "processed" | "accepted" | "replied" | "failed" | "excluded";
  addedAt: string;
};

export type WorkflowCardKind = "source" | "action" | "reply_check";

export type WorkflowCard = {
  id: string;
  kind: WorkflowCardKind;
  title: string;
  subtitle: string;
  count: number;
  successful: number;
  failed: number;
};
