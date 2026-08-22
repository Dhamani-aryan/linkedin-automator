import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BarChart3,
  CheckSquare2,
  Chrome,
  Circle,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCampaignWorkspace,
  deleteCampaignWorkspace,
  loadCampaignWorkspaces,
  saveCampaignWorkspace,
  setCampaignWorkspaceArchived
} from "../lib/campaignStorage";
import { campaignListMetrics, type CampaignOutcomeKey } from "../lib/campaignMetrics";
import {
  listCampaignRuns,
  pauseCampaignRun,
  resumeCampaignRun,
  startCampaignBatch,
  stopCampaignRun
} from "../lib/runnerApi";
import type {
  ChromeStatus,
  CampaignRun,
  CampaignRunState,
  CampaignWorkspaceState,
  HumanTouchSettings,
  LinkedInAccount
} from "../types";
import { SafetyLimitsPage } from "./SafetyLimitsPage";
import { CampaignReports } from "./CampaignReports";

type CampaignFilter = "all" | "running" | "queued" | "paused" | "stopped" | "completed" | "archived";
type DisplayStatus = Exclude<CampaignFilter, "all"> | "ready" | "failed";

type ProfileCampaignsProps = {
  account: LinkedInAccount;
  chromeError?: string;
  chromeStatus: ChromeStatus | null;
  isChromeBusy: boolean;
  safetySettings: HumanTouchSettings;
  onSafetySettingsChange: (settings: HumanTouchSettings) => void;
  onBack: () => void;
  onOpenCampaign: (campaignId: string, leadFilter?: CampaignOutcomeKey) => void;
  onOpenLinkedIn: () => Promise<boolean>;
  onRefreshChrome: () => void;
  onStartChrome: () => Promise<boolean>;
  onStopChrome: () => Promise<boolean>;
};

const filters: Array<{ value: CampaignFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "paused", label: "Paused" },
  { value: "stopped", label: "Stopped" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" }
];

