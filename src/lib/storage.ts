import type { CompanyUser, LinkedInAccount } from "../types";

const COMPANY_USER_KEY = "linkedin-automator.company-user";
const LINKEDIN_ACCOUNTS_KEY = "linkedin-automator.linkedin-accounts";
const ARYAN_ACCOUNT_RESTORE_KEY = "linkedin-automator.restore-sample-user-account-v1";

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
  const accounts = readJson<LinkedInAccount[]>(LINKEDIN_ACCOUNTS_KEY, []);
  const restoreAlreadyApplied = window.localStorage.getItem(ARYAN_ACCOUNT_RESTORE_KEY) === "true";
  if (accounts.length > 0 || restoreAlreadyApplied) return accounts;

  const restoredAccounts = [restoredSample UserAccount];
  window.localStorage.setItem(LINKEDIN_ACCOUNTS_KEY, JSON.stringify(restoredAccounts));
  window.localStorage.setItem(ARYAN_ACCOUNT_RESTORE_KEY, "true");
  return restoredAccounts;
}

export function saveLinkedInAccounts(accounts: LinkedInAccount[]) {
  window.localStorage.setItem(LINKEDIN_ACCOUNTS_KEY, JSON.stringify(accounts));
}
