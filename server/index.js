import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const host = process.env.LINKEDIN_AUTOMATOR_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.LINKEDIN_AUTOMATOR_PORT ?? "4287", 10);
const cdpPort = Number.parseInt(process.env.CHROME_REMOTE_DEBUGGING_PORT ?? "9223", 10);
const profileDir = resolve(
  process.env.LINKEDIN_AUTOMATOR_CHROME_PROFILE ??
    join(rootDir, ".local", "chrome-profile")
);
const defaultUrl = "https://www.linkedin.com/";

let ownedChromeProcess = null;
let launchedAt = null;

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, null);
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/chrome/status") {
      sendJson(response, 200, await getChromeStatus());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/chrome/tabs") {
      sendJson(response, 200, await getChromeTabs());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/start") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await startChrome(readOptionalUrl(body, defaultUrl)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/open") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await openChromeUrl(readRequiredUrl(body)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/collect-profiles") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await collectVisibleProfiles(readOptionalUrl(body, "")));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/stop") {
      sendJson(response, 200, await stopChrome());
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Endpoint not found." }
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unexpected server error."
      }
    });
  }
});

server.listen(port, host, () => {
  console.log(`LinkedIn Automator local server listening on http://${host}:${port}`);
});

async function startChrome(url) {
  const status = await getChromeStatus();

  if (status.connected) {
    if (url) {
      await openChromeUrl(url);
    }
    return await getChromeStatus();
  }

  const chromePath = resolveChromePath();
  await mkdir(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=ChromeWhatsNewUI",
    "--new-window",
    url
  ];

  ownedChromeProcess = spawn(chromePath, args, {
    detached: false,
    stdio: "ignore",
    windowsHide: false
  });
  launchedAt = new Date().toISOString();

  ownedChromeProcess.once("exit", () => {
    ownedChromeProcess = null;
  });

  await waitForCdp(12_000);
  return await getChromeStatus();
}

async function stopChrome() {
  if (ownedChromeProcess === null) {
    return {
      ok: true,
      stopped: false,
      message: "No Chrome process owned by this server is running."
    };
  }

  const processToStop = ownedChromeProcess;
  ownedChromeProcess = null;
  processToStop.kill();
  return { ok: true, stopped: true };
}

async function openChromeUrl(url) {
  const status = await getChromeStatus();

  if (!status.connected) {
    return await startChrome(url);
  }

  const response = await fetch(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" }
  );

  if (!response.ok) {
    throw new Error(`Chrome refused to open a new tab: HTTP ${response.status}`);
  }

  return await getChromeStatus();
}

async function collectVisibleProfiles(sourceUrl) {
  if (sourceUrl) {
    await openChromeUrl(sourceUrl);
    await sleep(1_800);
  }

  const tabs = await tryReadChromeTabs();
  if (tabs === null) {
    throw new Error("Chrome is not connected. Start the managed Chrome profile first.");
  }

  const sourcePath = sourceUrl ? new URL(sourceUrl).pathname : "";
  const tab = tabs.find((candidate) =>
    candidate.webSocketDebuggerUrl &&
    candidate.url.includes("linkedin.com") &&
    (sourcePath.length === 0 || candidate.url.includes(sourcePath))
  ) ?? tabs.find((candidate) =>
    candidate.webSocketDebuggerUrl && candidate.url.includes("linkedin.com/sales/")
  ) ?? tabs.find((candidate) =>
    candidate.webSocketDebuggerUrl && candidate.url.includes("linkedin.com")
  );

  if (!tab?.webSocketDebuggerUrl) {
    throw new Error("Open a LinkedIn or Sales Navigator page in managed Chrome before collecting profiles.");
  }

  const result = await evaluateInChrome(tab.webSocketDebuggerUrl, `(() => {
    const profiles = [];
    const seen = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      try {
        const url = new URL(anchor.href, location.href);
        const isLinkedInProfile = url.hostname.endsWith('linkedin.com') && /^\\/in\\/[^/]+/.test(url.pathname);
        const isSalesLead = url.hostname.endsWith('linkedin.com') && /^\\/sales\\/lead\\/[^/]+/.test(url.pathname);
        if (!isLinkedInProfile && !isSalesLead) continue;
        const normalized = url.origin + url.pathname;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        const name = (anchor.textContent || anchor.getAttribute('aria-label') || '')
          .replace(/\\s+/g, ' ')
          .trim()
          .slice(0, 120);
        profiles.push({ url: normalized, name });
      } catch {}
    }
    return { pageUrl: location.href, pageTitle: document.title, profiles: profiles.slice(0, 250) };
  })()`);

  const value = result?.result?.result?.value;
  if (!value || !Array.isArray(value.profiles)) {
    throw new Error("Could not read profile links from the current LinkedIn page.");
  }

  return {
    ok: true,
    pageUrl: typeof value.pageUrl === "string" ? value.pageUrl : tab.url,
    pageTitle: typeof value.pageTitle === "string" ? value.pageTitle : tab.title,
    profiles: value.profiles
  };
}

