import type { ChromeStatus, LeadProfile } from "../types";

type ChromeApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

const defaultHeaders = {
  "content-type": "application/json"
};

export async function getChromeStatus(profileId: string): Promise<ChromeStatus> {
  return request<ChromeStatus>(`/api/chrome/status?profileId=${encodeURIComponent(profileId)}`);
}

export async function startChrome(
  profileId: string,
  url = "https://www.linkedin.com/"
): Promise<ChromeStatus> {
  return request<ChromeStatus>("/api/chrome/start", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ profileId, url })
  });
}

export async function openChromeUrl(profileId: string, url: string): Promise<ChromeStatus> {
  return request<ChromeStatus>("/api/chrome/open", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ profileId, url })
  });
}

export type CollectedProfileLink = {
  url: string;
  name: string;
};

export type ProfileCollectionResult = {
  ok: true;
  pageUrl: string;
  pageTitle: string;
  profiles: CollectedProfileLink[];
};

export async function collectVisibleProfiles(
  profileId: string,
  sourceUrl?: string
): Promise<ProfileCollectionResult> {
  return request<ProfileCollectionResult>("/api/chrome/collect-profiles", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ profileId, sourceUrl })
  });
}

export type ResolvedProfileIdentity = {
  id: string;
  requestedUrl: string;
  resolved: boolean;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  url?: string;
  personalLinkedInUrl?: string;
  salesNavigatorUrl?: string;
  headline?: string;
  position?: string;
  company?: string;
  companyLinkedinUrl?: string;
  location?: string;
  industry?: string;
  about?: string;
  email?: string;
  phone?: string;
  website?: string;
  publicId?: string;
  connectionDegree?: string;
  error?: string;
};

export async function resolveProfileIdentities(
  profileId: string,
  profiles: Array<{ id: string; url: string }>
): Promise<{ ok: true; profiles: ResolvedProfileIdentity[] }> {
  return request<{ ok: true; profiles: ResolvedProfileIdentity[] }>("/api/chrome/resolve-profile-identities", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ profileId, profiles })
  });
}

export function mergeResolvedProfileData(lead: LeadProfile, identity: ResolvedProfileIdentity): LeadProfile {
  const text = (value: string | undefined) => value?.trim() || undefined;
  const personalLinkedInUrl = text(identity.personalLinkedInUrl);
  return {
    ...lead,
    ...(text(identity.displayName) ? { displayName: text(identity.displayName) as string } : {}),
    ...(text(identity.firstName) ? { firstName: text(identity.firstName) as string } : {}),
    ...(text(identity.lastName) ? { lastName: text(identity.lastName) as string } : {}),
    ...(personalLinkedInUrl && /linkedin\.com\/in\//i.test(personalLinkedInUrl)
      ? { linkedinUrl: personalLinkedInUrl }
      : {}),
    ...(text(identity.salesNavigatorUrl) ? { salesNavigatorUrl: text(identity.salesNavigatorUrl) } : {}),
    ...(text(identity.headline) ? { headline: text(identity.headline) } : {}),
    ...(text(identity.position) ? { position: text(identity.position) as string } : {}),
    ...(text(identity.company) ? { company: text(identity.company) as string } : {}),
    ...(text(identity.companyLinkedinUrl) ? { companyLinkedinUrl: text(identity.companyLinkedinUrl) } : {}),
    ...(text(identity.location) ? { location: text(identity.location) as string } : {}),
    ...(text(identity.industry) ? { industry: text(identity.industry) } : {}),
    ...(text(identity.about) ? { about: text(identity.about) } : {}),
    ...(text(identity.email) ? { email: text(identity.email) } : {}),
    ...(text(identity.phone) ? { phone: text(identity.phone) } : {}),
    ...(text(identity.website) ? { website: text(identity.website) } : {}),
    ...(text(identity.publicId) ? { publicId: text(identity.publicId) } : {}),
    ...(text(identity.connectionDegree) ? { connectionDegree: text(identity.connectionDegree) } : {})
  };
}

export async function stopChrome(profileId: string): Promise<{ ok: true; stopped: boolean; message?: string }> {
  return request<{ ok: true; stopped: boolean; message?: string }>("/api/chrome/stop", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ profileId })
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("The local Chrome controller is unavailable. Restart the app and try again.");
  }

  const responseText = await response.text();
  if (!responseText.trim()) {
    throw new Error(
      response.ok
        ? "The local Chrome controller returned an empty response."
        : "The local Chrome controller is unavailable. Restart the app and try again."
    );
  }

  let body: T | ChromeApiFailure;
  try {
    body = JSON.parse(responseText) as T | ChromeApiFailure;
  } catch {
    throw new Error("The local Chrome controller returned an invalid response.");
  }

  if (!response.ok || (isFailure(body))) {
    throw new Error(isFailure(body) ? body.error.message : `Request failed: ${response.status}`);
  }

  return body as T;
}

function isFailure(value: unknown): value is ChromeApiFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false
  );
}
