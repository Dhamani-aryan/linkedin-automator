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

export type CompanyUser = {
  id: string;
  companyName: string;
  email: string;
  createdAt: string;
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

export type HumanTouchSettings = {
  dailyActionLimit: number;
  dailyInviteLimit: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  batchSize: number;
  cooldownAfterBatchMinutes: number;
  workingHoursStart: string;
  workingHoursEnd: string;
  randomizeScroll: boolean;
  randomProfileViewSeconds: [number, number];
  pauseOnReply: boolean;
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
  linkedinUrl: string;
  displayName: string;
  firstName: string;
  lastName: string;
  company: string;
  position: string;
  location: string;
  sourceId: string;
  status: "to_process" | "processing" | "processed" | "accepted" | "replied" | "failed" | "excluded";
  addedAt: string;
};

export type LeadSourceKind = "linkedin_urls" | "sales_navigator" | "file_upload";

export type LeadSource = {
  id: string;
  kind: LeadSourceKind;
  name: string;
  sourceUrl?: string;
  profileCount: number;
  createdAt: string;
};

export type WorkflowActionType =
  | "connection_request"
  | "wait_for_acceptance"
  | "message"
  | "reply_check";

export type CampaignWorkflowAction = {
  id: string;
  type: WorkflowActionType;
  name: string;
  description: string;
  template?: string;
  automatic: boolean;
  createdAt: string;
};

export type CampaignWorkspaceState = {
  campaign: CampaignSummary;
  actions: CampaignWorkflowAction[];
  leads: LeadProfile[];
  sources: LeadSource[];
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
