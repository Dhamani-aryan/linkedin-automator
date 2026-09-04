import { createServer } from "node:http";
import { getCampaignAnalytics } from "./lib/analytics.js";
import { AppError, ErrorCodes, toErrorResponse } from "./lib/errors.js";
import { listStoredProfiles } from "./lib/profilePaths.js";
import { findRuntimeForRun, getProfileRuntime, initializeProfileRuntimes } from "./lib/profileRuntime.js";

const host = process.env.LINKEDIN_AUTOMATOR_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.LINKEDIN_AUTOMATOR_PORT ?? "4287", 10);
const defaultUrl = "https://www.linkedin.com/";

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
      const browser = await browserFor(requestUrl.searchParams.get("profileId"));
      sendJson(response, 200, { ...(await browser.status()), profileId: browser.profileId });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/chrome/sessions") {
      sendJson(response, 200, { ok: true, sessions: await allProfileStatuses() });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/chrome/tabs") {
      try {
        const browser = await browserFor(requestUrl.searchParams.get("profileId"));
        sendJson(response, 200, { ok: true, tabs: await browser.listTabs() });
      } catch (error) {
        if (error instanceof AppError && error.code === ErrorCodes.CHROME_NOT_CONNECTED) {
          sendJson(response, 200, { ok: false, error: toErrorResponse(error) });
          return;
        }
        throw error;
      }
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/start") {
      const body = await readJsonBody(request);
      const browser = await browserFor(body.profileId);
      sendJson(response, 200, { ...(await browser.launch(readOptionalUrl(body, defaultUrl))), profileId: browser.profileId });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/open") {
      const body = await readJsonBody(request);
      const browser = await browserFor(body.profileId);
      sendJson(response, 200, { ...(await browser.openChromeUrl(readRequiredUrl(body))), profileId: browser.profileId });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/collect-profiles") {
      const body = await readJsonBody(request);
      const browser = await browserFor(body.profileId);
      sendJson(response, 200, await browser.collectVisibleProfiles(readOptionalUrl(body, "")));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/resolve-profile-identities") {
      const body = await readJsonBody(request);
      const browser = await browserFor(body.profileId);
      sendJson(response, 200, await browser.resolveProfileIdentities(readProfileIdentityRequests(body)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/stop") {
      const body = await readJsonBody(request);
      const browser = await browserFor(body.profileId);
      sendJson(response, 200, await browser.stop());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/campaign-runs") {
      const body = await readJsonBody(request);
      const runtime = await runtimeFor(body.profileId);
      const result = await runtime.runner.startCampaignRun(body);
      sendJson(response, result.ok ? 201 : 400, result);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/campaign-runs/active") {
      const runtime = await runtimeFor(requestUrl.searchParams.get("profileId"));
      sendJson(response, 200, await runtime.runner.getActiveCampaignRun());
      return;
    }

    const runMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      const runtime = await runtimeForRun(runMatch[1]);
      sendJson(response, 200, await runtime.runner.getCampaignRun(runMatch[1]));
      return;
    }

    const stopMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)\/stop$/);
    if (request.method === "POST" && stopMatch) {
      const runtime = await runtimeForRun(stopMatch[1]);
      sendJson(response, 200, await runtime.runner.stopCampaignRun(stopMatch[1]));
      return;
    }

    const pauseMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)\/pause$/);
    if (request.method === "POST" && pauseMatch) {
      const runtime = await runtimeForRun(pauseMatch[1]);
      sendJson(response, 200, await runtime.runner.pauseCampaignRun(pauseMatch[1]));
      return;
    }

    const resumeMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)\/resume$/);
    if (request.method === "POST" && resumeMatch) {
      const body = await readJsonBody(request);
      const runtime = await runtimeForRun(resumeMatch[1]);
      sendJson(response, 200, await runtime.runner.resumeCampaignRun(resumeMatch[1], body.actions));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/campaign-runs/batch") {
      const body = await readJsonBody(request);
      const runtime = await runtimeFor(body.snapshots?.[0]?.profileId);
      const result = await runtime.runner.startCampaignBatch(body.snapshots);
      sendJson(response, result.ok ? 201 : 400, result);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/campaign-runs") {
      const profileId = requireProfileId(requestUrl.searchParams.get("profileId"));
      const runtime = await runtimeFor(profileId);
      sendJson(response, 200, await runtime.runner.listCampaignRuns(profileId));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/campaign-replies/check") {
      const body = await readJsonBody(request);
      const runtime = await runtimeFor(body.profileId);
      sendJson(response, 200, await runtime.runner.checkCampaignReplies(body.profileId, { force: body.force === true }));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/analytics/campaigns") {
      const profileId = requireProfileId(requestUrl.searchParams.get("profileId"));
      const runtime = await runtimeFor(profileId);
      sendJson(response, 200, await getCampaignAnalytics({
        profileId,
        campaignId: requestUrl.searchParams.get("campaignId") ?? "",
        from: requestUrl.searchParams.get("from") ?? "",
        to: requestUrl.searchParams.get("to") ?? "",
        timeZone: requestUrl.searchParams.get("timeZone") ?? "UTC"
      }, { listRuns: runtime.listRuns, readAudit: runtime.readAudit }));
      return;
    }

    const retryMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)\/retry$/);
    if (request.method === "POST" && retryMatch) {
      const runtime = await runtimeForRun(retryMatch[1]);
      sendJson(response, 200, await runtime.runner.retryCampaignRun(retryMatch[1]));
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Endpoint not found." }
    });
  } catch (error) {
    sendJson(response, statusForError(error), {
      ok: false,
      error: toErrorResponse(error)
    });
  }
});

