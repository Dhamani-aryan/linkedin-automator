import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Chrome,
  Clock3,
  Download,
  ExternalLink,
  Inbox,
  Layers3,
  Link,
  List,
  LoaderCircle,
  MessageSquare,
  MessageSquareReply,
  Navigation,
  Pause,
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
import {
  collectVisibleProfiles,
  mergeResolvedProfileData,
  resolveProfileIdentities,
  type ResolvedProfileIdentity
} from "../lib/chromeApi";
import type { WorkspaceLeadFilter, WorkspaceRouteTab } from "../lib/appRoute";
import { campaignOutcomeRecords } from "../lib/campaignMetrics";
import { SafetyLimitsPage } from "./SafetyLimitsPage";
import {
  createLeadFromUrl,
  loadCampaignWorkspace,
  saveCampaignWorkspace
} from "../lib/campaignStorage";
import {
  getActiveCampaignRun,
  getCampaignRun,
  listCampaignRuns,
  pauseCampaignRun,
  retryCampaignRun,
  resumeCampaignRun,
  startCampaignRun,
  stopCampaignRun
} from "../lib/runnerApi";
import { renderTemplate } from "../lib/templateEngine";
import { buildProspectCsv, prospectCsvFilename } from "../lib/prospectCsv";
import { createWorkflowAction, removeWorkflowAction } from "../lib/workflow";
import type {
  CampaignRun,
  CampaignWorkflowAction,
  CampaignWorkspaceState,
  ChromeStatus,
  HumanTouchSettings,
  LeadProfile,
  LeadSource,
  LinkedInAccount,
  WorkflowDelay,
  WorkflowActionType
} from "../types";
import { LeadSourceWizard, type LeadImportPayload } from "./LeadSourceWizard";
import { MessageTemplateEditor } from "./MessageTemplateEditor";
import { WorkflowActionPicker } from "./WorkflowActionPicker";
import { ReplyNotificationButton } from "./ReplyNotificationButton";

type WorkspaceProps = {
  account: LinkedInAccount;
  campaignId: string;
  activeTab: WorkspaceRouteTab;
  leadFilter?: WorkspaceLeadFilter;
  chromeError?: string;
  chromeStatus: ChromeStatus | null;
  safetySettings: HumanTouchSettings;
  onSafetySettingsChange: (settings: HumanTouchSettings) => void;
  isBusy: boolean;
  onBack: () => void;
  onOpenCampaign: (campaignId: string, leadFilter?: WorkspaceLeadFilter) => void;
  onTabChange: (tab: WorkspaceRouteTab) => void;
  onOpenLinkedIn: () => Promise<boolean>;
  onRefreshChrome: () => void;
  onStartChrome: () => Promise<boolean>;
  onStopChrome: () => Promise<boolean>;
};

const outcomeLabels: Record<WorkspaceLeadFilter, string> = {
  invited: "Invited",
  accepted: "Accepted",
  messaged: "Messaged",
  replied: "Replied",
  failed: "Failed"
};

