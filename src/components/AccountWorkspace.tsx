import {
  ArrowLeft,
  Check,
  Chrome,
  Clock3,
  ExternalLink,
  Inbox,
  Layers3,
  Link,
  List,
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
import { createWorkflowAction, removeWorkflowAction } from "../lib/workflow";
import type {
  CampaignWorkflowAction,
  CampaignWorkspaceState,
  ChromeStatus,
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
  chromeStatus: ChromeStatus | null;
  isBusy: boolean;
  onBack: () => void;
  onTabChange: (tab: WorkspaceRouteTab) => void;
  onOpenLinkedIn: () => void;
  onRefreshChrome: () => void;
  onStartChrome: () => void;
  onStopChrome: () => void;
};

export function AccountWorkspace({
  account,
  activeTab,
  chromeStatus,
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
  const linkedInTab = chromeStatus?.tabs.find((tab) => tab.url.includes("linkedin.com")) ?? null;
  const selectedAction = workspace.actions.find((action) => action.id === selectedActionId) ?? null;

  useEffect(() => {
    const nextWorkspace = loadCampaignWorkspace(account);
    setWorkspace(nextWorkspace);
    setSelectedActionId(nextWorkspace.actions[0]?.id ?? "");
  }, [account.id]);

  useEffect(() => {
    saveCampaignWorkspace(account.id, workspace);
  }, [account.id, workspace]);

  const sourceNames = useMemo(
    () => new Map(workspace.sources.map((source) => [source.id, source.name])),
    [workspace.sources]
  );

  function openActionPicker(index: number) {
    setInsertAt(index);
    setActiveModal("action");
  }

  function addAction(type: "connection_request" | "message") {
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
    setWorkspace((current) => ({
      ...current,
      actions: removeWorkflowAction(current.actions, actionId)
    }));
    setSelectedActionId("");
  }

  function saveTemplate(template: string, delay?: WorkflowDelay) {
    if (!selectedAction) return;
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
            <span className="state-badge ready">Ready to start</span>
          </div>
          <Metric label="Total leads" value={workspace.campaign.profilesTotal} />
          <Metric label="To process" value={workspace.campaign.profilesToProcess} />
          <Metric label="Sources" value={workspace.sources.length} />
          <Metric label="Actions" value={workspace.actions.filter((action) => !action.automatic).length} />
        </section>

        <button className="primary-button full-width" disabled={workspace.leads.length === 0}>
          <Play size={17} />
          Start campaign
        </button>
      </aside>

      <section className="workspace-main workflow-workspace-main">
        <header className="workspace-header compact-workspace-header">
          <div>
            <button className="icon-text-button" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
            <h1>{workspace.campaign.name}</h1>
            <p className="status-line">Draft workflow · {workspace.leads.length} leads · same-IP local Chrome</p>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={onStartChrome} disabled={isBusy}>
              <Play size={18} />
              Start Chrome
            </button>
            <button className="icon-button stop" title="Stop Chrome" onClick={onStopChrome} disabled={isBusy}>
              <Square size={17} />
            </button>
          </div>
        </header>

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
                <button className="primary-button" onClick={() => setActiveModal("source")}>
                  <Plus size={17} />
                  Add leads
                </button>
              </header>

              <div className="workflow-canvas functional-workflow-canvas">
                <AddActionButton label="Add first action" onClick={() => openActionPicker(0)} />
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
                      <AddActionButton onClick={() => openActionPicker(index + 1)} />
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
                        <button className="icon-button" title="Edit message" onClick={() => setActiveModal("template")}>
                          <Pencil size={16} />
                        </button>
                      </div>
                      <pre>{selectedAction.template}</pre>
                      <button className="ghost-button" onClick={() => setActiveModal("template")}>
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
                    <button className="danger-text-button" onClick={() => deleteAction(selectedAction.id)}>
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
                  <button className="icon-button" title="Add leads" onClick={() => setActiveModal("source")}>
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
              <button className="primary-button" onClick={() => setActiveModal("source")}>
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
                    <span className="queue-status">To process</span>
                    <span>{formatDate(lead.addedAt)}</span>
                    <button className="icon-button" title="Remove profile" onClick={() => removeLead(lead.id)}>
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
              <p>The LinkedIn login stays in this computer’s existing profile directory and uses this computer’s IP.</p>
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
          initialDelay={selectedAction.type === "message" ? selectedAction.delay : undefined}
          initialTemplate={selectedAction.template}
          maxLength={selectedAction.type === "connection_request" ? 300 : 8000}
          onClose={() => setActiveModal(null)}
          onSave={saveTemplate}
        />
      ) : null}
    </main>
  );
}

function AddActionButton({ label, onClick }: { label?: string; onClick: () => void }) {
  return (
    <button className={`workflow-plus ${label ? "with-label" : ""}`} title="Add action" onClick={onClick}>
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
  if (delay.amount === 0) return "Send immediately";
  const unit = delay.amount === 1 ? delay.unit.replace(/s$/, "") : delay.unit;
  return `Wait ${delay.amount} ${unit}`;
}
