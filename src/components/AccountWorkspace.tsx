import {
  ArrowLeft,
  BarChart3,
  Check,
  Chrome,
  Download,
  Flag,
  Inbox,
  Layers3,
  List,
  MessageSquareReply,
  ShieldCheck,
  Play,
  Plus,
  RefreshCw,
  Send,
  Square,
  Users,
  X
} from "lucide-react";
import { useState } from "react";
import { LeadSourceWizard } from "./LeadSourceWizard";
import { MessageTemplateEditor } from "./MessageTemplateEditor";
import { seedCampaigns, seedLeads, seedWorkflow } from "../data/seed";
import { safetyChecklist, safetyDefaults } from "../lib/safety";
import type { ChromeStatus, LinkedInAccount } from "../types";

type WorkspaceProps = {
  account: LinkedInAccount;
  chromeStatus: ChromeStatus | null;
  isBusy: boolean;
  onBack: () => void;
  onOpenLinkedIn: () => void;
  onRefreshChrome: () => void;
  onStartChrome: () => void;
  onStopChrome: () => void;
};

const activeCampaign = seedCampaigns[0];
const chartDays = [
  { day: "Aug 1", invited: 0, accepted: 0 },
  { day: "Aug 2", invited: 4, accepted: 1 },
  { day: "Aug 3", invited: 8, accepted: 1 },
  { day: "Aug 4", invited: 0, accepted: 0 },
  { day: "Aug 5", invited: 3, accepted: 0 },
  { day: "Aug 6", invited: 1, accepted: 0 }
];