export function ProfileCampaigns({
  account,
  chromeError,
  chromeStatus,
  isChromeBusy,
  safetySettings,
  onSafetySettingsChange,
  onBack,
  onOpenCampaign,
  onOpenLinkedIn,
  onRefreshChrome,
  onStartChrome,
  onStopChrome
}: ProfileCampaignsProps) {
  const [activeSection, setActiveSection] = useState<"campaigns" | "reports" | "browser" | "safety">("campaigns");
  const [campaigns, setCampaigns] = useState(() => loadCampaignWorkspaces(account));
  const [runs, setRuns] = useState<CampaignRun[]>([]);
  const [filter, setFilter] = useState<CampaignFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const linkedInTab = chromeStatus?.tabs.find((tab) => tab.url.includes("linkedin.com")) ?? null;

  const latestRunByCampaign = useMemo(() => {
    const latest = new Map<string, CampaignRun>();
    for (const run of runs) {
      const campaignId = run.snapshot.campaign.id;
      if (!latest.has(campaignId)) latest.set(campaignId, run);
    }
    return latest;
  }, [runs]);

  const rows = useMemo(() => campaigns.map((workspace) => {
    const run = latestRunByCampaign.get(workspace.campaign.id) ?? null;
    return {
      workspace,
      run,
      status: workspace.campaign.archivedAt ? "archived" as const : campaignDisplayStatus(run?.state, workspace),
      metrics: campaignListMetrics(workspace.campaign.id, runs)
    };
  }), [campaigns, latestRunByCampaign, runs]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter(({ workspace, status }) =>
      (filter === "all" ? status !== "archived" : status === filter) &&
      (!normalizedQuery || workspace.campaign.name.toLowerCase().includes(normalizedQuery))
    );
  }, [filter, query, rows]);

  const visibleIds = visibleRows.map(({ workspace }) => workspace.campaign.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  useEffect(() => {
    setCampaigns(loadCampaignWorkspaces(account));
    setSelectedIds(new Set());
    void refreshRuns();
  }, [account.id]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  useEffect(() => {
    const hasLiveState = rows.some(({ status }) => ["running", "queued"].includes(status));
    if (!hasLiveState) return;
    const interval = window.setInterval(() => void refreshRuns(), 3500);
    return () => window.clearInterval(interval);
  }, [rows]);

  async function refreshRuns() {
    try {
      setRuns(await listCampaignRuns(account.id));
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Campaign states could not be refreshed."
      });
    }
  }

  function toggleCampaign(campaignId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  }

  function toggleVisibleCampaigns() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function createCampaign() {
    const name = campaignName.trim();
    if (!name) return;
    const workspace = createCampaignWorkspace(account.id, name);
    saveCampaignWorkspace(account.id, workspace);
    setCampaigns((current) => [...current, workspace]);
    setCampaignName("");
    setIsCreateOpen(false);
    onOpenCampaign(workspace.campaign.id);
  }

  async function startSelectedCampaigns() {
    const selected = rows.filter(({ workspace }) => selectedIds.has(workspace.campaign.id));
    const resumable = selected.filter(({ run }) => run && ["paused", "stopped"].includes(run.state));
    const newRuns = selected.filter(({ run }) => !run || ["completed", "failed"].includes(run.state));
    if (resumable.length === 0 && newRuns.length === 0) return;

    setIsBusy(true);
    setNotice(null);
    try {
      if (newRuns.length > 0) {
        await startCampaignBatch(newRuns.map(({ workspace }) => ({
          profileId: account.id,
          campaign: workspace.campaign,
          actions: workspace.actions,
          leads: workspace.leads,
          safety: {
            ...safetySettings,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          mode: "dry_run"
        })));
      }
      for (const { run, workspace } of resumable) {
        if (run) await resumeCampaignRun(run.id, workspace.actions);
      }
      await refreshRuns();
      setNotice({
        tone: "success",
        message: `${newRuns.length + resumable.length} campaign${newRuns.length + resumable.length === 1 ? "" : "s"} started or queued.`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Selected campaigns could not be started."
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function pauseSelectedCampaigns() {
    await controlSelectedRuns("pause");
  }

  async function stopSelectedCampaigns() {
    await controlSelectedRuns("stop");
  }

  async function controlSelectedRuns(action: "pause" | "stop") {
    const selectedRuns = rows
      .filter(({ workspace, run }) => selectedIds.has(workspace.campaign.id) && run)
      .map(({ run }) => run as CampaignRun)
      .filter((run) => action === "pause"
        ? ["queued", "running", "sleeping"].includes(run.state)
        : ["queued", "running", "sleeping", "paused", "needs_attention", "stopping"].includes(run.state))
      .sort((left, right) => Number(left.state === "running" || left.state === "sleeping") -
        Number(right.state === "running" || right.state === "sleeping"));
    if (selectedRuns.length === 0) return;

    setIsBusy(true);
    setNotice(null);
    try {
      for (const run of selectedRuns) {
        if (action === "pause") await pauseCampaignRun(run.id);
        else await stopCampaignRun(run.id);
      }
      await refreshRuns();
      setNotice({
        tone: "success",
        message: `${selectedRuns.length} campaign${selectedRuns.length === 1 ? "" : "s"} ${action === "pause" ? "paused" : "stopped"}.`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : `Selected campaigns could not be ${action}d.`
      });
    } finally {
      setIsBusy(false);
    }
  }

  function deleteSelectedCampaigns() {
    const deletableIds = rows
      .filter(({ workspace, status }) => selectedIds.has(workspace.campaign.id) &&
        !["running", "queued", "paused"].includes(status))
      .map(({ workspace }) => workspace.campaign.id);
    if (deletableIds.length === 0) return;
    for (const campaignId of deletableIds) deleteCampaignWorkspace(account.id, campaignId);
    setCampaigns((current) => current.filter(({ campaign }) => !deletableIds.includes(campaign.id)));
    setSelectedIds(new Set());
  }

  function setSelectedCampaignsArchived(archived: boolean) {
    const targetIds = rows
      .filter(({ workspace, status }) => selectedIds.has(workspace.campaign.id) &&
        (archived
          ? status !== "archived" && !["running", "queued", "paused"].includes(status)
          : status === "archived"))
      .map(({ workspace }) => workspace.campaign.id);
    if (targetIds.length === 0) return;

    for (const campaignId of targetIds) {
      setCampaignWorkspaceArchived(account.id, campaignId, archived);
    }
    const archivedAt = archived ? new Date().toISOString() : null;
    setCampaigns((current) => current.map((workspace) =>
      targetIds.includes(workspace.campaign.id)
        ? { ...workspace, campaign: { ...workspace.campaign, archivedAt } }
        : workspace
    ));
    setSelectedIds(new Set());
    setNotice({
      tone: "success",
      message: `${targetIds.length} campaign${targetIds.length === 1 ? "" : "s"} ${archived ? "archived" : "restored"}.`
    });
  }

  const selectedCount = selectedIds.size;
  const canStart = rows.some(({ workspace, status }) =>
    selectedIds.has(workspace.campaign.id) && status !== "archived" && ["ready", "paused", "stopped", "completed", "failed"].includes(status));
  const canPause = rows.some(({ workspace, status }) =>
    selectedIds.has(workspace.campaign.id) && ["running", "queued"].includes(status));
  const canStop = rows.some(({ workspace, status }) =>
    selectedIds.has(workspace.campaign.id) && ["running", "queued", "paused"].includes(status));
  const canArchive = rows.some(({ workspace, status }) =>
    selectedIds.has(workspace.campaign.id) && status !== "archived" && !["running", "queued", "paused"].includes(status));
  const canRestore = rows.some(({ workspace, status }) =>
    selectedIds.has(workspace.campaign.id) && status === "archived");
  const activeCampaignCount = rows.filter(({ status }) => ["running", "queued", "paused"].includes(status)).length;
  const totalLeadCount = campaigns.reduce((total, workspace) => total + workspace.campaign.profilesTotal, 0);

  return (
    <main className="workspace-layout profile-workspace-layout">
      <aside className="workspace-sidebar profile-home-sidebar">
        <button className="back-link" onClick={onBack}><ArrowLeft size={17} /> All profiles</button>

        <section className="workspace-profile">
          <div className="profile-avatar">in</div>
          <div>
            <strong>{account.name}</strong>
            <span>{chromeStatus?.connected ? "Chrome connected" : "Chrome stopped"}</span>
          </div>
        </section>

        <nav className="campaign-nav">
          <button className={`nav-item ${activeSection === "campaigns" ? "active" : ""}`} onClick={() => setActiveSection("campaigns")}>
            <CheckSquare2 size={17} /> Campaigns
          </button>
          <button className={`nav-item ${activeSection === "reports" ? "active" : ""}`} onClick={() => setActiveSection("reports")}>
            <BarChart3 size={17} /> Reports
          </button>
          <button className={`nav-item ${activeSection === "browser" ? "active" : ""}`} onClick={() => setActiveSection("browser")}>
            <Chrome size={17} /> LinkedIn browser
          </button>
          <button className={`nav-item ${activeSection === "safety" ? "active" : ""}`} onClick={() => setActiveSection("safety")}>
            <ShieldCheck size={17} /> Safety limits
          </button>
        </nav>

        <section className="profile-workspace-summary">
          <span>Workspace overview</span>
          <div><small>Campaigns</small><strong>{campaigns.length}</strong></div>
          <div><small>Active or queued</small><strong>{activeCampaignCount}</strong></div>
          <div><small>Total leads</small><strong>{totalLeadCount}</strong></div>
        </section>
      </aside>

      <section className="workspace-main profile-home-main">
        <header className="workspace-header compact-workspace-header campaign-home-header">
          <div>
            <p className="eyebrow">{account.name} workspace</p>
            <h1>{activeSection === "campaigns" ? "Campaigns" : activeSection === "reports" ? "Reports" : activeSection === "browser" ? "LinkedIn browser" : "Safety limits"}</h1>
            <p className="status-line">
              {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} <span>|</span> {totalLeadCount} lead{totalLeadCount === 1 ? "" : "s"} <span>|</span> same-IP local Chrome
            </p>
          </div>
          <div className="header-actions">
            {activeSection === "campaigns" ? (
              <button className="primary-button" onClick={() => setIsCreateOpen(true)}>
                <Plus size={18} /> New campaign
              </button>
            ) : null}
            <button className="ghost-button" onClick={() => void onStartChrome()} disabled={isChromeBusy}>
              {isChromeBusy ? <LoaderCircle className="spin" size={17} /> : <Chrome size={17} />}
              {chromeStatus?.connected ? "Chrome running" : "Start Chrome"}
            </button>
          </div>
        </header>

        {chromeError ? (
          <div className="workspace-feedback error" role="alert">
            <span>{chromeError}</span>
            <button type="button" onClick={() => void onStartChrome()} disabled={isChromeBusy}>Try again</button>
          </div>
        ) : null}

        {activeSection === "campaigns" ? (
          <div className="campaign-index-page integrated-campaign-index">
            <section className="campaign-index-toolbar" aria-label="Campaign filters and search">
              <div className="campaign-filter-tabs">
                {filters.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={filter === item.value ? "active" : ""}
                    onClick={() => {
                      setFilter(item.value);
                      setSelectedIds(new Set());
                    }}
                  >
                    {item.label}
                    <span>{item.value === "all" ? rows.filter(({ status }) => status !== "archived").length : rows.filter(({ status }) => status === item.value).length}</span>
                  </button>
                ))}
              </div>
              <label className="campaign-search">
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search campaigns" />
              </label>
            </section>

            {selectedCount > 0 ? (
              <section className="campaign-bulk-bar" aria-label="Selected campaign actions">
                <span><CheckSquare2 size={17} /> {selectedCount} selected</span>
                <div>
                  <button className="ghost-button" disabled={isBusy || !canStart} onClick={() => void startSelectedCampaigns()}>
                    {isBusy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Start
                  </button>
                  <button className="ghost-button" disabled={isBusy || !canPause} onClick={() => void pauseSelectedCampaigns()}>
                    <Pause size={16} /> Pause
                  </button>
                  <button className="danger-button" disabled={isBusy || !canStop} onClick={() => void stopSelectedCampaigns()}>
                    <Square size={15} /> Stop
                  </button>
                  {canRestore ? (
                    <button className="ghost-button" disabled={isBusy} onClick={() => setSelectedCampaignsArchived(false)}>
                      <ArchiveRestore size={16} /> Restore
                    </button>
                  ) : (
                    <button className="ghost-button" disabled={isBusy || !canArchive} onClick={() => setSelectedCampaignsArchived(true)}>
                      <Archive size={16} /> Archive
                    </button>
                  )}
                  <button className="icon-button" title="Delete selected campaigns" disabled={isBusy} onClick={deleteSelectedCampaigns}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </section>
            ) : null}

            {notice ? (
              <div className={`workspace-feedback ${notice.tone}`} role="status">
                <span>{notice.message}</span>
                <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
              </div>
            ) : null}

            <section className="campaign-index-table">
              <div className="campaign-index-table-header">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all visible campaigns"
                  checked={allVisibleSelected}
                  onChange={toggleVisibleCampaigns}
                />
                <span>Campaign</span><span>Status</span><span>Leads</span><span>Invited</span><span>Accepted</span><span>Messaged</span><span>Replied</span><span>Failed</span><span>Actions</span><span />
              </div>
              {visibleRows.length === 0 ? (
                <div className="campaign-index-empty">
                  <strong>{campaigns.length === 0 ? "No campaigns yet" : "No campaigns match this view"}</strong>
                  <p>{campaigns.length === 0 ? "Create a campaign to build its workflow and add LinkedIn leads." : "Change the filter or search term."}</p>
                </div>
              ) : visibleRows.map(({ workspace, status, metrics }) => {
                const campaign = workspace.campaign;
                return (
                  <div className="campaign-index-row" key={campaign.id}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${campaign.name}`}
                      checked={selectedIds.has(campaign.id)}
                      onChange={() => toggleCampaign(campaign.id)}
                    />
                    <button className="campaign-name-button" onClick={() => onOpenCampaign(campaign.id)}>
                      <strong>{campaign.name}</strong>
                      <span>{workspace.sources.length} source{workspace.sources.length === 1 ? "" : "s"}</span>
                    </button>
                    <span className={`state-badge ${status}`}><Circle size={9} fill="currentColor" /> {statusLabel(status)}</span>
                    <span className="campaign-table-number campaign-lead-total" data-label="Leads">{campaign.profilesTotal}</span>
                    <button type="button" className="campaign-outcome-number invited" data-label="Invited" aria-label={`View invited prospects (${metrics.invited})`} title={`View ${metrics.invited} invited prospect${metrics.invited === 1 ? "" : "s"}`} onClick={() => onOpenCampaign(campaign.id, "invited")}>{metrics.invited}</button>
                    <button type="button" className="campaign-outcome-number accepted" data-label="Accepted" aria-label={`View accepted prospects (${metrics.accepted})`} title={`View ${metrics.accepted} accepted prospect${metrics.accepted === 1 ? "" : "s"}`} onClick={() => onOpenCampaign(campaign.id, "accepted")}>{metrics.accepted}</button>
                    <button type="button" className="campaign-outcome-number messaged" data-label="Messaged" aria-label={`View messaged prospects (${metrics.messaged})`} title={`View ${metrics.messaged} messaged prospect${metrics.messaged === 1 ? "" : "s"}`} onClick={() => onOpenCampaign(campaign.id, "messaged")}>{metrics.messaged}</button>
                    <button type="button" className="campaign-outcome-number replied" data-label="Replied" aria-label={`View replied prospects (${metrics.replied})`} title={`View ${metrics.replied} replied prospect${metrics.replied === 1 ? "" : "s"}`} onClick={() => onOpenCampaign(campaign.id, "replied")}>{metrics.replied}</button>
                    <button type="button" className="campaign-outcome-number failed" data-label="Failed" aria-label={`View failed prospects (${metrics.failed})`} title={`View ${metrics.failed} failed prospect${metrics.failed === 1 ? "" : "s"}`} onClick={() => onOpenCampaign(campaign.id, "failed")}>{metrics.failed}</button>
                    <span className="campaign-table-number campaign-action-total" data-label="Actions">{workspace.actions.filter((action) => !action.automatic).length}</span>
                    <button className="ghost-button compact-button" onClick={() => onOpenCampaign(campaign.id)}>Open</button>
                  </div>
                );
              })}
            </section>
          </div>
        ) : null}

        {activeSection === "browser" ? (
          <section className="browser-view profile-browser-view">
            <div className="browser-view-copy">
              <p className="section-kicker">Persistent local session</p>
              <h2>{chromeStatus?.connected ? "Managed Chrome is connected" : "Start managed Chrome"}</h2>
              <p>The LinkedIn login stays in this computer's profile directory and uses this computer's IP.</p>
              <div className="browser-view-actions">
                <button className="primary-button" onClick={() => void onOpenLinkedIn()} disabled={isChromeBusy}>
                  <Chrome size={18} /> Open LinkedIn
                </button>
                <button className="ghost-button" onClick={onRefreshChrome} disabled={isChromeBusy}>
                  <RefreshCw size={17} /> Refresh status
                </button>
                <button className="icon-button stop" title="Stop Chrome" onClick={() => void onStopChrome()} disabled={isChromeBusy}>
                  <Square size={17} />
                </button>
              </div>
            </div>
            <div className="browser-status-panel">
              <div><span>Status</span><strong>{chromeStatus?.connected ? "Connected" : "Stopped"}</strong></div>
              <div><span>Profile directory</span><strong>{chromeStatus?.profileDir ?? ".local/chrome-profile"}</strong></div>
              <div><span>LinkedIn tab</span><strong>{linkedInTab?.title || "Not open"}</strong></div>
              {linkedInTab ? <a href={linkedInTab.url} target="_blank" rel="noreferrer">{linkedInTab.url}</a> : null}
            </div>
          </section>
        ) : null}

        {activeSection === "reports" ? (
          <CampaignReports profileId={account.id} campaigns={campaigns} />
        ) : null}

        {activeSection === "safety" ? (
          <SafetyLimitsPage settings={safetySettings} onChange={onSafetySettingsChange} />
        ) : null}
      </section>

      {isCreateOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-campaign-title">
          <form className="confirm-modal campaign-create-modal" onSubmit={(event) => { event.preventDefault(); createCampaign(); }}>
            <div className="confirm-icon"><Plus size={21} /></div>
            <div>
              <h2 id="new-campaign-title">New campaign</h2>
              <label htmlFor="campaign-name">Campaign name</label>
              <input
                id="campaign-name"
                autoFocus
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
                placeholder="e.g. Founder outreach"
              />
            </div>
            <footer className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setIsCreateOpen(false)}>Cancel</button>
              <button className="primary-button" type="submit" disabled={!campaignName.trim()}><Plus size={17} /> Create</button>
            </footer>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function campaignDisplayStatus(
  runState: CampaignRunState | undefined,
  workspace: CampaignWorkspaceState
): DisplayStatus {
  if (!runState) return workspace.campaign.status === "sleeping" ? "running" : workspace.campaign.status;
  if (["running", "sleeping", "stopping"].includes(runState)) return "running";
  if (runState === "needs_attention") return "paused";
  if (["queued", "paused", "stopped", "completed", "failed"].includes(runState)) return runState as DisplayStatus;
  return "ready";
}

function statusLabel(status: DisplayStatus) {
  if (status === "ready") return "Ready";
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}
