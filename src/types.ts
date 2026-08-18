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

export type CampaignStatus = "ready" | "queued" | "running" | "paused" | "sleeping" | "stopped";

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
  headline?: string;
  companyLinkedinUrl?: string;
  salesNavigatorUrl?: string;
  industry?: string;
  about?: string;
  email?: string;
  phone?: string;
  website?: string;
  publicId?: string;
  connectionDegree?: string;
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

export type WorkflowDelayUnit = "minutes" | "hours" | "days";

export type WorkflowDelay = {
  amount: number;
  unit: WorkflowDelayUnit;
};

export type CampaignWorkflowAction = {
  id: string;
  type: WorkflowActionType;
  name: string;
  description: string;
  template?: string;
  delay?: WorkflowDelay;
  automatic: boolean;
  createdAt: string;
};

export type CampaignWorkspaceState = {
  campaign: CampaignSummary;
  actions: CampaignWorkflowAction[];
  leads: LeadProfile[];
  sources: LeadSource[];
};

export type CampaignRunLeadState =
  | "queued"
  | "running"
  | "waiting_acceptance"
  | "waiting_delay"
  | "replied"
  | "completed"
  | "failed"
  | "needs_review"
  | "stopped";

export type CampaignRunState =
  | "validating"
  | "queued"
  | "running"
  | "paused"
  | "sleeping"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed"
  | "needs_attention";

export type CampaignRunLead = {
  id: string;
  lead: LeadProfile;
  state: CampaignRunLeadState;
  actionCursor: number;
  nextEligibleAt: string | null;
  lastErrorCode: string | null;
};

export type CampaignRun = {
  ok: true;
  id: string;
  profileId: string;
  mode: "dry_run" | "live";
  state: CampaignRunState;
  createdAt: string;
  updatedAt: string;
  stopRequested: boolean;
  pauseRequested: boolean;
  sleepingUntil: string | null;
  sleepingReason: string | null;
  snapshot: {
    campaign: CampaignSummary;
    actions: CampaignWorkflowAction[];
    leads: LeadProfile[];
    safety: HumanTouchSettings & { timeZone?: string };
  };
  leads: CampaignRunLead[];
  summary: {
    total: number;
    queued: number;
    running: number;
    sleeping: number;
    completed: number;
    failed: number;
    needsReview: number;
    replied: number;
    stopped: number;
  };
};

export type CampaignAnalyticsTotals = {
  invitesSent: number;
  accepted: number;
  messagesSent: number;
  replies: number;
  acceptanceRate: number;
  replyRate: number;
};

export type CampaignAnalyticsDay = Omit<CampaignAnalyticsTotals, "acceptanceRate" | "replyRate"> & {
  date: string;
};

export type CampaignAnalytics = {
  range: {
    from: string;
    to: string;
    timeZone: string;
  };
  totals: CampaignAnalyticsTotals;
  daily: CampaignAnalyticsDay[];
  campaigns: Array<CampaignAnalyticsTotals & {
    id: string;
    name: string;
  }>;
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