server.listen(port, host, () => {
  console.log(`LinkedIn Automator local server listening on http://${host}:${port}`);
});

await initializeProfileRuntimes((await listStoredProfiles()).map((stored) => stored.profileId).filter(Boolean));

/**
 * Every browser and run endpoint is scoped to one LinkedIn profile. A missing
 * profile id is an error rather than a silent fallback to whichever profile the
 * server happened to open first.
 */
function requireProfileId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("MISSING_PROFILE", "A LinkedIn profile is required for this request.");
  }
  return value.trim();
}

async function runtimeFor(profileId) {
  return await getProfileRuntime(requireProfileId(profileId));
}

async function browserFor(profileId) {
  return (await runtimeFor(profileId)).browser;
}

async function runtimeForRun(runId) {
  const runtime = await findRuntimeForRun(runId);
  if (!runtime) {
    throw new AppError("RUN_NOT_FOUND", "That campaign run does not belong to any known profile.");
  }
  return runtime;
}

async function allProfileStatuses() {
  const stored = (await listStoredProfiles()).map((entry) => entry.profileId).filter(Boolean);
  return await Promise.all(stored.map(async (profileId) => {
    try {
      const browser = await browserFor(profileId);
      return { ...(await browser.status()), profileId };
    } catch (error) {
      return {
        ok: false,
        profileId,
        connected: false,
        error: error instanceof Error ? error.message : "Chrome status failed."
      };
    }
  }));
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

function readProfileIdentityRequests(value) {
  if (typeof value !== "object" || value === null || !Array.isArray(value.profiles)) {
    throw new Error("profiles must be an array.");
  }
  if (value.profiles.length === 0 || value.profiles.length > 100) {
    throw new Error("profiles must contain between 1 and 100 LinkedIn profiles.");
  }

  return value.profiles.map((profile) => {
    if (
      typeof profile !== "object" ||
      profile === null ||
      typeof profile.id !== "string" ||
      typeof profile.url !== "string"
    ) {
      throw new Error("Each profile requires an id and LinkedIn URL.");
    }
    const url = normalizeUrl(profile.url);
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("linkedin.com") || !/^\/(in|sales\/lead)\//i.test(parsed.pathname)) {
      throw new Error("Each profile must use a LinkedIn profile or Sales Navigator lead URL.");
    }
    return { id: profile.id, url };
  });
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

function statusForError(error) {
  if (error instanceof AppError && error.code === "ACTIVE_RUN_EXISTS") return 409;
  if (error instanceof AppError && error.code === "LIVE_RUN_NOT_VERIFIED") return 400;
  if (error instanceof AppError && error.code === "MISSING_PROFILE") return 400;
  if (error instanceof AppError && error.code === "RUN_NOT_FOUND") return 404;
  if (error instanceof AppError && error.code === ErrorCodes.CHROME_NOT_CONNECTED) return 503;
  return 500;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
