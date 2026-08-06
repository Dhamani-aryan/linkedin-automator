import { AlertTriangle, Chrome, Circle, ExternalLink, Mail, Play, Plus, RefreshCw, Search, Square, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getChromeStatus, openChromeUrl, startChrome, stopChrome } from "./lib/chromeApi";
import type { ChromeStatus, LinkedInAccount } from "./types";

const initialAccount: LinkedInAccount = {
  id: "single-profile",
  email: "local-linkedin-session",
  name: "Local LinkedIn Profile",
  state: "stopped",
  role: "Owner",
  chromeProfileMode: "single-local-profile",
  archived: false
};

export function App() {
  const [userEmail, setUserEmail] = useState("");
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [account, setAccount] = useState<LinkedInAccount>(initialAccount);
  const [status, setStatus] = useState<ChromeStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const activeLinkedInTab = useMemo(
    () => status?.tabs.find((tab) => tab.url.includes("linkedin.com")) ?? null,
    [status]
  );

  useEffect(() => {
    if (!isSignedIn) return;
    void refreshStatus();
  }, [isSignedIn]);

  async function refreshStatus() {
    try {
      const nextStatus = await getChromeStatus();
      setStatus(nextStatus);
      setAccount((current) => ({
        ...current,
        state: nextStatus.connected ? "running" : "stopped",
        lastError: undefined
      }));
    } catch (error) {
      setAccount((current) => ({
        ...current,
        state: "error",
        lastError: error instanceof Error ? error.message : "Could not read Chrome status."
      }));
    }
  }

  async function runChromeAction(action: () => Promise<unknown>) {
    setIsBusy(true);
    try {
      await action();
      await refreshStatus();
    } catch (error) {
      setAccount((current) => ({
        ...current,
        state: "error",
        lastError: error instanceof Error ? error.message : "Chrome action failed."
      }));
    } finally {
      setIsBusy(false);
    }
  }

  if (!isSignedIn) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-mark">
            <Chrome size={26} />
          </div>
          <p className="eyebrow">LinkedIn Automator</p>
          <h1>Sign in to manage your local LinkedIn workspace</h1>
          <p className="muted">
            Version one runs one persistent Chrome profile from this computer, using your normal IP address.
          </p>
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (userEmail.trim().length > 0) setIsSignedIn(true);
            }}
          >
            <label htmlFor="email">Email</label>
            <div className="input-with-icon">
              <Mail size={18} />
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={userEmail}
                onChange={(event) => setUserEmail(event.target.value)}
              />
            </div>
            <button className="primary-button" type="submit">
              <UserPlus size={18} />
              Continue
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="manager-layout">
      <aside className="manager-sidebar">
        <div>
          <div className="app-logo">
            <Chrome size={22} />
            <span>Automator</span>
          </div>
          <nav className="sidebar-nav">
            <button className="nav-item active">LinkedIn Accounts</button>
            <button className="nav-item">Campaigns</button>
            <button className="nav-item">Safety Limits</button>
            <button className="nav-item">Settings</button>
          </nav>
        </div>
        <div className="signed-in-user">
          <div className="avatar">{userEmail.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{userEmail}</strong>
            <span>Local workspace</span>
          </div>
        </div>
      </aside>

      <section className="manager-content">
        <header className="manager-header">
          <div>
            <p className="eyebrow">Account Manager</p>
            <h1>LinkedIn accounts</h1>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={() => void refreshStatus()} disabled={isBusy}>
              <RefreshCw size={18} />
              Refresh
            </button>
            <button className="primary-button disabled-button" type="button">
              <Plus size={18} />
              Add account
            </button>
          </div>
        </header>

        <div className="toolbar">
          <div className="select-like">All accounts</div>
          <div className="pill active">In use</div>
          <div className="pill">Running</div>
          <div className="pill">Stopped</div>
          <div className="search-box">
            <Search size={18} />
            <span>Search</span>
          </div>
        </div>

        <section className="accounts-table">
          <div className="table-header">
            <span>LinkedIn account</span>
            <span>State</span>
            <span>Chrome session</span>
            <span>Access</span>
            <span>Archived</span>
            <span>Actions</span>
          </div>
          <div className="account-row">
            <div className="account-person">
              <div className="profile-avatar">in</div>
              <div>
                <strong>{account.name}</strong>
                <span>{account.email}</span>
                <button
                  className="text-link"
                  onClick={() => void runChromeAction(() => openChromeUrl("https://www.linkedin.com/"))}
                >
                  Open LinkedIn
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
            <div className={`state-badge ${account.state}`}>
              <Circle size={10} fill="currentColor" />
              {account.state}
            </div>
            <div className="session-detail">
              <strong>{status?.connected ? "Connected" : "Not connected"}</strong>
              <span>Profile: {status?.profileDir ?? ".local/chrome-profile"}</span>
              {activeLinkedInTab ? <span>Tab: {activeLinkedInTab.title || "LinkedIn"}</span> : null}
            </div>
            <span className="owner-badge">{account.role}</span>
            <span>No</span>
            <div className="row-actions">
              <button
                className="icon-button run"
                title="Start Chrome"
                onClick={() => void runChromeAction(() => startChrome())}
                disabled={isBusy}
              >
                <Play size={16} />
              </button>
              <button
                className="icon-button stop"
                title="Stop Chrome"
                onClick={() => void runChromeAction(() => stopChrome())}
                disabled={isBusy}
              >
                <Square size={16} />
              </button>
              <button className="icon-button disabled-button" title="Delete disabled in single-profile v1">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </section>

        <section className="notice-card">
          <AlertTriangle size={20} />
          <div>
            <strong>Single-profile v1</strong>
            <p>
              This build keeps one persistent Chrome login on this computer and does not use proxies or rotating IPs.
              Multi-profile account isolation will be added after the single-profile flow is proven.
            </p>
            {account.lastError ? <p className="error-text">{account.lastError}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
