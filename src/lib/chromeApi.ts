import type { ChromeStatus } from "../types";

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

export async function getChromeStatus(): Promise<ChromeStatus> {
  return request<ChromeStatus>("/api/chrome/status");
}

export async function startChrome(url = "https://www.linkedin.com/"): Promise<ChromeStatus> {
  return request<ChromeStatus>("/api/chrome/start", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ url })
  });
}

export async function openChromeUrl(url: string): Promise<ChromeStatus> {
  return request<ChromeStatus>("/api/chrome/open", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ url })
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

export async function collectVisibleProfiles(sourceUrl?: string): Promise<ProfileCollectionResult> {
  return request<ProfileCollectionResult>("/api/chrome/collect-profiles", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ sourceUrl })
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
  error?: string;
};

export async function resolveProfileIdentities(
  profiles: Array<{ id: string; url: string }>
): Promise<{ ok: true; profiles: ResolvedProfileIdentity[] }> {
  return request<{ ok: true; profiles: ResolvedProfileIdentity[] }>("/api/chrome/resolve-profile-identities", {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ profiles })
  });
}

export async function stopChrome(): Promise<{ ok: true; stopped: boolean; message?: string }> {
  return request<{ ok: true; stopped: boolean; message?: string }>("/api/chrome/stop", {
    method: "POST"
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
