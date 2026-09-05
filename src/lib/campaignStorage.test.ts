import { describe, expect, it, vi } from "vitest";
import type { CampaignWorkspaceState, LinkedInAccount } from "../types";
import {
  createCampaignWorkspace,
  createLeadFromUrl,
  deleteCampaignWorkspace,
  loadCampaignWorkspace,
  loadCampaignWorkspaces,
  saveCampaignWorkspace,
  setCampaignWorkspaceArchived
} from "./campaignStorage";

const account: LinkedInAccount = {
  id: "profile-1",
  email: "profile@example.com",
  name: "Profile One",
  state: "stopped",
  role: "Owner",
  chromeProfileMode: "single-local-profile",
  archived: false
};

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };
}

function workspace(id: string, name: string): CampaignWorkspaceState {
  return {
    campaign: {
      id,
      name,
      status: "ready",
      archivedAt: null,
      profilesTotal: 0,
      profilesToProcess: 0,
      processing: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      accepted: 0,
      replied: 0
    },
    actions: [],
    leads: [],
    sources: []
  };
}

describe("createLeadFromUrl", () => {
  it("uses the collected profile name for personalization", () => {
    const lead = createLeadFromUrl(
      "https://www.linkedin.com/in/sample-recipient/",
      "source-1",
      "  Casey   Example  "
    );

    expect(lead.displayName).toBe("Casey Example");
    expect(lead.firstName).toBe("Casey");
    expect(lead.lastName).toBe("Example");
  });

  it("does not treat a profile URL slug as a person's name", () => {
    const lead = createLeadFromUrl("https://www.linkedin.com/in/sample-recipient/", "source-1");

    expect(lead.displayName).toBe("LinkedIn profile");
    expect(lead.firstName).toBe("");
    expect(lead.lastName).toBe("");
  });
});

describe("campaign collections", () => {
  it("starts with no campaigns for a new LinkedIn profile", () => {
    expect(loadCampaignWorkspaces(account, memoryStorage())).toEqual([]);
  });

  it("migrates the existing single campaign without losing it", () => {
    const legacy = workspace("existing-campaign", "Existing campaign");
    const storage = memoryStorage({
      "linkedin-automator.campaign-workspace-v1": JSON.stringify({ [account.id]: legacy })
    });

    expect(loadCampaignWorkspaces(account, storage)).toEqual([legacy]);
    expect(loadCampaignWorkspace(account, legacy.campaign.id, storage)).toEqual(legacy);
  });

  it("adds, updates, and deletes campaigns independently", () => {
    const storage = memoryStorage();
    const first = workspace("campaign-1", "First");
    const second = workspace("campaign-2", "Second");
    saveCampaignWorkspace(account.id, first, storage);
    saveCampaignWorkspace(account.id, second, storage);
    saveCampaignWorkspace(account.id, {
      ...first,
      campaign: { ...first.campaign, name: "Renamed" }
    }, storage);

    expect(loadCampaignWorkspaces(account, storage).map(({ campaign }) => campaign.name))
      .toEqual(["Renamed", "Second"]);

    deleteCampaignWorkspace(account.id, first.campaign.id, storage);
    expect(loadCampaignWorkspaces(account, storage).map(({ campaign }) => campaign.id))
      .toEqual([second.campaign.id]);
  });

  it("archives and restores a campaign without deleting its workspace", () => {
    const storage = memoryStorage();
    const campaign = workspace("campaign-1", "First");
    saveCampaignWorkspace(account.id, campaign, storage);

    setCampaignWorkspaceArchived(account.id, campaign.campaign.id, true, storage);
    const archived = loadCampaignWorkspaces(account, storage)[0];
    expect(archived.campaign.archivedAt).toEqual(expect.any(String));
    expect(archived.actions).toEqual(campaign.actions);
    expect(archived.leads).toEqual(campaign.leads);

    setCampaignWorkspaceArchived(account.id, campaign.campaign.id, false, storage);
    expect(loadCampaignWorkspaces(account, storage)[0].campaign.archivedAt).toBeNull();
  });

  it("creates an empty named campaign with a default workflow", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "new-campaign" });
    const created = createCampaignWorkspace(account.id, "  Prospecting  ");

    expect(created.campaign).toMatchObject({
      id: "profile-1-new-campaign",
      name: "Prospecting",
      status: "ready"
    });
    expect(created.actions.length).toBeGreaterThan(0);
    expect(created.leads).toEqual([]);
    vi.unstubAllGlobals();
  });
});