async function evaluateInChrome(webSocketUrl, expression) {
  return await new Promise((resolveEvaluation, rejectEvaluation) => {
    const socket = new WebSocket(webSocketUrl);
    const commandId = 1;
    const timeout = setTimeout(() => {
      socket.close();
      rejectEvaluation(new Error("Timed out while reading the current Chrome page."));
    }, 8_000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: commandId,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true }
      }));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== commandId) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) {
        rejectEvaluation(new Error(message.error.message ?? "Chrome evaluation failed."));
        return;
      }
      resolveEvaluation(message);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectEvaluation(new Error("Could not connect to the managed Chrome tab."));
    });
  });
}

async function getChromeStatus() {
  const tabs = await tryReadChromeTabs();
  return {
    ok: true,
    connected: tabs !== null,
    cdpPort,
    profileDir,
    ownedProcess: ownedChromeProcess !== null,
    launchedAt,
    tabs: tabs ?? []
  };
}

async function getChromeTabs() {
  const tabs = await tryReadChromeTabs();

  if (tabs === null) {
    return {
      ok: false,
      error: {
        code: "CHROME_NOT_CONNECTED",
        message: "Chrome is not connected. Start the local Chrome profile first."
      }
    };
  }

  return { ok: true, tabs };
}

async function tryReadChromeTabs() {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
      signal: AbortSignal.timeout(800)
    });

    if (!response.ok) {
      return null;
    }

    const parsed = await response.json();
    return Array.isArray(parsed) ? parsed.map(toChromeTabSummary) : [];
  } catch {
    return null;
  }
}

async function waitForCdp(timeoutMs) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if ((await tryReadChromeTabs()) !== null) {
      return;
    }
    await sleep(250);
  }

  throw new Error("Chrome opened, but the debugging endpoint did not become available.");
}

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env.LocalAppData ?? "", "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));

  if (found === undefined) {
    throw new Error("Could not find Chrome. Set CHROME_PATH to chrome.exe.");
  }

  return found;
}

function toChromeTabSummary(value) {
  const tab = typeof value === "object" && value !== null ? value : {};
  return {
    id: typeof tab.id === "string" ? tab.id : null,
    title: typeof tab.title === "string" ? tab.title : "",
    url: typeof tab.url === "string" ? tab.url : "",
    type: typeof tab.type === "string" ? tab.type : "",
    webSocketDebuggerUrl:
      typeof tab.webSocketDebuggerUrl === "string" ? tab.webSocketDebuggerUrl : null
  };
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body.length === 0 ? {} : JSON.parse(body);
}

function readOptionalUrl(value, fallback) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fallback;
  }
  const raw = value.url;
  return typeof raw === "string" && raw.trim().length > 0 ? normalizeUrl(raw) : fallback;
}

function readRequiredUrl(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }
  const raw = value.url;

  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("url is required.");
  }

  return normalizeUrl(raw);
}

function normalizeUrl(value) {
  const trimmed = value.trim();

  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("chrome://") || trimmed.startsWith("about:")) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json"
  });

  if (status === 204) {
    response.end();
    return;
  }

  response.end(JSON.stringify(body));
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
