import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError, ErrorCodes } from "./errors.js";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cdpPort = Number.parseInt(process.env.CHROME_REMOTE_DEBUGGING_PORT ?? "9223", 10);
const profileDir = resolve(
  process.env.LINKEDIN_AUTOMATOR_CHROME_PROFILE ??
    join(rootDir, ".local", "chrome-profile")
);

let ownedChromeProcess = null;
let launchedAt = null;

export async function launch(url = "https://www.linkedin.com/") {
  const currentStatus = await status();

  if (currentStatus.connected) {
    if (url) {
      await openChromeUrl(url);
    }
    return await status();
  }

  const chromePath = resolveChromePath();
  await mkdir(profileDir, { recursive: true });

  ownedChromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=ChromeWhatsNewUI",
    "--new-window",
    url
  ], {
    detached: false,
    stdio: "ignore",
    windowsHide: false
  });
  launchedAt = new Date().toISOString();

  ownedChromeProcess.once("exit", () => {
    ownedChromeProcess = null;
  });

  await waitForCdp(12_000);
  return await status();
}

export async function stop() {
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

export async function status() {
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

export async function listTabs() {
  const tabs = await tryReadChromeTabs();

  if (tabs === null) {
    throw new AppError(
      ErrorCodes.CHROME_NOT_CONNECTED,
      "Chrome is not connected. Start the local Chrome profile first."
    );
  }

  return tabs;
}

export async function openTab(url) {
  const currentStatus = await status();

  if (!currentStatus.connected) {
    await launch(url);
    const tabs = await listTabs();
    return tabs.find((tab) => tab.url === url) ?? tabs[0] ?? null;
  }

  const response = await fetch(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" }
  );

  if (!response.ok) {
    throw new Error(`Chrome refused to open a new tab: HTTP ${response.status}`);
  }

  return toChromeTabSummary(await response.json());
}

export async function closeTab(tabId) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/close/${encodeURIComponent(tabId)}`);
  return response.ok;
}

export async function openChromeUrl(url) {
  await openTab(url);
  return await status();
}

export async function attach(tabId) {
  const tabs = await listTabs();
  const tab = tabs.find((candidate) => candidate.id === tabId);

  if (!tab?.webSocketDebuggerUrl) {
    throw new AppError(ErrorCodes.CHROME_NOT_CONNECTED, "Could not attach to the requested Chrome tab.");
  }

  return await CdpSession.connect(tab.webSocketDebuggerUrl);
}

export async function navigate(session, url, { timeoutMs = 20_000 } = {}) {
  await session.send("Page.enable");

  const loaded = session.waitFor("Page.loadEventFired", timeoutMs).catch(() => null);
  await session.send("Page.navigate", { url });
  const loadEvent = await loaded;

  if (loadEvent === null) {
    const readyState = await evaluate(session, () => document.readyState, []);
    if (readyState !== "complete" && readyState !== "interactive") {
      throw new AppError(ErrorCodes.NAVIGATION_TIMEOUT, `Timed out navigating to ${url}`);
    }
  }

  const page = await evaluate(session, () => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState
  }), []);

  return { ok: true, ...page };
}

export async function evaluate(session, fn, args = [], options = {}) {
  const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
  const result = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: options.userGesture === true
  }, options.timeoutMs);

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Chrome evaluation threw an exception.");
  }

  return result.result?.value;
}

export async function clickAt(session, point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new Error("Chrome click coordinates are invalid.");
  }

  await session.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    buttons: 0,
    pointerType: "mouse"
  });
  await sleep(250);
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    pointerType: "mouse",
    clickCount: 1
  });
  await sleep(120);
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    pointerType: "mouse",
    clickCount: 1
  });
}

export async function insertText(session, text) {
  await session.send("Input.insertText", { text: String(text ?? "") });
}

export async function checkLinkedInAuth(session) {
  const page = await navigate(session, "https://www.linkedin.com/feed/", { timeoutMs: 20_000 });
  const markers = await evaluate(session, () => {
    const bodyText = document.body?.innerText?.toLowerCase() ?? "";
    const hasLoginForm = Boolean(
      document.querySelector('input[name="session_key"], input[name="session_password"], form[action*="login"]')
    );
    const hasFeedMarker = Boolean(
      document.querySelector('[data-test-id*="feed"], [aria-label*="Start a post"], a[href*="/feed/"]')
    );

    return {
      url: location.href,
      title: document.title,
      hasLoginForm,
      hasFeedMarker,
      hasChallengeText:
        bodyText.includes("security verification") ||
        bodyText.includes("checkpoint") ||
        bodyText.includes("verify your identity")
    };
  }, []);

  if (markers.hasChallengeText || /checkpoint|challenge/i.test(markers.url)) {
    return { ok: false, state: "challenge", errorCode: ErrorCodes.AUTH_CHALLENGE, page };
  }

  if (markers.hasLoginForm || /\/login|\/uas\/login|authwall/i.test(markers.url)) {
    return { ok: false, state: "logged_out", errorCode: ErrorCodes.LINKEDIN_LOGGED_OUT, page };
  }

  return { ok: true, state: markers.hasFeedMarker ? "logged_in" : "unknown", page };
}

export async function collectVisibleProfiles(sourceUrl = "") {
  if (sourceUrl) {
    await openChromeUrl(sourceUrl);
    await sleep(1_800);
  }

  const tabs = await listTabs();
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

  if (!tab?.id) {
    throw new Error("Open a LinkedIn or Sales Navigator page in managed Chrome before collecting profiles.");
  }

  const session = await attach(tab.id);
  try {
    const value = await evaluate(session, () => {
      const profiles = [];
      const seen = new Set();
      for (const anchor of document.querySelectorAll("a[href]")) {
        try {
          const url = new URL(anchor.href, location.href);
          const isLinkedInProfile = url.hostname.endsWith("linkedin.com") && /^\/in\/[^/]+/.test(url.pathname);
          const isSalesLead = url.hostname.endsWith("linkedin.com") && /^\/sales\/lead\/[^/]+/.test(url.pathname);
          if (!isLinkedInProfile && !isSalesLead) continue;
          const normalized = url.origin + url.pathname;
          if (seen.has(normalized)) continue;
          seen.add(normalized);
          const name = (anchor.textContent || anchor.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);
          profiles.push({ url: normalized, name });
        } catch {}
      }
      return { pageUrl: location.href, pageTitle: document.title, profiles: profiles.slice(0, 250) };
    }, []);

    if (!value || !Array.isArray(value.profiles)) {
      throw new Error("Could not read profile links from the current LinkedIn page.");
    }

    return {
      ok: true,
      pageUrl: typeof value.pageUrl === "string" ? value.pageUrl : tab.url,
      pageTitle: typeof value.pageTitle === "string" ? value.pageTitle : tab.title,
      profiles: value.profiles
    };
  } finally {
    session.close();
  }
}

export async function resolveProfileIdentities(profiles) {
  const resolved = [];

  for (const profile of profiles) {
    const tab = await openTab("about:blank");
    let session = null;
    try {
      session = await attach(tab.id);
      await navigate(session, profile.url, { timeoutMs: 25_000 });
      const identity = await evaluate(session, (requestedUrl) => {
        const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
        const isVisible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        };
        const normalizedLinkedInUrl = (value) => {
          try {
            const url = new URL(value, location.href);
            return `${url.origin}${url.pathname}`.replace(/\/$/, "");
          } catch {
            return "";
          }
        };
        const sectionByHeading = (label) => [...document.querySelectorAll("main h2, main h3")]
          .find((heading) => isVisible(heading) && normalize(heading.textContent).toLowerCase() === label)
          ?.closest("section");
        const distinctLines = (value) => {
          const seen = new Set();
          return String(value ?? "")
            .split(/\n+/)
            .map(normalize)
            .filter((line) => line && !seen.has(line.toLowerCase()) && seen.add(line.toLowerCase()));
        };
        const visibleHeadings = [...document.querySelectorAll("main h1, h1")]
          .filter(isVisible)
          .map((element) => normalize(element.textContent))
          .filter(Boolean);
        const titleName = normalize(document.title.replace(/\s*\|\s*LinkedIn\s*$/i, ""));
        const displayName = visibleHeadings[0] || titleName;
        const parts = displayName.split(" ").filter(Boolean);
        const heading = [...document.querySelectorAll("main h1, h1")].find(isVisible);
        const topCard = heading?.closest("section") ?? heading?.parentElement?.parentElement?.parentElement ?? null;
        const headline = normalize(
          topCard?.querySelector('[data-anonymize="headline"], .text-body-medium.break-words, [data-generated-suggestion-target]')
            ?.textContent
        );
        const locationText = normalize(
          topCard?.querySelector('[data-anonymize="location"], .text-body-small.inline.t-black--light.break-words')
            ?.textContent
        );
        const experienceSection = sectionByHeading("experience");
        const experienceItem = experienceSection?.querySelector("li") ?? null;
        const experienceLines = distinctLines(experienceItem?.innerText);
        const experienceCompanyLink = experienceItem?.querySelector('a[href*="/company/"], a[href*="/sales/company/"]');
        const topCompanyLink = topCard?.querySelector('a[href*="/company/"], a[href*="/sales/company/"]');
        const companyLink = experienceCompanyLink ?? topCompanyLink;
        const companyFromLine = experienceLines[1]?.replace(/\s*·.*$/, "") ?? "";
        const company = normalize(companyLink?.textContent) || normalize(companyFromLine);
        const position = experienceLines[0] ?? "";
        const aboutSection = sectionByHeading("about");
        const aboutLines = distinctLines(aboutSection?.innerText)
          .filter((line) => line.toLowerCase() !== "about" && line.toLowerCase() !== "see more");
        const topLines = distinctLines(topCard?.innerText);
        const connectionDegree = topLines.find((line) => /^(?:·\s*)?(?:1st|2nd|3rd)(?: degree connection)?$/i.test(line))
          ?.replace(/^·\s*/, "") ?? "";
        const personalLinkedInUrl = normalizedLinkedInUrl(location.href);
        const publicId = personalLinkedInUrl.match(/\/in\/([^/]+)/i)?.[1] ?? "";
        const requestedIsSales = /linkedin\.com\/sales\/lead\//i.test(requestedUrl);
        return {
          pageKind: /linkedin\.com\/(in|sales\/lead)\//i.test(location.href) ? "profile" : "unknown",
          displayName,
          firstName: parts[0] ?? "",
          lastName: parts.slice(1).join(" "),
          url: personalLinkedInUrl,
          personalLinkedInUrl,
          salesNavigatorUrl: requestedIsSales ? normalizedLinkedInUrl(requestedUrl) : "",
          headline,
          position,
          company,
          companyLinkedinUrl: normalizedLinkedInUrl(companyLink?.href),
          location: locationText,
          about: aboutLines.join("\n"),
          publicId: decodeURIComponent(publicId),
          connectionDegree
        };
      }, [profile.url]);

      resolved.push({
        id: profile.id,
        requestedUrl: profile.url,
        ...identity,
        resolved: identity.pageKind === "profile" && identity.firstName.length > 0
      });
    } catch (error) {
      resolved.push({
        id: profile.id,
        requestedUrl: profile.url,
        resolved: false,
        error: error instanceof Error ? error.message : "Profile identity could not be resolved."
      });
    } finally {
      session?.close();
      await closeTab(tab.id).catch(() => false);
    }
  }

  return { ok: true, profiles: resolved };
}

class CdpSession extends EventEmitter {
  static async connect(webSocketUrl) {
    const session = new CdpSession(webSocketUrl);
    await session.open();
    return session;
  }

  constructor(webSocketUrl) {
    super();
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.commandId = 0;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      const socket = new WebSocket(this.webSocketUrl);
      this.socket = socket;

      const timeout = setTimeout(() => {
        socket.close();
        rejectOpen(new Error("Timed out connecting to the managed Chrome tab."));
      }, 8_000);

      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolveOpen();
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (typeof message.id === "number" && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          clearTimeout(pending.timeout);
          if (message.error) {
            pending.reject(new Error(message.error.message ?? "Chrome command failed."));
            return;
          }
          pending.resolve(message.result ?? {});
          return;
        }

        if (typeof message.method === "string") {
          this.emit(message.method, message.params ?? {});
        }
      });

      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        rejectOpen(new Error("Could not connect to the managed Chrome tab."));
      });

      socket.addEventListener("close", () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("Chrome tab connection closed."));
        }
        this.pending.clear();
      });
    });
  }

  send(method, params = {}, timeoutMs = 10_000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Chrome tab is not connected."));
    }

    const id = ++this.commandId;
    return new Promise((resolveSend, rejectSend) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new Error(`Chrome command timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolveWait, rejectWait) => {
      const timeout = setTimeout(() => {
        this.off(method, onEvent);
        rejectWait(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);

      const onEvent = (params) => {
        clearTimeout(timeout);
        resolveWait(params);
      };
      this.once(method, onEvent);
    });
  }

  close() {
    this.socket?.close();
  }
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

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
