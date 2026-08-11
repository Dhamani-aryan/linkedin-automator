import { createDefaultWorkflow, defaultMessageDelay } from "./workflow";
import type { CampaignWorkspaceState, LeadProfile, LinkedInAccount } from "../types";

const LEGACY_CAMPAIGN_WORKSPACE_KEY = "linkedin-automator.campaign-workspace-v1";
const CAMPAIGN_WORKSPACES_KEY = "linkedin-automator.campaign-workspaces-v2";

type CampaignStorage = Pick<Storage, "getItem" | "setItem">;

export function loadCampaignWorkspaces(
  account: LinkedInAccount,
  storage: CampaignStorage = window.localStorage
): CampaignWorkspaceState[] {
  const stored = readWorkspaceMap(storage);
  if (stored[account.id]) return stored[account.id].map(normalizeWorkspace);

  const legacyWorkspace = readLegacyWorkspaceMap(storage)[account.id];
  if (!legacyWorkspace) return [];

  const migrated = normalizeWorkspace(legacyWorkspace);
  writeWorkspaceMap({ ...stored, [account.id]: [migrated] }, storage);
  return [migrated];
}

export function loadCampaignWorkspace(
  account: LinkedInAccount,
  campaignId = "",
  storage: CampaignStorage = window.localStorage
): CampaignWorkspaceState {
  const campaigns = loadCampaignWorkspaces(account, storage);
  return campaigns.find((workspace) => workspace.campaign.id === campaignId) ??
    campaigns[0] ??
    createCampaignWorkspace(account.id, "Untitled campaign");
}

export function saveCampaignWorkspace(
  accountId: string,
  state: CampaignWorkspaceState,
  storage: CampaignStorage = window.localStorage
) {
  const stored = readWorkspaceMap(storage);
  const campaigns = stored[accountId] ?? [];
  const existingIndex = campaigns.findIndex((workspace) => workspace.campaign.id === state.campaign.id);
  stored[accountId] = existingIndex < 0
    ? [...campaigns, state]
    : campaigns.map((workspace, index) => index === existingIndex ? state : workspace);
  writeWorkspaceMap(stored, storage);
}

export function createCampaignWorkspace(accountId: string, name: string): CampaignWorkspaceState {
  return {
    campaign: {
      id: `${accountId}-${crypto.randomUUID()}`,
      name: name.trim(),
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

export function deleteCampaignWorkspace(
  accountId: string,
  campaignId: string,
  storage: CampaignStorage = window.localStorage
) {
  const stored = readWorkspaceMap(storage);
  stored[accountId] = (stored[accountId] ?? [])
    .filter((workspace) => workspace.campaign.id !== campaignId);
  writeWorkspaceMap(stored, storage);
}

export function createLeadFromUrl(url: string, sourceId: string, profileName = ""): LeadProfile {
  const displayName = normalizeProfileName(profileName);
  const nameParts = displayName.split(" ").filter(Boolean);

  return {
    id: crypto.randomUUID(),
    linkedinUrl: url,
    displayName: displayName || "LinkedIn profile",
    firstName: nameParts[0] ?? "",
    lastName: nameParts.slice(1).join(" "),
    company: "",
    position: "",
    location: "",
    sourceId,
    status: "to_process",
    addedAt: new Date().toISOString()
  };
}

function normalizeProfileName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readWorkspaceMap(storage: CampaignStorage): Record<string, CampaignWorkspaceState[]> {
  try {
    const stored = storage.getItem(CAMPAIGN_WORKSPACES_KEY);
    return stored ? (JSON.parse(stored) as Record<string, CampaignWorkspaceState[]>) : {};
  } catch {
    return {};
  }
}

function readLegacyWorkspaceMap(storage: CampaignStorage): Record<string, CampaignWorkspaceState> {
  try {
    const stored = storage.getItem(LEGACY_CAMPAIGN_WORKSPACE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, CampaignWorkspaceState>) : {};
  } catch {
    return {};
  }
}

function writeWorkspaceMap(
  workspaces: Record<string, CampaignWorkspaceState[]>,
  storage: CampaignStorage
) {
  storage.setItem(CAMPAIGN_WORKSPACES_KEY, JSON.stringify(workspaces));
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
    actions: state.actions.map((action) => {
      if (action.type === "message" && !action.delay) {
        return { ...action, delay: { ...defaultMessageDelay } };
      }
      if (action.type === "reply_check") {
        return { ...action, description: "Replies stop follow-ups and move the lead to the inbox." };
      }
      return action;
    }),
    sources
  };
}
