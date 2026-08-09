import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Chrome,
  Clock3,
  ExternalLink,
  Inbox,
  Layers3,
  Link,
  List,
  LoaderCircle,
  MessageSquare,
  MessageSquareReply,
  Navigation,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { collectVisibleProfiles } from "../lib/chromeApi";
import type { WorkspaceRouteTab } from "../lib/appRoute";
import {
  createLeadFromUrl,
  loadCampaignWorkspace,
  saveCampaignWorkspace
} from "../lib/campaignStorage";
import {
  getActiveCampaignRun,
  getCampaignRun,
  startCampaignRun,
  stopCampaignRun
} from "../lib/runnerApi";
import { createWorkflowAction, removeWorkflowAction } from "../lib/workflow";
import type {
  CampaignRun,
  CampaignWorkflowAction,
  CampaignWorkspaceState,
  ChromeStatus,
  HumanTouchSettings,
  LeadSource,
  LinkedInAccount,
  WorkflowDelay,
  WorkflowActionType
} from "../types";
import { LeadSourceWizard, type LeadImportPayload } from "./LeadSourceWizard";
import { MessageTemplateEditor } from "./MessageTemplateEditor";
import { WorkflowActionPicker } from "./WorkflowActionPicker";

type WorkspaceProps = {
  account: LinkedInAccount;
  activeTab: WorkspaceRouteTab;
  chromeError?: string;
  chromeStatus: ChromeStatus | null;
  safetySettings: HumanTouchSettings;
  isBusy: boolean;
  onBack: () => void;
  onTabChange: (tab: WorkspaceRouteTab) => void;
  onOpenLinkedIn: () => Promise<boolean>;
  onRefreshChrome: () => void;
  onStartChrome: () => Promise<boolean>;
  onStopChrome: () => Promise<boolean>;
};

