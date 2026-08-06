import type { CompanyUser, LinkedInAccount } from "../types";

const COMPANY_USER_KEY = "linkedin-automator.company-user";
const LINKEDIN_ACCOUNTS_KEY = "linkedin-automator.linkedin-accounts";
const ARYAN_ACCOUNT_RESTORE_KEY = "linkedin-automator.restore-sample-user-account-v1";
const ARYAN_RESTORE_WORKSPACE_EMAIL = "workspace@example.test";

const restoredSample UserAccount: LinkedInAccount = {
  id: "restored-sample-linkedin",
  email: "profile-owner@example.com",
  name: "Sample User Linkedin",
  state: "stopped",
  role: "Owner",
  chromeProfileMode: "single-local-profile",
  archived: false
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const storedValue = window.localStorage.getItem(key);
    return storedValue ? (JSON.parse(storedValue) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadCompanyUser() {
  return readJson<CompanyUser | null>(COMPANY_USER_KEY, null);
}

export function saveCompanyUser(user: CompanyUser) {
  window.localStorage.setItem(COMPANY_USER_KEY, JSON.stringify(user));
}

export function clearCompanyUser() {
  window.localStorage.removeItem(COMPANY_USER_KEY);
}

export function loadLinkedInAccounts() {
  return readJson<LinkedInAccount[]>(LINKEDIN_ACCOUNTS_KEY, []);
}

export function saveLinkedInAccounts(accounts: LinkedInAccount[]) {
  window.localStorage.setItem(LINKEDIN_ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function restoreSample UserAccountForWorkspace(user: CompanyUser, accounts: LinkedInAccount[]) {
  const workspaceEmail = user.email.trim().toLowerCase();
  const restoreKey = `${ARYAN_ACCOUNT_RESTORE_KEY}.${workspaceEmail}`;
  const restoreAlreadyApplied = window.localStorage.getItem(restoreKey) === "true";
  if (workspaceEmail !== ARYAN_RESTORE_WORKSPACE_EMAIL || accounts.length > 0 || restoreAlreadyApplied) {
    return accounts;
  }

  const restoredAccounts = [restoredSample UserAccount];
  saveLinkedInAccounts(restoredAccounts);
  window.localStorage.setItem(restoreKey, "true");
  return restoredAccounts;
}
