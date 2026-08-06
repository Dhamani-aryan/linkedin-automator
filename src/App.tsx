import {
  AlertTriangle,
  Building2,
  Chrome,
  Circle,
  ExternalLink,
  Lock,
  LogOut,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  UserPlus
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AccountWorkspace } from "./components/AccountWorkspace";
import { getChromeStatus, openChromeUrl, startChrome, stopChrome } from "./lib/chromeApi";
import { clearCompanyUser, loadCompanyUser, loadLinkedInAccounts, saveCompanyUser, saveLinkedInAccounts } from "./lib/storage";
import type { ChromeStatus, CompanyUser, LinkedInAccount } from "./types";

export function App() {
  const [authMode, setAuthMode] = useState<"register" | "signin">("register");
  const [authForm, setAuthForm] = useState({
    companyName: "",
    email: "",
    password: ""
  });
  const [companyUser, setCompanyUser] = useState<CompanyUser | null>(() => loadCompanyUser());
  const [accounts, setAccounts] = useState<LinkedInAccount[]>(() => loadLinkedInAccounts());
  const [selectedAccountId, setSelectedAccountId] = useState(() => loadLinkedInAccounts()[0]?.id ?? "");
  const [status, setStatus] = useState<ChromeStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [screen, setScreen] = useState<"manager" | "workspace">("manager");

  const selectedAccount = accounts.find((candidate) => candidate.id === selectedAccountId) ?? accounts[0] ?? null;
  const activeLinkedInTab = useMemo(
    () => status?.tabs.find((tab) => tab.url.includes("linkedin.com")) ?? null,
    [status]
  );

  useEffect(() => {
    if (!companyUser) return;
    void refreshStatus();
  }, [companyUser]);

  useEffect(() => {
    saveLinkedInAccounts(accounts);
    if (!selectedAccountId && accounts[0]) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  async function refreshStatus() {
    try {
      const nextStatus = await getChromeStatus();
      setStatus(nextStatus);
      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) => ({
          ...currentAccount,
          state:
            currentAccount.id === selectedAccount?.id
              ? nextStatus.connected
                ? "running"
                : "stopped"
              : currentAccount.state,
          lastError: currentAccount.id === selectedAccount?.id ? undefined : currentAccount.lastError
        }))
      );
    } catch (error) {
      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) =>
          currentAccount.id === selectedAccount?.id
            ? {
                ...currentAccount,
                state: "error",
                lastError: error instanceof Error ? error.message : "Could not read Chrome status."
              }
            : currentAccount
        )
      );
    }
  }

  async function runChromeAction(action: () => Promise<unknown>) {
    setIsBusy(true);
    try {
      await action();
      await refreshStatus();
    } catch (error) {
      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) =>
          currentAccount.id === selectedAccount?.id
            ? {
                ...currentAccount,
                state: "error",
                lastError: error instanceof Error ? error.message : "Chrome action failed."
              }
            : currentAccount
        )
      );
    } finally {
      setIsBusy(false);
    }
  }

  function openLinkedIn() {
    void runChromeAction(() => openChromeUrl("https://www.linkedin.com/"));
  }

  function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authForm.email.trim() || !authForm.password.trim()) return;
    const nextUser: CompanyUser = {
      id: crypto.randomUUID(),
      companyName: authForm.companyName.trim() || "Company workspace",
      email: authForm.email.trim(),
      createdAt: new Date().toISOString()
    };
    saveCompanyUser(nextUser);
    setCompanyUser(nextUser);
  }

  function signOut() {
    clearCompanyUser();
    setCompanyUser(null);
    setScreen("manager");
  }

  if (!companyUser) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-mark">
            <Chrome size={26} />
          </div>
          <p className="eyebrow">LinkedIn Automator</p>
          <h1>{authMode === "register" ? "Create your company workspace" : "Sign in to your company workspace"}</h1>
          <p className="muted">
            Manage LinkedIn accounts from one company login. Version one keeps a single persistent Chrome session
            on this computer, using your normal IP address.
          </p>
          <div className="segmented-control">
            <button
              className={authMode === "register" ? "active" : ""}
              type="button"
              onClick={() => setAuthMode("register")}
            >
              Register
            </button>
            <button
              className={authMode === "signin" ? "active" : ""}
              type="button"
              onClick={() => setAuthMode("signin")}
            >
              Sign in
            </button>
          </div>
          <form
            className="auth-form"
            onSubmit={submitAuth}
          >
            <label htmlFor="company">Company</label>
            <div className="input-with-icon">
              <Building2 size={18} />
              <input
                id="company"
                placeholder="Your company"
                value={authForm.companyName}
                onChange={(event) => setAuthForm((current) => ({ ...current, companyName: event.target.value }))}
              />
            </div>
            <label htmlFor="email">Work email</label>
            <div className="input-with-icon">
              <Mail size={18} />
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={authForm.email}
                onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
              />
            </div>
            <label htmlFor="password">Password</label>
            <div className="input-with-icon">
              <Lock size={18} />
              <input
                id="password"
                type="password"
                placeholder="Workspace password"
                value={authForm.password}
                onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
              />
            </div>
            <button className="primary-button" type="submit">
              <UserPlus size={18} />
              {authMode === "register" ? "Create workspace" : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (screen === "workspace" && selectedAccount) {
    return (
      <AccountWorkspace
        account={selectedAccount}
        chromeStatus={status}
        isBusy={isBusy}
        onBack={() => setScreen("manager")}
        onOpenLinkedIn={openLinkedIn}
        onRefreshChrome={() => void refreshStatus()}
        onStartChrome={() => void runChromeAction(() => startChrome())}
        onStopChrome={() => void runChromeAction(() => stopChrome())}
      />
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
          <div className="avatar">{companyUser.email.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{companyUser.email}</strong>
            <span>{companyUser.companyName}</span>
          </div>
          <button className="icon-button" title="Sign out" onClick={signOut}>
            <LogOut size={15} />
          </button>
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
          {accounts.length === 0 ? (
            <div className="empty-accounts">
              <strong>No LinkedIn accounts added yet</strong>
              <p>Add your first LinkedIn account, start the managed Chrome window, and log in once.</p>
            </div>
          ) : (
            accounts.map((account) => (
              <div className="account-row" key={account.id}>
                <div className="account-person">
                  <div className="profile-avatar">in</div>
                  <div>
                    <strong>{account.name}</strong>
                    <span>{account.email}</span>
                    <button
                      className="text-link"
                      onClick={() => {
                        setSelectedAccountId(account.id);
                        void runChromeAction(() => openChromeUrl("https://www.linkedin.com/"));
                      }}
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
                  <strong>{status?.connected && selectedAccount?.id === account.id ? "Connected" : "Not connected"}</strong>
                  <span>Profile: {status?.profileDir ?? ".local/chrome-profile"}</span>
                  {activeLinkedInTab && selectedAccount?.id === account.id ? (
                    <span>Tab: {activeLinkedInTab.title || "LinkedIn"}</span>
                  ) : null}
                </div>
                <span className="owner-badge">{account.role}</span>
                <span>{account.archived ? "Yes" : "No"}</span>
                <div className="row-actions">
                  <button
                    className="ghost-button compact-button"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      setScreen("workspace");
                    }}
                  >
                    Workspace
                  </button>
                  <button
                    className="icon-button run"
                    title="Start Chrome"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      void runChromeAction(() => startChrome());
                    }}
                    disabled={isBusy}
                  >
                    <Play size={16} />
                  </button>
                  <button
                    className="icon-button stop"
                    title="Stop Chrome"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                      void runChromeAction(() => stopChrome());
                    }}
                    disabled={isBusy}
                  >
                    <Square size={16} />
                  </button>
                  <button className="icon-button disabled-button" title="Delete disabled in single-profile v1">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="notice-card">
          <AlertTriangle size={20} />
          <div>
            <strong>Single-profile v1</strong>
            <p>
              This build keeps one persistent Chrome login on this computer and does not use proxies or rotating IPs.
              Multi-profile account isolation will be added after the single-profile flow is proven.
            </p>
            {selectedAccount?.lastError ? <p className="error-text">{selectedAccount.lastError}</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