export function AccountWorkspace({
  account,
  chromeStatus,
  isBusy,
  onBack,
  onOpenLinkedIn,
  onRefreshChrome,
  onStartChrome,
  onStopChrome
}: WorkspaceProps) {
  const linkedInTab = chromeStatus?.tabs.find((tab) => tab.url.includes("linkedin.com")) ?? null;
  const [activeModal, setActiveModal] = useState<"source" | "template" | null>(null);

  return (
    <main className="workspace-layout">
      <aside className="workspace-sidebar">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={18} />
          All accounts
        </button>

        <section className="workspace-profile">
          <div className="profile-avatar">in</div>
          <div>
            <strong>{account.name}</strong>
            <span>{account.role}</span>
          </div>
        </section>

        <nav className="campaign-nav">
          <button className="nav-item active">
            <Flag size={17} />
            Campaigns
          </button>
          <button className="nav-item">
            <Chrome size={17} />
            LinkedIn
          </button>
          <button className="nav-item">
            <BarChart3 size={17} />
            Dashboard
          </button>
        </nav>

        <section className="campaign-mini-card">
          <div className="campaign-title-row">
            <strong>{activeCampaign.name}</strong>
            <span className={`state-badge ${activeCampaign.status}`}>
              {activeCampaign.status}
            </span>
          </div>
          <Metric label="Total profiles" value={activeCampaign.profilesTotal} />
          <Metric label="Profiles to process" value={activeCampaign.profilesToProcess} />
          <Metric label="Accepted" value={activeCampaign.accepted} />
          <Metric label="Replied" value={activeCampaign.replied} />
          <Metric label="Failed" value={activeCampaign.failed} tone="danger" />
        </section>

        <button className="primary-button full-width">
          <Play size={17} />
          Start campaign
        </button>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <button className="icon-text-button" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
            <h1>{activeCampaign.name}</h1>
            <p className="status-line">Ready to start - last 24h actions 0 of 150</p>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={onStartChrome} disabled={isBusy}>
              <Play size={18} />
              Start Chrome
            </button>
            <button className="ghost-button" onClick={onStopChrome} disabled={isBusy}>
              <Square size={18} />
              Stop
            </button>
          </div>
        </header>

        <section className="workspace-tabs">
          <button className="tab-button active">
            <Layers3 size={17} />
            Workflow
          </button>
          <button className="tab-button">
            <List size={17} />
            Profile lists
          </button>
          <button className="tab-button">
            <Inbox size={17} />
            Inbox
          </button>
          <button className="tab-button">
            <BarChart3 size={17} />
            Dashboard
          </button>
        </section>

        <section className="workspace-grid">
          <div className="workspace-column">
            <Panel title="Workflow">
              <div className="workflow-actions">
                <button className="primary-button" onClick={() => setActiveModal("source")}>
                  <Plus size={17} />
                  Choose source
                </button>
                <button className="ghost-button" onClick={() => setActiveModal("template")}>
                  <Send size={17} />
                  Edit message
                </button>
              </div>
              <div className="workflow-canvas">
                {seedWorkflow.map((card, index) => (
                  <div className="workflow-node-wrap" key={card.id}>
                    {index > 0 ? <button className="workflow-plus"><Plus size={18} /></button> : null}
                    <article className={`workflow-card ${card.kind}`}>
                      <div>
                        <span>{card.subtitle}</span>
                        <strong>{card.title}</strong>
                      </div>
                      <div className="workflow-card-footer">
                        <span><Check size={17} />{card.successful}</span>
                        <span><X size={17} />{card.failed}</span>
                        <span><Users size={17} />{card.count}</span>
                      </div>
                    </article>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Profile lists">
              <div className="lead-table">
                {seedLeads.map((lead) => (
                  <div className="lead-row" key={lead.id}>
                    <div className="profile-avatar small">in</div>
                    <div>
                      <strong>{lead.displayName}</strong>
                      <span>{lead.position} at {lead.company}</span>
                    </div>
                    <span>{lead.status.replace("_", " ")}</span>
                    <span>{lead.addedAt}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <div className="workspace-column">
            <Panel
              title="Browser session"
              action={
                <button className="icon-text-button" onClick={onRefreshChrome}>
                  <RefreshCw size={17} />
                </button>
              }
            >
              <div className="browser-session-card">
                <div className={`session-light ${chromeStatus?.connected ? "online" : ""}`} />
                <div>
                  <strong>{chromeStatus?.connected ? "Chrome connected" : "Chrome not connected"}</strong>
                  <span>{chromeStatus?.profileDir ?? ".local/chrome-profile"}</span>
                </div>
              </div>
              <button className="primary-button full-width" onClick={onOpenLinkedIn} disabled={isBusy}>
                <Chrome size={18} />
                Open LinkedIn in managed Chrome
              </button>
              {linkedInTab ? (
                <div className="active-tab-card">
                  <strong>{linkedInTab.title || "LinkedIn"}</strong>
                  <span>{linkedInTab.url}</span>
                </div>
              ) : null}
            </Panel>

            <Panel title="Dashboard">
              <div className="chart-card">
                {chartDays.map((day) => (
                  <div className="chart-day" key={day.day}>
                    <div className="bar-stack">
                      <span style={{ height: `${Math.max(day.invited * 12, 2)}px` }} />
                      <span style={{ height: `${Math.max(day.accepted * 18, 2)}px` }} />
                    </div>
                    <small>{day.day}</small>
                  </div>
                ))}
              </div>
              <div className="chart-legend">
                <span><i className="legend-blue" />Invited</span>
                <span><i className="legend-green" />Accepted</span>
              </div>
            </Panel>

            <Panel title="Runner safety">
              <div className="safety-list">
                <div className="safety-mode">
                  <ShieldCheck size={22} />
                  <div>
                    <strong>Same IP local Chrome</strong>
                    <span>{safetyDefaults.chromeProfile}</span>
                  </div>
                </div>
                {safetyChecklist.map((item) => (
                  <div className="safety-item" key={item}>
                    <Check size={16} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <div className="limit-grid">
                <div>
                  <span>Daily actions</span>
                  <strong>{safetyDefaults.dailyActionLimit}</strong>
                </div>
                <div>
                  <span>Daily invites</span>
                  <strong>{safetyDefaults.dailyInviteLimit}</strong>
                </div>
                <div>
                  <span>Delay range</span>
                  <strong>{safetyDefaults.actionDelaySeconds[0]}-{safetyDefaults.actionDelaySeconds[1]}s</strong>
                </div>
              </div>
            </Panel>

            <Panel title="Inbox">
              <div className="empty-shell">
                <MessageSquareReply size={28} />
                <strong>No replies yet</strong>
                <p>Reply checks will move leads here once the workflow runner is connected.</p>
              </div>
            </Panel>

            <Panel
              title="Exports"
              action={<Download size={17} />}
            >
              <button className="ghost-button full-width">
                <Send size={17} />
                Export reviewed leads
              </button>
            </Panel>
          </div>
        </section>
      </section>
      {activeModal === "source" ? <LeadSourceWizard onClose={() => setActiveModal(null)} /> : null}
      {activeModal === "template" ? <MessageTemplateEditor onClose={() => setActiveModal(null)} /> : null}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className={`mini-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({
  action,
  children,
  title
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="workspace-panel">
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
