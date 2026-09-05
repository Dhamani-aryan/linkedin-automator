import type { CompanyUser, LinkedInAccount } from "../types";

const COMPANY_USER_KEY = "linkedin-automator.company-user";
const LINKEDIN_ACCOUNTS_KEY = "linkedin-automator.linkedin-accounts";

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