export function AccountWorkspace({
  account,
  campaignId,
  activeTab,
  leadFilter,
  chromeError,
  chromeStatus,
  safetySettings,
  onSafetySettingsChange,
  isBusy,
  onBack,
  onOpenCampaign,
  onTabChange,
  onOpenLinkedIn,
  onRefreshChrome,
  onStartChrome,
  onStopChrome
}: WorkspaceProps) {
  const [workspace, setWorkspace] = useState<CampaignWorkspaceState>(() => loadCampaignWorkspace(account, campaignId));
  const [activeModal, setActiveModal] = useState<"source" | "action" | "template" | null>(null);
  const [insertAt, setInsertAt] = useState(0);
  const [selectedActionId, setSelectedActionId] = useState(() => workspace.actions[0]?.id ?? "");
  const [isStartConfirmationOpen, setIsStartConfirmationOpen] = useState(false);
  const [startMode, setStartMode] = useState<"dry_run" | "live">("dry_run");
  const [liveSendConfirmed, setLiveSendConfirmed] = useState(false);
  const [isCampaignBusy, setIsCampaignBusy] = useState(false);
  const [prospectOperation, setProspectOperation] = useState<"enrich" | "export" | null>(null);
  const [activeRun, setActiveRun] = useState<CampaignRun | null>(null);
  const [campaignRuns, setCampaignRuns] = useState<CampaignRun[]>([]);
  const [isStartPending, setIsStartPending] = useState(false);
  const [campaignNotice, setCampaignNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const linkedInTab = chromeStatus?.tabs.find((tab) => tab.url.includes("linkedin.com")) ?? null;
  const selectedAction = workspace.actions.find((action) => action.id === selectedActionId) ?? null;
  const firstMessageActionId = workspace.actions.find((action) => action.type === "message")?.id ?? null;
  const hasActiveServerRun =
    activeRun !== null && ["running", "paused", "sleeping", "stopping", "needs_attention"].includes(activeRun.state);
  const nextFollowUpDueAt = activeRun?.leads
    .filter((lead) => lead.state === "waiting_delay" && lead.nextEligibleAt)
    .map((lead) => lead.nextEligibleAt as string)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
  const safetyWindowNotice = getSafetyWindowNotice(safetySettings);
  const liveLeads = workspace.leads.filter((lead) => lead.status !== "excluded");
  const liveMessageActions = workspace.actions.filter(
    (action) => action.type === "message" && !action.automatic
  );
  const firstLiveLead = liveLeads[0] ?? null;
  const firstLiveMessage = liveMessageActions[0] ?? null;
  const hasUnsupportedLiveAction = workspace.actions.some(
    (action) => !action.automatic && action.type !== "message"
  );
  const resolvedLiveMessage = firstLiveLead && firstLiveMessage?.template !== undefined
    ? renderTemplate(firstLiveMessage.template, firstLiveLead)
    : "";
  const liveStartReady = Boolean(
    liveLeads.length > 0 &&
    liveMessageActions.length > 0 &&
    !hasUnsupportedLiveAction &&
    resolvedLiveMessage.length > 0 &&
    liveSendConfirmed
  );

  useEffect(() => {
    const nextWorkspace = loadCampaignWorkspace(account, campaignId);
    setWorkspace(nextWorkspace);
    setSelectedActionId(nextWorkspace.actions[0]?.id ?? "");
    setActiveRun(null);
    setCampaignRuns([]);
    setStartMode("dry_run");
    setLiveSendConfirmed(false);
  }, [account.id, campaignId]);

  useEffect(() => {
    saveCampaignWorkspace(account.id, workspace);
  }, [account.id, workspace]);

  useEffect(() => {
    let cancelled = false;
    void getActiveCampaignRun()
      .then((run) => {
        if (cancelled) return;
        if (run?.profileId === account.id && run.snapshot.campaign.id === campaignId) {
          setActiveRun(run);
          syncCampaignStatus(run);
          return;
        }
        setActiveRun(null);
        setWorkspace((current) =>
          ["running", "paused", "sleeping"].includes(current.campaign.status)
            ? { ...current, campaign: { ...current.campaign, status: "stopped" } }
            : current
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account.id, campaignId]);

  useEffect(() => {
    let cancelled = false;
    const refreshCampaignRuns = () => {
      void listCampaignRuns(account.id)
        .then((runs) => {
          if (!cancelled) setCampaignRuns(runs);
        })
        .catch((error) => {
          if (!cancelled) {
            setCampaignNotice({
              tone: "error",
              message: error instanceof Error ? error.message : "Campaign outcome history could not be loaded."
            });
          }
        });
    };
    refreshCampaignRuns();
    const interval = window.setInterval(refreshCampaignRuns, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [account.id, campaignId]);

  useEffect(() => {
    if (!activeRun || activeRun.snapshot.campaign.id !== campaignId) return;
    setCampaignRuns((current) => [activeRun, ...current.filter((run) => run.id !== activeRun.id)]);
  }, [activeRun, campaignId]);

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
  const selectedOutcomeRecords = useMemo(() => {
    if (!leadFilter) return [];
    const currentLeads = new Map(workspace.leads.map((lead) => [lead.linkedinUrl, lead]));
    return campaignOutcomeRecords(campaignId, campaignRuns)[leadFilter].map((record) => ({
      ...record,
      lead: currentLeads.get(record.lead.linkedinUrl) ?? record.lead
    }));
  }, [campaignId, campaignRuns, leadFilter, workspace.leads]);

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
    const newLeads = uniqueProfiles.map((profile) =>
      createLeadFromUrl(profile.url, sourceId, profile.name)
    );

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

  function downloadProspects(leads: LeadProfile[]) {
    const csv = buildProspectCsv({
      campaignName: workspace.campaign.name,
      leads,
      sources: workspace.sources
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = prospectCsvFilename(workspace.campaign.name);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function resolveProspectData(leads: LeadProfile[]) {
    const chromeReady = chromeStatus?.connected || (await onStartChrome());
    if (!chromeReady) throw new Error("Managed Chrome must be connected to read prospect data from LinkedIn.");

    const resolvedProfiles: ResolvedProfileIdentity[] = [];
    for (let index = 0; index < leads.length; index += 20) {
      const batch = leads.slice(index, index + 20);
      const result = await resolveProfileIdentities(batch.map((lead) => ({ id: lead.id, url: lead.linkedinUrl })));
      resolvedProfiles.push(...result.profiles);
    }
    const resolvedById = new Map(resolvedProfiles.map((profile) => [profile.id, profile]));
    return {
      leads: leads.map((lead) => {
        const identity = resolvedById.get(lead.id);
        return identity?.resolved ? mergeResolvedProfileData(lead, identity) : lead;
      }),
      successful: resolvedProfiles.filter((profile) => profile.resolved).length
    };
  }

  async function exportProspects() {
    if (workspace.leads.length === 0 || hasActiveServerRun || isCampaignBusy) return;
    setIsCampaignBusy(true);
    setProspectOperation("export");
    setCampaignNotice(null);
    try {
      const result = await resolveProspectData(workspace.leads);
      setWorkspace((current) => ({
        ...current,
        leads: result.leads
      }));
      downloadProspects(result.leads);
      const companyCount = result.leads.filter((lead) => lead.company?.trim()).length;
      setCampaignNotice({
        tone: result.successful === workspace.leads.length ? "success" : "error",
        message: `${result.leads.length} prospect${result.leads.length === 1 ? "" : "s"} exported after refreshing ${result.successful} LinkedIn profile${result.successful === 1 ? "" : "s"}. Company data was found for ${companyCount}.`
      });
      onRefreshChrome();
    } catch (error) {
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "The CRM export could not be prepared."
      });
    } finally {
      setProspectOperation(null);
      setIsCampaignBusy(false);
    }
  }

  async function enrichProspects() {
    if (workspace.leads.length === 0 || hasActiveServerRun || isCampaignBusy) return;
    setIsCampaignBusy(true);
    setProspectOperation("enrich");
    setCampaignNotice(null);
    try {
      const result = await resolveProspectData(workspace.leads);
      setWorkspace((current) => ({ ...current, leads: result.leads }));
      setCampaignNotice({
        tone: result.successful === workspace.leads.length ? "success" : "error",
        message: `${result.successful} of ${workspace.leads.length} prospect${workspace.leads.length === 1 ? "" : "s"} enriched from LinkedIn.`
      });
      onRefreshChrome();
    } catch (error) {
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Prospect data could not be enriched."
      });
    } finally {
      setProspectOperation(null);
      setIsCampaignBusy(false);
    }
  }

  async function requestCampaignStart() {
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

    setIsCampaignBusy(true);
    try {
      const chromeReady = chromeStatus?.connected || (await onStartChrome());
      if (!chromeReady) {
        throw new Error("Managed Chrome must be connected before profile names can be read.");
      }

      const identityResult = await resolveProfileIdentities(
        workspace.leads.map((lead) => ({ id: lead.id, url: lead.linkedinUrl }))
      );
      const unresolved = identityResult.profiles.filter((profile) =>
        !profile.resolved || !profile.displayName || !profile.firstName
      );
      if (unresolved.length > 0) {
        throw new Error(
          `${unresolved.length} profile name${unresolved.length === 1 ? "" : "s"} could not be read from LinkedIn. No campaign was started.`
        );
      }

      const identities = new Map(identityResult.profiles.map((profile) => [profile.id, profile]));
      setWorkspace((current) => ({
        ...current,
        leads: current.leads.map((lead) => {
          const identity = identities.get(lead.id);
          return identity?.resolved ? mergeResolvedProfileData(lead, identity) : lead;
        })
      }));
      setLiveSendConfirmed(false);
      setIsStartConfirmationOpen(true);
    } catch (error) {
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Profile names could not be resolved."
      });
    } finally {
      setIsCampaignBusy(false);
    }
  }

  async function confirmCampaignStart() {
    if (startMode === "live" && !liveStartReady) return;

    setIsCampaignBusy(true);
    setIsStartPending(true);
    setCampaignNotice(null);
    const chromeReady = chromeStatus?.connected || (await onStartChrome());
    if (!chromeReady) {
      setCampaignNotice({
        tone: "error",
        message: "Campaign could not start because managed Chrome is not connected."
      });
      setIsCampaignBusy(false);
      setIsStartPending(false);
      setIsStartConfirmationOpen(false);
      return;
    }

    try {
      const runLeads = workspace.leads;
      const run = await startCampaignRun({
        profileId: account.id,
        campaign: workspace.campaign,
        actions: workspace.actions,
        leads: runLeads,
        safety: {
          ...safetySettings,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        mode: startMode,
        ...(startMode === "live"
          ? {
              liveConfirmation: {
                confirmed: true as const,
                leadIds: liveLeads.map((lead) => lead.id),
                actionIds: liveMessageActions.map((action) => action.id),
                firstMessageText: resolvedLiveMessage
              }
            }
          : {})
      });
      setActiveRun(run);
      setIsStartPending(false);
      syncCampaignStatus(run);
      setCampaignNotice({
        tone: "success",
        message: startMode === "live"
          ? `Live campaign started for ${liveLeads.length} lead${liveLeads.length === 1 ? "" : "s"}. Profiles will run one at a time.`
          : "Dry-run campaign started. The runner will navigate and audit what it would send without clicking Send."
      });
    } catch (error) {
      setIsStartPending(false);
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Campaign could not start."
      });
    } finally {
      setIsCampaignBusy(false);
      setIsStartConfirmationOpen(false);
      setLiveSendConfirmed(false);
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

  async function pauseCampaign() {
    if (!activeRun) return;

    setIsCampaignBusy(true);
    try {
      const run = await pauseCampaignRun(activeRun.id);
      setActiveRun(run);
      syncCampaignStatus(run);
      setCampaignNotice({
        tone: "success",
        message: "Campaign paused. The current action is preserved and no message will be sent while paused."
      });
    } catch (error) {
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Campaign could not be paused."
      });
    } finally {
      setIsCampaignBusy(false);
    }
  }

  async function resumeCampaign() {
    if (!activeRun) return;

    const restarting = activeRun.state === "stopped";
    setIsCampaignBusy(true);
    try {
      const run = await resumeCampaignRun(activeRun.id, workspace.actions);
      setActiveRun(run);
      syncCampaignStatus(run);
      setCampaignNotice({
        tone: "success",
        message: restarting
          ? "Campaign restarted from its saved action with pending follow-up times recalculated."
          : "Campaign resumed with pending follow-up times recalculated."
      });
    } catch (error) {
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Campaign could not be resumed."
      });
    } finally {
      setIsCampaignBusy(false);
    }
  }

  async function retryCampaignLead() {
    if (!activeRun) return;

    setIsCampaignBusy(true);
    try {
      const run = await retryCampaignRun(activeRun.id);
      setActiveRun(run);
      syncCampaignStatus(run);
      setCampaignNotice({
        tone: "success",
        message: "Retrying the same lead from its last safe checkpoint."
      });
    } catch (error) {
      setCampaignNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "The lead could not be retried safely."
      });
    } finally {
      setIsCampaignBusy(false);
    }
  }

  function syncCampaignStatus(run: CampaignRun) {
    const status = run.state === "paused"
      ? "paused"
      : run.state === "sleeping"
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
          All campaigns
        </button>

        <section className="workspace-profile">
          <div className="profile-avatar">in</div>
          <div>
            <strong>{account.name}</strong>
            <span>{chromeStatus?.connected ? "Chrome connected" : "Chrome stopped"}</span>
          </div>
        </section>

        <nav className="campaign-nav">
          <button
            className="nav-item"
            onClick={onBack}
          >
            <Layers3 size={17} />
            Campaigns
          </button>
          <button className={`nav-item ${activeTab === "browser" ? "active" : ""}`} onClick={() => onTabChange("browser")}>
            <Chrome size={17} />
            LinkedIn browser
          </button>
          <button className={`nav-item ${activeTab === "safety" ? "active" : ""}`} onClick={() => onTabChange("safety")}>
            <ShieldCheck size={17} />
            Safety limits
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

        {hasActiveServerRun && activeRun ? (
          <div className="campaign-run-controls">
            {activeRun.state === "needs_attention" ? (
              <button className="ghost-button" onClick={() => void retryCampaignLead()} disabled={isCampaignBusy}>
                <RefreshCw size={17} />
                Retry lead
              </button>
            ) : (
              <button
                className="ghost-button"
                onClick={activeRun.state === "paused" ? () => void resumeCampaign() : () => void pauseCampaign()}
                disabled={isCampaignBusy || activeRun.state === "stopping"}
              >
                {activeRun.state === "paused" ? <Play size={17} /> : <Pause size={17} />}
                {activeRun.state === "paused" ? "Resume" : "Pause"}
              </button>
            )}
            <button className="danger-button" onClick={() => void stopCampaign()} disabled={isCampaignBusy}>
              <Square size={17} />
              Stop
            </button>
          </div>
        ) : (
          <button
            className="full-width primary-button"
            onClick={activeRun?.state === "stopped" ? () => void resumeCampaign() : () => void requestCampaignStart()}
            disabled={isCampaignBusy || isStartPending}
          >
            {isCampaignBusy || isStartPending ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}
            {isStartPending
              ? "Starting campaign"
              : isCampaignBusy
                ? "Reading profiles"
              : workspace.leads.length === 0
                ? "Add leads to start"
                : activeRun?.state === "stopped"
                  ? "Restart campaign"
                : "Start campaign"}
          </button>
        )}
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
            <ReplyNotificationButton
              profileId={account.id}
              runs={campaignRuns}
              onOpenCampaign={(targetCampaignId) => onOpenCampaign(targetCampaignId, "replied")}
            />
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
          <div className={`workspace-feedback ${activeRun.state === "sleeping" ? "error" : "success"}`} role="status">
            <span>
              {activeRun.mode === "live" ? "Live" : "Dry"} run {runStateLabel(activeRun.state)}: {activeRun.summary.completed} completed, {activeRun.summary.sleeping} waiting, {activeRun.summary.needsReview} needs review.
              {activeRun.sleepingReason ? ` Paused by safety limits: ${sleepingReasonLabel(activeRun.sleepingReason)}.` : ""}
              {activeRun.sleepingUntil ? ` Next check ${formatDate(activeRun.sleepingUntil)}.` : ""}
              {nextFollowUpDueAt ? ` Next follow-up due ${formatDate(nextFollowUpDueAt)}.` : ""}
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
          <button className={`tab-button ${activeTab === "safety" ? "active" : ""}`} onClick={() => onTabChange("safety")}>
            <ShieldCheck size={17} />
            Safety
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
            {leadFilter ? (
              <>
                <header>
                  <div>
                    <p className="section-kicker">Campaign outcome</p>
                    <h2>{outcomeLabels[leadFilter]} prospects</h2>
                  </div>
                  <button className="ghost-button" onClick={() => onTabChange("leads")}>
                    <List size={17} /> All leads
                  </button>
                </header>
                {selectedOutcomeRecords.length === 0 ? (
                  <div className="empty-profile-list">
                    <Users size={28} />
                    <strong>No {outcomeLabels[leadFilter].toLowerCase()} prospects</strong>
                  </div>
                ) : (
                  <div className="campaign-outcome-prospect-list">
                    {selectedOutcomeRecords.map((record) => (
                      <article className={`campaign-outcome-prospect ${leadFilter}`} key={record.lead.linkedinUrl || record.lead.id}>
                        <div className="lead-identity">
                          <div className="profile-avatar small">in</div>
                          <div>
                            <strong>{record.lead.displayName || [record.lead.firstName, record.lead.lastName].filter(Boolean).join(" ") || "LinkedIn profile"}</strong>
                            {record.lead.position || record.lead.company ? <small>{[record.lead.position, record.lead.company].filter(Boolean).join(" at ")}</small> : null}
                            <a href={record.lead.linkedinUrl} target="_blank" rel="noreferrer">
                              View LinkedIn profile <ExternalLink size={12} />
                            </a>
                          </div>
                        </div>
                        <span className={`outcome-prospect-badge ${leadFilter}`}>{outcomeLabels[leadFilter]}</span>
                        <time dateTime={record.occurredAt ?? undefined}>{record.occurredAt ? formatDate(record.occurredAt) : "Time unavailable"}</time>
                        {record.replyText ? (
                          <div className="outcome-reply-text">
                            <MessageSquareReply size={17} />
                            <p>{record.replyText}</p>
                          </div>
                        ) : null}
                        {leadFilter === "failed" && record.detail ? (
                          <div className="outcome-failure-detail">
                            <AlertTriangle size={17} />
                            <p>{record.detail}</p>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <header>
                  <div>
                    <p className="section-kicker">Campaign queue</p>
                    <h2>Leads to process</h2>
                  </div>
                  <div className="lead-list-actions">
                    <button className="ghost-button" onClick={() => void enrichProspects()} disabled={workspace.leads.length === 0 || hasActiveServerRun || isCampaignBusy}>
                      {prospectOperation === "enrich" ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
                      {prospectOperation === "enrich" ? "Enriching" : "Enrich data"}
                    </button>
                    <button className="primary-button" onClick={() => void exportProspects()} disabled={workspace.leads.length === 0 || hasActiveServerRun || isCampaignBusy}>
                      {prospectOperation === "export" ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
                      {prospectOperation === "export" ? "Preparing CSV" : "Export CRM CSV"}
                    </button>
                    <button className="icon-button" title="Add leads" onClick={() => setActiveModal("source")} disabled={hasActiveServerRun}>
                      <Plus size={17} />
                    </button>
                  </div>
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
                            {lead.position || lead.company ? <small>{[lead.position, lead.company].filter(Boolean).join(" at ")}</small> : null}
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
              </>
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

        {activeTab === "safety" ? (
          <SafetyLimitsPage settings={safetySettings} onChange={onSafetySettingsChange} />
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
              <div className="segmented-control campaign-run-mode" aria-label="Campaign execution mode">
                <button
                  type="button"
                  className={startMode === "dry_run" ? "active" : ""}
                  onClick={() => {
                    setStartMode("dry_run");
                    setLiveSendConfirmed(false);
                  }}
                >
                  <ShieldCheck size={16} /> Dry run
                </button>
                <button
                  type="button"
                  className={startMode === "live" ? "active" : ""}
                  onClick={() => {
                    setStartMode("live");
                    setLiveSendConfirmed(false);
                  }}
                >
                  <MessageSquare size={16} /> Live send
                </button>
              </div>
              {startMode === "live" ? (
                <div className="live-run-fields">
                  <div className="live-run-scope">
                    <span>{liveLeads.length} lead{liveLeads.length === 1 ? "" : "s"}</span>
                    <span>{liveMessageActions.length} message action{liveMessageActions.length === 1 ? "" : "s"}</span>
                    <span>One profile at a time</span>
                  </div>
                  {hasUnsupportedLiveAction ? (
                    <p className="live-run-warning">
                      <AlertTriangle size={16} /> Complete live runs currently support message-only workflows.
                    </p>
                  ) : firstLiveMessage ? (
                    <div className="live-message-preview">
                      <span>First resolved message to {firstLiveLead?.displayName}</span>
                      <pre>{resolvedLiveMessage}</pre>
                    </div>
                  ) : (
                    <p className="live-run-warning">
                      <AlertTriangle size={16} /> Add a message action before starting a live run.
                    </p>
                  )}
                  <label className="live-send-confirmation">
                    <input
                      type="checkbox"
                      checked={liveSendConfirmed}
                      onChange={(event) => setLiveSendConfirmed(event.target.checked)}
                      disabled={hasUnsupportedLiveAction || !firstLiveMessage || resolvedLiveMessage.length === 0}
                    />
                    <span>I authorize all {liveMessageActions.length} message action{liveMessageActions.length === 1 ? "" : "s"} for all {liveLeads.length} lead{liveLeads.length === 1 ? "" : "s"} in this frozen campaign run.</span>
                  </label>
                </div>
              ) : null}
              <div className="campaign-preflight-list">
                <span><Check size={16} /> Workflow and leads are saved</span>
                <span><Check size={16} /> Managed Chrome will start if needed</span>
                {safetyWindowNotice ? <span><Clock3 size={16} /> {safetyWindowNotice}</span> : null}
                <span><AlertTriangle size={16} /> {startMode === "live"
                  ? "Each message is verified before Send and confirmed afterward"
                  : "Dry run only: no Send buttons are clicked"}</span>
              </div>
            </div>
            <footer className="modal-actions">
              <button className="ghost-button" onClick={() => setIsStartConfirmationOpen(false)} disabled={isCampaignBusy}>
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={() => void confirmCampaignStart()}
                disabled={isCampaignBusy || (startMode === "live" && !liveStartReady)}
              >
                {isCampaignBusy ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
                {isCampaignBusy ? "Starting" : startMode === "live" ? "Start live campaign" : "Start dry run"}
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
  if (status === "paused") return "Paused";
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

function sleepingReasonLabel(reason: string) {
  if (reason === "outside_working_hours") return "outside working hours";
  if (reason === "daily_action_limit_reached") return "daily action limit reached";
  if (reason === "daily_invite_limit_reached") return "daily invite limit reached";
  if (reason === "batch_cooldown") return "batch cooldown";
  if (reason === "waiting_for_next_eligible_lead") return "waiting for the next eligible lead";
  return reason.replace(/_/g, " ");
}

function getSafetyWindowNotice(settings: HumanTouchSettings) {
  const now = new Date();
  const [startHour, startMinute] = settings.workingHoursStart.split(":").map(Number);
  const [endHour, endMinute] = settings.workingHoursEnd.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const current = now.getHours() * 60 + now.getMinutes();
  const insideWindow = start < end
    ? current >= start && current < end
    : current >= start || current < end;

  if (insideWindow) return null;
  return `Outside safety hours (${settings.workingHoursStart}-${settings.workingHoursEnd}); the run will sleep until the next window.`;
}