export function AccountWorkspace({
  account,
  activeTab,
  chromeError,
  chromeStatus,
  safetySettings,
  isBusy,
  onBack,
  onTabChange,
  onOpenLinkedIn,
  onRefreshChrome,
  onStartChrome,
  onStopChrome
}: WorkspaceProps) {
  const [workspace, setWorkspace] = useState<CampaignWorkspaceState>(() => loadCampaignWorkspace(account));
  const [activeModal, setActiveModal] = useState<"source" | "action" | "template" | null>(null);
  const [insertAt, setInsertAt] = useState(0);
  const [selectedActionId, setSelectedActionId] = useState(() => workspace.actions[0]?.id ?? "");
  const [isStartConfirmationOpen, setIsStartConfirmationOpen] = useState(false);
  const [isCampaignBusy, setIsCampaignBusy] = useState(false);
  const [activeRun, setActiveRun] = useState<CampaignRun | null>(null);
  const [campaignNotice, setCampaignNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const linkedInTab = chromeStatus?.tabs.find((tab) => tab.url.includes("linkedin.com")) ?? null;
  const selectedAction = workspace.actions.find((action) => action.id === selectedActionId) ?? null;
  const firstMessageActionId = workspace.actions.find((action) => action.type === "message")?.id ?? null;
  const hasActiveServerRun =
    activeRun !== null && ["running", "sleeping", "stopping", "needs_attention"].includes(activeRun.state);

  useEffect(() => {
    const nextWorkspace = loadCampaignWorkspace(account);
    setWorkspace(nextWorkspace);
    setSelectedActionId(nextWorkspace.actions[0]?.id ?? "");
    setActiveRun(null);
  }, [account.id]);

  useEffect(() => {
    saveCampaignWorkspace(account.id, workspace);
  }, [account.id, workspace]);

  useEffect(() => {
    let cancelled = false;
    void getActiveCampaignRun()
      .then((run) => {
        if (!cancelled && run?.profileId === account.id) {
          setActiveRun(run);
          syncCampaignStatus(run);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  useEffect(() => {
    if (!activeRun || ["completed", "failed", "stopped"].includes(activeRun.state)) return;
    const interval = window.setInterval(() => {
      void getCampaignRun(activeRun.id)
        .then((run) => {
          setActiveRun(run);
          syncCampaignStatus(run);
        })
        .catch((error) => {
          setCampaignNotice({
            tone: "error",
            message: error instanceof Error ? error.message : "Could not refresh campaign run state."
          });
        });
    }, 4000);
    return () => window.clearInterval(interval);
  }, [activeRun?.id, activeRun?.state]);

  const sourceNames = useMemo(
    () => new Map(workspace.sources.map((source) => [source.id, source.name])),
    [workspace.sources]
  );

  function openActionPicker(index: number) {
    setInsertAt(index);
    setActiveModal("action");
  }

  function addAction(type: "connection_request" | "message") {
    if (hasActiveServerRun) return;
    const addedActions = createWorkflowAction(type);
    setWorkspace((current) => ({
      ...current,
      actions: [
        ...current.actions.slice(0, insertAt),
        ...addedActions,
        ...current.actions.slice(insertAt)
      ]
    }));
    setSelectedActionId(addedActions[0].id);
    setActiveModal(null);
  }

  function deleteAction(actionId: string) {
    if (hasActiveServerRun) return;
    setWorkspace((current) => ({
      ...current,
      actions: removeWorkflowAction(current.actions, actionId)
    }));
    setSelectedActionId("");
  }

  function saveTemplate(template: string, delay?: WorkflowDelay) {
    if (!selectedAction || hasActiveServerRun) return;
    setWorkspace((current) => ({
      ...current,
      actions: current.actions.map((action) =>
        action.id === selectedAction.id
          ? { ...action, template, ...(action.type === "message" && delay ? { delay } : {}) }
          : action
      )
    }));
    setActiveModal(null);
  }

  function addProfiles(payload: LeadImportPayload) {
    if (hasActiveServerRun) return { added: 0, duplicates: 0 };
    const existingUrls = new Set(workspace.leads.map((lead) => lead.linkedinUrl.toLowerCase()));
    let duplicates = 0;
    const sourceId = crypto.randomUUID();
    const uniqueProfiles = payload.profiles.filter((profile) => {
      const key = profile.url.toLowerCase();
      if (existingUrls.has(key)) {
        duplicates += 1;
        return false;
      }
      existingUrls.add(key);
      return true;
    });
    const newLeads = uniqueProfiles.map((profile) => {
      const lead = createLeadFromUrl(profile.url, sourceId);
      return profile.name.trim() ? { ...lead, displayName: profile.name.trim() } : lead;
    });

    if (newLeads.length > 0) {
      const source: LeadSource = {
        id: sourceId,
        kind: payload.kind,
        name: payload.name,
        sourceUrl: payload.sourceUrl,
        profileCount: newLeads.length,
        createdAt: new Date().toISOString()
      };
      setWorkspace((current) => {
        const leads = [...current.leads, ...newLeads];
        return {
          ...current,
          campaign: {
            ...current.campaign,
            profilesTotal: leads.length,
            profilesToProcess: leads.filter((lead) => lead.status === "to_process").length
          },
          leads,
          sources: [...current.sources, source]
        };
      });
    }

    return { added: newLeads.length, duplicates };
  }

  function removeLead(leadId: string) {
    if (hasActiveServerRun) return;
    setWorkspace((current) => {
      const removedLead = current.leads.find((lead) => lead.id === leadId);
      const leads = current.leads.filter((lead) => lead.id !== leadId);
      const sources = removedLead
        ? current.sources.flatMap((source) => {
            if (source.id !== removedLead.sourceId) return [source];
            const profileCount = leads.filter((lead) => lead.sourceId === source.id).length;
            return profileCount > 0 ? [{ ...source, profileCount }] : [];
          })
        : current.sources;
      return {
        ...current,
        campaign: {
          ...current.campaign,
          profilesTotal: leads.length,
          profilesToProcess: leads.filter((lead) => lead.status === "to_process").length
        },
        leads,
        sources
      };
    });
  }

  async function collectSalesNavigator(sourceUrl: string) {
    const result = await collectVisibleProfiles(sourceUrl);
    onRefreshChrome();
    return result.profiles;
  }

  function requestCampaignStart() {
    setCampaignNotice(null);
    if (workspace.leads.length === 0) {
      setActiveModal("source");
      return;
    }
    if (!workspace.actions.some((action) => !action.automatic)) {
      setCampaignNotice({
        tone: "error",
        message: "Add at least one connection request or message action before starting."
      });
      return;
    }
    setIsStartConfirmationOpen(true);
  }

  async function confirmCampaignStart() {
    setIsCampaignBusy(true);
    setCampaignNotice(null);
    const chromeReady = chromeStatus?.connected || (await onStartChrome());
    if (!chromeReady) {
      setCampaignNotice({
        tone: "error",
        message: "Campaign could not start because managed Chrome is not connected."
      });
      setIsCampaignBusy(false);
      setIsStartConfirmationOpen(false);
      return;
    }

    try {
      const run = await startCampaignRun({
        profileId: account.id,
        campaign: workspace.campaign,
        actions: workspace.actions,
        leads: workspace.leads,
        safety: {
          ...safetySettings,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        mode: "dry_run"
      });
      setActiveRun(run);
      syncCampaignStatus(run);
      setCampaignNotice({
        tone: "success",
        message: "Dry-run campaign started. The runner will navigate and audit what it would send without clicking Send."
      });
    } catch (error) {
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Campaign could not start."
      });
    } finally {
      setIsCampaignBusy(false);
      setIsStartConfirmationOpen(false);
    }
  }

  async function stopCampaign() {
    if (!activeRun) {
      setWorkspace((current) => ({
        ...current,
        campaign: { ...current.campaign, status: "stopped" }
      }));
      return;
    }

    setIsCampaignBusy(true);
    try {
      const run = await stopCampaignRun(activeRun.id);
      setActiveRun(run);
      syncCampaignStatus(run);
      setCampaignNotice({
        tone: "success",
        message: "Stop requested. The runner will halt at the next safe checkpoint."
      });
    } catch (error) {
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Campaign could not be stopped."
      });
    } finally {
      setIsCampaignBusy(false);
    }
  }

  function syncCampaignStatus(run: CampaignRun) {
    const status = run.state === "sleeping"
      ? "sleeping"
      : ["running", "stopping", "needs_attention"].includes(run.state)
        ? "running"
        : run.state === "stopped"
          ? "stopped"
          : "ready";
    setWorkspace((current) => ({
      ...current,
      campaign: { ...current.campaign, status }
    }));
  }

  return (
    <main className="workspace-layout">
      <aside className="workspace-sidebar">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={18} />
          All profiles
        </button>

        <section className="workspace-profile">
          <div className="profile-avatar">in</div>
          <div>
            <strong>{account.name}</strong>
            <span>{chromeStatus?.connected ? "Chrome connected" : "Chrome stopped"}</span>
          </div>
        </section>

        <nav className="campaign-nav">
          <button className="nav-item active">
            <Layers3 size={17} />
            Workspace
          </button>
          <button className="nav-item" onClick={() => onTabChange("browser")}>
            <Chrome size={17} />
            LinkedIn browser
          </button>
        </nav>

        <section className="campaign-mini-card">
          <div className="campaign-title-row">
            <strong>{workspace.campaign.name}</strong>
            <span className={`state-badge ${workspace.campaign.status}`}>
              {campaignStatusLabel(workspace.campaign.status)}
            </span>
          </div>
          <Metric label="Total leads" value={workspace.campaign.profilesTotal} />
          <Metric label="To process" value={workspace.campaign.profilesToProcess} />
          <Metric label="Sources" value={workspace.sources.length} />
          <Metric label="Actions" value={workspace.actions.filter((action) => !action.automatic).length} />
        </section>

        <button
          className={`full-width ${workspace.campaign.status === "running" ? "danger-button" : "primary-button"}`}
          onClick={hasActiveServerRun ? () => void stopCampaign() : requestCampaignStart}
          disabled={isCampaignBusy}
        >
          {hasActiveServerRun ? <Square size={17} /> : <Play size={17} />}
          {hasActiveServerRun
            ? "Stop campaign"
            : workspace.leads.length === 0
              ? "Add leads to start"
              : "Start campaign"}
        </button>
      </aside>

      <section className="workspace-main workflow-workspace-main">
        <header className="workspace-header compact-workspace-header">
          <div>
            <button className="icon-text-button" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
            <h1>{workspace.campaign.name}</h1>
            <p className="status-line">
              {campaignStatusLabel(workspace.campaign.status)} workflow <span>|</span> {workspace.leads.length} leads <span>|</span> same-IP local Chrome
            </p>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={onStartChrome} disabled={isBusy}>
              {isBusy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
              {isBusy ? "Starting Chrome" : chromeStatus?.connected ? "Chrome running" : "Start Chrome"}
            </button>
            <button className="icon-button stop" title="Stop Chrome" onClick={onStopChrome} disabled={isBusy}>
              <Square size={17} />
            </button>
          </div>
        </header>

        {chromeError ? (
          <div className="workspace-feedback error" role="alert">
            <span>{chromeError}</span>
            <button type="button" onClick={onStartChrome} disabled={isBusy}>Try again</button>
          </div>
        ) : null}

        {campaignNotice ? (
          <div className={`workspace-feedback ${campaignNotice.tone}`} role="status">
            <span>{campaignNotice.message}</span>
            <button type="button" onClick={() => setCampaignNotice(null)}>Dismiss</button>
          </div>
        ) : null}

        {activeRun ? (
          <div className="workspace-feedback success" role="status">
            <span>
              Server run {runStateLabel(activeRun.state)}: {activeRun.summary.completed} completed, {activeRun.summary.sleeping} waiting, {activeRun.summary.needsReview} needs review.
              {activeRun.sleepingUntil ? ` Next check ${formatDate(activeRun.sleepingUntil)}.` : ""}
            </span>
          </div>
        ) : null}

        <section className="workspace-tabs basic-workspace-tabs">
          <button className={`tab-button ${activeTab === "workflow" ? "active" : ""}`} onClick={() => onTabChange("workflow")}>
            <Layers3 size={17} />
            Workflow
          </button>
          <button className={`tab-button ${activeTab === "leads" ? "active" : ""}`} onClick={() => onTabChange("leads")}>
            <List size={17} />
            Leads <span className="tab-count">{workspace.leads.length}</span>
          </button>
          <button className={`tab-button ${activeTab === "browser" ? "active" : ""}`} onClick={() => onTabChange("browser")}>
            <Chrome size={17} />
            Browser
          </button>
        </section>

        {activeTab === "workflow" ? (
          <section className="workflow-builder-layout">
            <div className="workflow-stage">
              <header className="workflow-stage-header">
                <div>
                  <span className="section-kicker">Leads to process</span>
                  <strong>{workspace.leads.length}</strong>
                </div>
                <button className="primary-button" onClick={() => setActiveModal("source")} disabled={hasActiveServerRun}>
                  <Plus size={17} />
                  Add leads
                </button>
              </header>

              <div className="workflow-canvas functional-workflow-canvas">
                <AddActionButton label="Add first action" onClick={() => openActionPicker(0)} disabled={hasActiveServerRun} />
                {workspace.actions.map((action, index) => (
                  <div className="workflow-node-wrap" key={action.id}>
                    <button
                      className={`workflow-card functional-workflow-card ${action.type} ${
                        selectedActionId === action.id ? "selected" : ""
                      }`}
                      onClick={() => setSelectedActionId(action.id)}
                    >
                      <span className={`workflow-card-icon ${action.type}`}><ActionIcon type={action.type} /></span>
                      <span className="workflow-card-copy">
                        <small>{action.automatic ? "Automatic safety step" : `Action ${manualActionNumber(workspace.actions, index)}`}</small>
                        <strong>{action.name}</strong>
                        <span>{action.description}</span>
                      </span>
                      {action.automatic ? <ShieldCheck className="auto-guard-icon" size={18} /> : null}
                    </button>
                    {workspace.actions[index + 1]?.automatic ? null : (
                      <AddActionButton onClick={() => openActionPicker(index + 1)} disabled={hasActiveServerRun} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <aside className="workflow-inspector">
              {selectedAction ? (
                <>
                  <div className="inspector-title">
                    <span className={`workflow-card-icon ${selectedAction.type}`}>
                      <ActionIcon type={selectedAction.type} />
                    </span>
                    <div>
                      <span>{selectedAction.automatic ? "Automatic step" : "Workflow action"}</span>
                      <h2>{selectedAction.name}</h2>
                    </div>
                  </div>
                  <p className="inspector-description">{selectedAction.description}</p>

                  {selectedAction.type === "message" && selectedAction.delay ? (
                    <section className="message-delay-summary">
                      <Clock3 size={19} />
                      <span>
                        <small>Delivery delay</small>
                        <strong>{formatDelay(selectedAction.delay)}</strong>
                      </span>
                    </section>
                  ) : null}

                  {selectedAction.template !== undefined ? (
                    <section className="message-summary">
                      <div className="message-summary-heading">
                        <span>Message</span>
                        <button className="icon-button" title="Edit message" onClick={() => setActiveModal("template")} disabled={hasActiveServerRun}>
                          <Pencil size={16} />
                        </button>
                      </div>
                      <pre>{selectedAction.template}</pre>
                      <button className="ghost-button" onClick={() => setActiveModal("template")} disabled={hasActiveServerRun}>
                        <MessageSquare size={16} />
                        Edit message
                      </button>
                    </section>
                  ) : (
                    <section className="automatic-step-note">
                      <ShieldCheck size={20} />
                      <div>
                        <strong>Managed automatically</strong>
                        <p>This guard keeps the workflow from contacting leads at the wrong time.</p>
                      </div>
                    </section>
                  )}

                  {!selectedAction.automatic ? (
                    <button className="danger-text-button" onClick={() => deleteAction(selectedAction.id)} disabled={hasActiveServerRun}>
                      <Trash2 size={16} />
                      Remove action and its guard
                    </button>
                  ) : null}
                </>
              ) : (
                <div className="empty-inspector">
                  <Layers3 size={26} />
                  <strong>Select an action</strong>
                  <p>Choose a card to review its message and behavior.</p>
                </div>
              )}

              <section className="source-summary-list">
                <header>
                  <span>Lead sources</span>
                  <button className="icon-button" title="Add leads" onClick={() => setActiveModal("source")} disabled={hasActiveServerRun}>
                    <Plus size={16} />
                  </button>
                </header>
                {workspace.sources.length === 0 ? (
                  <p>No source lists added yet.</p>
                ) : workspace.sources.map((source) => (
                  <div key={source.id}>
                    {source.kind === "sales_navigator" ? <Navigation size={16} /> : <Link size={16} />}
                    <span><strong>{source.name}</strong><small>{source.profileCount} leads</small></span>
                  </div>
                ))}
              </section>
            </aside>
          </section>
        ) : null}

        {activeTab === "leads" ? (
          <section className="profiles-view">
            <header>
              <div>
                <p className="section-kicker">Campaign queue</p>
                <h2>Leads to process</h2>
              </div>
              <button className="primary-button" onClick={() => setActiveModal("source")} disabled={hasActiveServerRun}>
                <Plus size={17} />
                Add leads
              </button>
            </header>
            {workspace.leads.length === 0 ? (
              <div className="empty-profile-list">
                <Users size={28} />
                <strong>No leads added</strong>
                <p>Add individual LinkedIn URLs, paste a list, upload a file, or collect leads from Sales Navigator.</p>
              </div>
            ) : (
              <div className="functional-lead-table">
                <div className="functional-lead-header">
                  <span>Profile</span><span>Source</span><span>Status</span><span>Added</span><span />
                </div>
                {workspace.leads.map((lead) => (
                  <div className="functional-lead-row" key={lead.id}>
                    <div className="lead-identity">
                      <div className="profile-avatar small">in</div>
                      <div>
                        <strong>{lead.displayName}</strong>
                        <a href={lead.linkedinUrl} target="_blank" rel="noreferrer">
                          {lead.linkedinUrl}<ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                    <span>{sourceNames.get(lead.sourceId) ?? "Imported list"}</span>
                    <span className="queue-status">{leadRunLabel(activeRun, lead.id)}</span>
                    <span>{formatDate(lead.addedAt)}</span>
                    <button className="icon-button" title="Remove profile" onClick={() => removeLead(lead.id)} disabled={hasActiveServerRun}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "browser" ? (
          <section className="browser-view">
            <div className="browser-view-copy">
              <p className="section-kicker">Persistent local session</p>
              <h2>{chromeStatus?.connected ? "Managed Chrome is connected" : "Start managed Chrome"}</h2>
              <p>The LinkedIn login stays in this computer's existing profile directory and uses this computer's IP.</p>
              <div className="browser-view-actions">
                <button className="primary-button" onClick={onOpenLinkedIn} disabled={isBusy}>
                  <Chrome size={18} /> Open LinkedIn
                </button>
                <button className="ghost-button" onClick={onRefreshChrome}>
                  <RefreshCw size={17} /> Refresh status
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
      </section>

      {activeModal === "source" ? (
        <LeadSourceWizard
          onAddProfiles={addProfiles}
          onClose={() => setActiveModal(null)}
          onCollectSalesNavigator={collectSalesNavigator}
        />
      ) : null}
      {activeModal === "action" ? (
        <WorkflowActionPicker onAdd={addAction} onClose={() => setActiveModal(null)} />
      ) : null}
      {activeModal === "template" && selectedAction?.template !== undefined ? (
        <MessageTemplateEditor
          actionLabel={selectedAction.name}
          allowSendNow={selectedAction.id === firstMessageActionId}
          initialDelay={selectedAction.type === "message" ? selectedAction.delay : undefined}
          initialTemplate={selectedAction.template}
          maxLength={selectedAction.type === "connection_request" ? 300 : 8000}
          onClose={() => setActiveModal(null)}
          onSave={saveTemplate}
        />
      ) : null}
      {isStartConfirmationOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="start-campaign-title">
          <section className="confirm-modal campaign-start-modal">
            <div className="confirm-icon campaign-start-icon">
              <Play size={22} />
            </div>
            <div>
              <h2 id="start-campaign-title">Start this campaign?</h2>
              <p>
                This activates <strong>{workspace.campaign.name}</strong> with {workspace.leads.length} lead{workspace.leads.length === 1 ? "" : "s"} and {workspace.actions.filter((action) => !action.automatic).length} workflow action{workspace.actions.filter((action) => !action.automatic).length === 1 ? "" : "s"}.
              </p>
              <div className="campaign-preflight-list">
                <span><Check size={16} /> Workflow and leads are saved</span>
                <span><Check size={16} /> Managed Chrome will start if needed</span>
                <span><AlertTriangle size={16} /> Dry run only: no Send buttons are clicked</span>
              </div>
            </div>
            <footer className="modal-actions">
              <button className="ghost-button" onClick={() => setIsStartConfirmationOpen(false)} disabled={isCampaignBusy}>
                Cancel
              </button>
              <button className="primary-button" onClick={() => void confirmCampaignStart()} disabled={isCampaignBusy}>
                {isCampaignBusy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
                {isCampaignBusy ? "Starting" : "Start campaign"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function AddActionButton({ label, onClick, disabled = false }: { label?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className={`workflow-plus ${label ? "with-label" : ""}`} title="Add action" onClick={onClick} disabled={disabled}>
      <Plus size={17} />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

function ActionIcon({ type }: { type: WorkflowActionType }) {
  if (type === "connection_request") return <UserPlus size={20} />;
  if (type === "wait_for_acceptance") return <Clock3 size={20} />;
  if (type === "message") return <MessageSquare size={20} />;
  return <MessageSquareReply size={20} />;
}

function manualActionNumber(actions: CampaignWorkflowAction[], index: number) {
  return actions.slice(0, index + 1).filter((action) => !action.automatic).length;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="mini-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(value));
}

function formatDelay(delay: WorkflowDelay) {
  if (delay.amount === 0) return "Send now";
  const unit = delay.amount === 1 ? delay.unit.replace(/s$/, "") : delay.unit;
  return `Wait ${delay.amount} ${unit}`;
}

function campaignStatusLabel(status: CampaignWorkspaceState["campaign"]["status"]) {
  if (status === "running") return "Running";
  if (status === "sleeping") return "Sleeping";
  if (status === "stopped") return "Stopped";
  return "Ready to start";
}

function runStateLabel(state: CampaignRun["state"]) {
  if (state === "needs_attention") return "needs attention";
  return state.replace("_", " ");
}

function leadRunLabel(run: CampaignRun | null, leadId: string) {
  const leadRun = run?.leads.find((candidate) => candidate.id === leadId);
  if (!leadRun) return "To process";
  if (leadRun.state === "waiting_acceptance") return "Waiting acceptance";
  if (leadRun.state === "waiting_delay") return "Waiting delay";
  if (leadRun.state === "needs_review") return "Needs review";
  return leadRun.state.replace("_", " ");
}
