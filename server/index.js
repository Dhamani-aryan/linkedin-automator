import { createServer } from "node:http";
import {
  collectVisibleProfiles,
  launch,
  listTabs,
  openChromeUrl,
  resolveProfileIdentities,
  status,
  stop
} from "./lib/browserSession.js";
import { getCampaignAnalytics } from "./lib/analytics.js";
import { AppError, ErrorCodes, toErrorResponse } from "./lib/errors.js";
import {
  checkCampaignReplies,
  getActiveCampaignRun,
  getCampaignRun,
  initializeRunner,
  listCampaignRuns,
  pauseCampaignRun,
  retryCampaignRun,
  resumeCampaignRun,
  startCampaignBatch,
  startCampaignRun,
  stopCampaignRun
} from "./lib/runner.js";

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
      sendJson(response, 200, await status());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/chrome/tabs") {
      try {
        sendJson(response, 200, { ok: true, tabs: await listTabs() });
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
      sendJson(response, 200, await launch(readOptionalUrl(body, defaultUrl)));
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

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/resolve-profile-identities") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await resolveProfileIdentities(readProfileIdentityRequests(body)));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/chrome/stop") {
      sendJson(response, 200, await stop());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/campaign-runs") {
      const body = await readJsonBody(request);
      const result = await startCampaignRun(body);
      sendJson(response, result.ok ? 201 : 400, result);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/campaign-runs/active") {
      sendJson(response, 200, await getActiveCampaignRun());
      return;
    }

    const runMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      sendJson(response, 200, await getCampaignRun(runMatch[1]));
      return;
    }

    const stopMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)\/stop$/);
    if (request.method === "POST" && stopMatch) {
      sendJson(response, 200, await stopCampaignRun(stopMatch[1]));
      return;
    }

    const pauseMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)\/pause$/);
    if (request.method === "POST" && pauseMatch) {
      sendJson(response, 200, await pauseCampaignRun(pauseMatch[1]));
      return;
    }

    const resumeMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)\/resume$/);
    if (request.method === "POST" && resumeMatch) {
      const body = await readJsonBody(request);
      sendJson(response, 200, await resumeCampaignRun(resumeMatch[1], body.actions));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/campaign-runs/batch") {
      const body = await readJsonBody(request);
      const result = await startCampaignBatch(body.snapshots);
      sendJson(response, result.ok ? 201 : 400, result);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/campaign-runs") {
      sendJson(response, 200, await listCampaignRuns(requestUrl.searchParams.get("profileId") ?? ""));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/campaign-replies/check") {
      const body = await readJsonBody(request);
      sendJson(response, 200, await checkCampaignReplies(body.profileId, { force: body.force === true }));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/analytics/campaigns") {
      sendJson(response, 200, await getCampaignAnalytics({
        profileId: requestUrl.searchParams.get("profileId") ?? "",
        campaignId: requestUrl.searchParams.get("campaignId") ?? "",
        from: requestUrl.searchParams.get("from") ?? "",
        to: requestUrl.searchParams.get("to") ?? "",
        timeZone: requestUrl.searchParams.get("timeZone") ?? "UTC"
      }));
      return;
    }

    const retryMatch = requestUrl.pathname.match(/^\/api\/campaign-runs\/([^/]+)\/retry$/);
    if (request.method === "POST" && retryMatch) {
      sendJson(response, 200, await retryCampaignRun(retryMatch[1]));
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

await initializeRunner();

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
  if (error instanceof AppError && error.code === ErrorCodes.CHROME_NOT_CONNECTED) return 503;
  return 500;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
