import {
  AlertTriangle,
  Building2,
  Chrome,
  Circle,
  ExternalLink,
  Lock,
  LogOut,
  Linkedin,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Square,
  Trash2,
  UsersRound,
  UserPlus
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AddLinkedInAccountModal } from "./components/AddLinkedInAccountModal";
import { AccountWorkspace } from "./components/AccountWorkspace";
import { ProfileCampaigns } from "./components/ProfileCampaigns";
import { readAppRoute, routeToHash, type AppRoute } from "./lib/appRoute";
import { loadCampaignWorkspaces } from "./lib/campaignStorage";
import { getChromeStatus, openChromeUrl, startChrome, stopChrome } from "./lib/chromeApi";
import { loadSafetySettings, saveSafetySettings } from "./lib/safetyStorage";
import {
  clearCompanyUser,
  loadCompanyUser,
  loadLinkedInAccounts,
  restoreSample UserAccountForWorkspace,
  saveCompanyUser,
  saveLinkedInAccounts
} from "./lib/storage";
import type { ChromeStatus, CompanyUser, HumanTouchSettings, LinkedInAccount } from "./types";

function profileFolderName(profileDir?: string) {
  if (!profileDir) return null;
  const parts = profileDir.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 2] ?? null;
}

export function App() {
  const [authMode, setAuthMode] = useState<"register" | "signin">("register");
  const [authForm, setAuthForm] = useState({
    companyName: "",
    email: "",
    password: ""
  });
  const [companyUser, setCompanyUser] = useState<CompanyUser | null>(() => loadCompanyUser());
  const [accounts, setAccounts] = useState<LinkedInAccount[]>(() => {
    const storedAccounts = loadLinkedInAccounts();
    return companyUser ? restoreSample UserAccountForWorkspace(companyUser, storedAccounts) : storedAccounts;
  });
  const [selectedAccountId, setSelectedAccountId] = useState(() => {
    const storedAccounts = loadLinkedInAccounts();
    const restoredAccounts = companyUser ? restoreSample UserAccountForWorkspace(companyUser, storedAccounts) : storedAccounts;
    return restoredAccounts[0]?.id ?? "";
  });
  const [statusByAccount, setStatusByAccount] = useState<Record<string, ChromeStatus | null>>({});
  const statusFor = (accountId?: string) => (accountId ? statusByAccount[accountId] ?? null : null);
  const [isBusy, setIsBusy] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => readAppRoute());
  const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
  const [accountPendingDelete, setAccountPendingDelete] = useState<LinkedInAccount | null>(null);
  const [humanTouchSettings, setHumanTouchSettings] = useState<HumanTouchSettings>(() => loadSafetySettings());

  const routeAccount =
    route.kind === "workspace" || route.kind === "campaigns"
      ? accounts.find((candidate) => candidate.id === route.profileId) ?? null
      : null;
  const selectedAccount = routeAccount ?? accounts.find((candidate) => candidate.id === selectedAccountId) ?? accounts[0] ?? null;
  const activePage = route.kind === "manager" ? route.page : "profiles";
  const selectedStatus = statusFor(selectedAccount?.id);
  const activeLinkedInTab = useMemo(
    () => selectedStatus?.tabs.find((tab) => tab.url.includes("linkedin.com")) ?? null,
    [selectedStatus]
  );

  // Each profile has its own Chrome, so every account row needs its own status.
  useEffect(() => {
    if (!companyUser) return;
    for (const account of accounts) void refreshStatus(account.id);
  }, [companyUser, accounts.length]);

  useEffect(() => {
    const syncRoute = () => setRoute(readAppRoute());
    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("popstate", syncRoute);
    if (!window.location.hash) {
      window.history.replaceState(null, "", routeToHash(route));
    }
    return () => {
      window.removeEventListener("hashchange", syncRoute);
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  useEffect(() => {
    if (!["workspace", "campaigns"].includes(route.kind) || routeAccount) return;
    navigate({ kind: "manager", page: "profiles" }, true);
  }, [route, routeAccount]);

  useEffect(() => {
    if (route.kind !== "workspace" || !routeAccount) return;
    const campaignExists = route.campaignId && loadCampaignWorkspaces(routeAccount)
      .some(({ campaign }) => campaign.id === route.campaignId);
    if (!campaignExists) {
      navigate({ kind: "campaigns", profileId: routeAccount.id }, true);
    }
  }, [route, routeAccount]);

  useEffect(() => {
    saveLinkedInAccounts(accounts);
    if (!selectedAccountId && accounts[0]) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    saveSafetySettings(humanTouchSettings);
  }, [humanTouchSettings]);

  async function refreshStatus(accountId = selectedAccount?.id) {
    if (!accountId) return;
    try {
      const nextStatus = await getChromeStatus(accountId);
      setStatusByAccount((current) => ({ ...current, [accountId]: nextStatus }));
      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) => ({
          ...currentAccount,
          state:
            currentAccount.id === accountId
              ? nextStatus.connected
                ? "running"
                : "stopped"
              : currentAccount.state,
          lastError: currentAccount.id === accountId ? undefined : currentAccount.lastError
        }))
      );
    } catch (error) {
      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) =>
          currentAccount.id === accountId
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

  async function runChromeAction(
    action: () => Promise<unknown>,
    accountId = selectedAccount?.id,
    markStarting = false
  ) {
    setIsBusy(true);
    if (markStarting) {
      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) =>
          currentAccount.id === accountId
            ? { ...currentAccount, state: "starting", lastError: undefined }
            : currentAccount
        )
      );
    }
    try {
      await action();
      await refreshStatus(accountId);
      return true;
    } catch (error) {
      setAccounts((currentAccounts) =>
        currentAccounts.map((currentAccount) =>
          currentAccount.id === accountId
            ? {
                ...currentAccount,
                state: "error",
                lastError: error instanceof Error ? error.message : "Chrome action failed."
              }
          : currentAccount
        )
      );
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  function openLinkedIn(accountId = selectedAccount?.id) {
    if (!accountId) return Promise.resolve(false);
    return runChromeAction(() => openChromeUrl(accountId, "https://www.linkedin.com/"), accountId, true);
  }

  function navigate(nextRoute: AppRoute, replace = false) {
    const nextHash = routeToHash(nextRoute);
    window.history[replace ? "replaceState" : "pushState"](null, "", nextHash);
    setRoute(nextRoute);
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
    const restoredAccounts = restoreSample UserAccountForWorkspace(nextUser, loadLinkedInAccounts());
    setAccounts(restoredAccounts);
    setSelectedAccountId(restoredAccounts[0]?.id ?? "");
    setCompanyUser(nextUser);
  }

  function signOut() {
    clearCompanyUser();
    setCompanyUser(null);
    navigate({ kind: "manager", page: "profiles" }, true);
  }

  function addLinkedInAccount(account: LinkedInAccount) {
    setAccounts((currentAccounts) => [...currentAccounts, account]);
    setSelectedAccountId(account.id);
    setIsAddAccountOpen(false);
  }

  function deleteLinkedInAccount(accountId: string) {
    setAccounts((currentAccounts) => currentAccounts.filter((account) => account.id !== accountId));
    if (selectedAccountId === accountId) {
      const remainingAccounts = accounts.filter((account) => account.id !== accountId);
      setSelectedAccountId(remainingAccounts[0]?.id ?? "");
      navigate({ kind: "manager", page: "profiles" }, true);
    }
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
            Manage LinkedIn profiles from one company login. Version one keeps a single persistent Chrome session
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

  if (route.kind === "campaigns" && routeAccount) {
    return (
      <ProfileCampaigns
        account={routeAccount}
        chromeStatus={statusFor(routeAccount.id)}
        chromeError={routeAccount.lastError}
        isChromeBusy={isBusy}
        safetySettings={humanTouchSettings}
        onSafetySettingsChange={setHumanTouchSettings}
        onBack={() => navigate({ kind: "manager", page: "profiles" })}
        onOpenCampaign={(campaignId, leadFilter) => navigate({
          kind: "workspace",
          profileId: routeAccount.id,
          campaignId,
          tab: leadFilter ? "leads" : "workflow",
          ...(leadFilter ? { leadFilter } : {})
        })}
        onOpenLinkedIn={() => openLinkedIn(routeAccount.id)}
        onRefreshChrome={() => void refreshStatus(routeAccount.id)}
        onStartChrome={() => runChromeAction(() => startChrome(routeAccount.id), routeAccount.id, true)}
        onStopChrome={() => runChromeAction(() => stopChrome(routeAccount.id), routeAccount.id)}
      />
    );
  }

  if (route.kind === "workspace" && routeAccount && route.campaignId) {
    return (
      <AccountWorkspace
        account={routeAccount}
        campaignId={route.campaignId}
        activeTab={route.tab}
        leadFilter={route.leadFilter}
        chromeStatus={statusFor(routeAccount.id)}
        chromeError={routeAccount.lastError}
        isBusy={isBusy}
        safetySettings={humanTouchSettings}
        onSafetySettingsChange={setHumanTouchSettings}
        onBack={() => navigate({ kind: "campaigns", profileId: routeAccount.id })}
        onOpenCampaign={(campaignId, leadFilter) => navigate({
          kind: "workspace",
          profileId: routeAccount.id,
          campaignId,
          tab: "leads",
          leadFilter
        })}
        onOpenLinkedIn={() => openLinkedIn(routeAccount.id)}
        onRefreshChrome={() => void refreshStatus(routeAccount.id)}
        onStartChrome={() => runChromeAction(() => startChrome(routeAccount.id), routeAccount.id, true)}
        onStopChrome={() => runChromeAction(() => stopChrome(routeAccount.id), routeAccount.id)}
        onTabChange={(tab) => navigate({
          kind: "workspace",
          profileId: routeAccount.id,
          campaignId: route.campaignId,
          tab
        })}
      />
    );
  }

  return (
    <main className="manager-layout">
      <aside className="manager-sidebar">
        <div>
          <div className="app-logo">
            <span className="app-logo-mark"><Linkedin size={18} /></span>
            <span>LinkedIn Automator</span>
          </div>
          <nav className="sidebar-nav">
            <button
              className={`nav-item ${activePage === "profiles" ? "active" : ""}`}
              onClick={() => navigate({ kind: "manager", page: "profiles" })}
            >
              <UsersRound size={17} />
              LinkedIn Profiles
            </button>
            <button
              className={`nav-item ${activePage === "settings" ? "active" : ""}`}
              onClick={() => navigate({ kind: "manager", page: "settings" })}
            >
              <Settings2 size={17} />
              Settings
            </button>
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
        {activePage === "settings" ? (
          <section className="placeholder-page">
            <p className="eyebrow">Workspace</p>
            <h1>Settings</h1>
            <p className="muted">Company and browser preferences will live here.</p>
          </section>
        ) : null}

        {activePage === "profiles" ? (
          <>
        <header className="manager-header">
          <div>
            <p className="eyebrow">Profile Manager</p>
            <h1>LinkedIn profiles</h1>
          </div>
          <div className="header-actions">
            <button
              className="ghost-button"
              onClick={() => accounts.forEach((account) => void refreshStatus(account.id))}
              disabled={isBusy}
            >
              <RefreshCw size={18} />
              Refresh
            </button>
            <button className="primary-button" type="button" onClick={() => setIsAddAccountOpen(true)}>
              <Plus size={18} />
              Add profile
            </button>
          </div>
        </header>

        <div className="toolbar">
          <div className="select-like">All profiles</div>
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
            <span>LinkedIn profile</span>
            <span>State</span>
            <span>Chrome session</span>
            <span>Access</span>
            <span>Archived</span>
            <span>Actions</span>
          </div>
          {accounts.length === 0 ? (
            <div className="empty-accounts">
              <strong>No LinkedIn profiles added yet</strong>
              <p>Add your first LinkedIn profile, start the managed Chrome window, and log in once.</p>
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
                        void runChromeAction(
                          () => openChromeUrl(account.id, "https://www.linkedin.com/"),
                          account.id,
                          true
                        );
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
                  <strong>{statusFor(account.id)?.connected ? "Connected" : "Not connected"}</strong>
                  <span>Profile folder: {profileFolderName(statusFor(account.id)?.profileDir) ?? "created on first start"}</span>
                  {statusFor(account.id)?.tabs.find((tab) => tab.url.includes("linkedin.com")) ? (
                    <span>Tab: {statusFor(account.id)?.tabs.find((tab) => tab.url.includes("linkedin.com"))?.title || "LinkedIn"}</span>
                  ) : null}
                </div>
                <div className="account-meta-cell">
                  <span className="row-field-label">Access</span>
                  <span className="owner-badge">{account.role}</span>
                </div>
                <div className="account-meta-cell">
                  <span className="row-field-label">Archived</span>
                  <span>{account.archived ? "Yes" : "No"}</span>
                </div>
                <div className="row-actions">
                  <button
                    className="ghost-button compact-button"
                    onClick={() => {
                      setSelectedAccountId(account.id);
                        navigate({ kind: "campaigns", profileId: account.id });
                    }}
                  >
                    Open workspace
                  </button>
                  <button
                    className="icon-button run"
                    title="Start Chrome"
                      onClick={() => {
                        setSelectedAccountId(account.id);
                        void runChromeAction(() => startChrome(account.id), account.id, true);
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
                        void runChromeAction(() => stopChrome(account.id), account.id);
                    }}
                    disabled={isBusy}
                  >
                    <Square size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="Delete LinkedIn profile"
                    onClick={() => setAccountPendingDelete(account)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        {selectedAccount?.lastError ? (
          <section className="notice-card">
            <AlertTriangle size={20} />
            <div>
              <p className="error-text">{selectedAccount.lastError}</p>
            </div>
          </section>
        ) : null}
          </>
        ) : null}
      </section>
      {isAddAccountOpen ? (
        <AddLinkedInAccountModal
          onAdd={addLinkedInAccount}
          onClose={() => setIsAddAccountOpen(false)}
        />
      ) : null}
      {accountPendingDelete ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="confirm-modal">
            <div className="confirm-icon">
              <AlertTriangle size={22} />
            </div>
            <div>
              <h2>Delete LinkedIn profile?</h2>
              <p>
                This removes <strong>{accountPendingDelete.name}</strong> from this workspace. It does not delete the
                local Chrome profile or sign you out of LinkedIn.
              </p>
            </div>
            <footer className="modal-actions">
              <button className="ghost-button" onClick={() => setAccountPendingDelete(null)}>
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  deleteLinkedInAccount(accountPendingDelete.id);
                  setAccountPendingDelete(null);
                }}
              >
                <Trash2 size={18} />
                Delete profile
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
