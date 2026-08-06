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

export async function stopChrome(): Promise<{ ok: true; stopped: boolean; message?: string }> {
  return request<{ ok: true; stopped: boolean; message?: string }>("/api/chrome/stop", {
    method: "POST"
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json()) as T | ChromeApiFailure;

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
