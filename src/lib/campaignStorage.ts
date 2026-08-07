import { createDefaultWorkflow } from "./workflow";
import type { CampaignWorkspaceState, LeadProfile, LinkedInAccount } from "../types";

const CAMPAIGN_WORKSPACE_KEY = "linkedin-automator.campaign-workspace-v1";

export function loadCampaignWorkspace(account: LinkedInAccount): CampaignWorkspaceState {
  const stored = readWorkspaceMap();
  return stored[account.id] ? normalizeWorkspace(stored[account.id]) : createInitialCampaignWorkspace(account.id);
}

export function saveCampaignWorkspace(accountId: string, state: CampaignWorkspaceState) {
  const stored = readWorkspaceMap();
  stored[accountId] = state;
  window.localStorage.setItem(CAMPAIGN_WORKSPACE_KEY, JSON.stringify(stored));
}

export function createLeadFromUrl(url: string, sourceId: string): LeadProfile {
  const publicId = extractPublicId(url);
  const displayName = publicId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return {
    id: crypto.randomUUID(),
    linkedinUrl: url,
    displayName: displayName || "LinkedIn profile",
    firstName: displayName.split(" ")[0] ?? "",
    lastName: displayName.split(" ").slice(1).join(" "),
    company: "",
    position: "",
    location: "",
    sourceId,
    status: "to_process",
    addedAt: new Date().toISOString()
  };
}

function createInitialCampaignWorkspace(accountId: string): CampaignWorkspaceState {
  return {
    campaign: {
      id: `${accountId}-first-campaign`,
      name: "First outreach campaign",
      status: "ready",
      profilesTotal: 0,
      profilesToProcess: 0,
      processing: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      accepted: 0,
      replied: 0
    },
    actions: createDefaultWorkflow(),
    leads: [],
    sources: []
  };
}

function readWorkspaceMap(): Record<string, CampaignWorkspaceState> {
  try {
    const stored = window.localStorage.getItem(CAMPAIGN_WORKSPACE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, CampaignWorkspaceState>) : {};
  } catch {
    return {};
  }
}

function normalizeWorkspace(state: CampaignWorkspaceState): CampaignWorkspaceState {
  const sources = state.sources.flatMap((source) => {
    const profileCount = state.leads.filter((lead) => lead.sourceId === source.id).length;
    return profileCount > 0 ? [{ ...source, profileCount }] : [];
  });

  return {
    ...state,
    campaign: {
      ...state.campaign,
      profilesTotal: state.leads.length,
      profilesToProcess: state.leads.filter((lead) => lead.status === "to_process").length
    },
    sources
  };
}

function extractPublicId(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const markerIndex = segments.findIndex((segment) => segment === "in" || segment === "lead");
    const candidate = markerIndex >= 0 ? segments[markerIndex + 1] : segments[segments.length - 1];
    return decodeURIComponent(candidate ?? "").split(",")[0];
  } catch {
    return "";
  }
}
