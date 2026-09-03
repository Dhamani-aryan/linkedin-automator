import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createBrowserSession } from "./browserSession.js";
import {
  ensureProfileStorage,
  listStoredProfiles,
  migrateLegacyProfileStorage,
  profileStoragePaths,
  readProfileSession,
  writeProfileSession
} from "./profilePaths.js";

/**
 * A registry of browser sessions, one per LinkedIn profile, each created from
 * the same factory. Asking for a profile that has never been seen creates its
 * folder and its session on the spot, so adding a profile needs no new code:
 * the single-profile setup simply replicates itself.
 *
 * Profiles share nothing — different directory, different port, different Chrome
 * process — so stopping, deleting or failing one leaves the others untouched.
 */

const defaultBasePort = Number.parseInt(process.env.CHROME_REMOTE_DEBUGGING_PORT ?? "9223", 10);
const portScanLimit = 64;

export function createBrowserPool(dependencies = {}) {
  const makeSession = dependencies.createBrowserSession ?? createBrowserSession;
  const isPortAlive = dependencies.isPortAlive ?? cdpPortIsAlive;
  const readActivePort = dependencies.readDevToolsActivePort ?? readDevToolsActivePort;
  const basePort = dependencies.basePort ?? defaultBasePort;

  const browsers = new Map();
  const opening = new Map();

  async function get(profileId) {
    const existing = browsers.get(profileId);
    if (existing) return existing;
    if (opening.has(profileId)) return await opening.get(profileId);

    const creation = create(profileId).finally(() => opening.delete(profileId));
    opening.set(profileId, creation);
    return await creation;
  }

  async function create(profileId) {
    // The very first profile inherits the single-profile installation's Chrome
    // directory, so the account already logged in there stays logged in.
    const isFirstProfile = (await listStoredProfiles()).length === 0;
    const paths = await ensureProfileStorage(profileId);
    let adoptedLegacyProfile = false;
    if (isFirstProfile) {
      adoptedLegacyProfile = (await migrateLegacyProfileStorage(profileId)).chromeProfileCopied;
    }

    const cdpPort = await resolvePort(profileId, paths);
    // Extend the session in place rather than copying it: callers hold on to this
    // exact object, so stop() and status() must act on the session they were given.
    const entry = Object.assign(makeSession({ profileId, profileDir: paths.chromeProfileDir, cdpPort }), {
      paths,
      adoptedLegacyProfile
    });
    browsers.set(profileId, entry);
    await writeProfileSession(profileId, {
      ...(await readProfileSession(profileId)),
      profileId,
      cdpPort,
      profileDir: paths.chromeProfileDir,
      updatedAt: new Date().toISOString()
    });
    return entry;
  }

  /**
   * Prefer the port Chrome itself is using for this profile (it writes
   * DevToolsActivePort into the profile directory), so a controller restart
   * adopts the browser that is already running instead of orphaning it. Then the
   * port this profile used last time, then the first free port in the range.
   */
  async function resolvePort(profileId, paths) {
    const activePort = await readActivePort(paths.chromeProfileDir);
    if (activePort && (await isPortAlive(activePort))) return activePort;

    const claimed = new Set([...browsers.values()].map((entry) => entry.cdpPort));
    const remembered = (await readProfileSession(profileId))?.cdpPort;
    if (remembered && !claimed.has(remembered) && !(await isPortAlive(remembered))) return remembered;

    for (let offset = 0; offset < portScanLimit; offset += 1) {
      const candidate = basePort + offset;
      if (claimed.has(candidate)) continue;
      if (await isPortAlive(candidate)) continue;
      return candidate;
    }
    throw new Error(`No free Chrome debugging port between ${basePort} and ${basePort + portScanLimit}.`);
  }

  async function status(profileId) {
    const browser = await get(profileId);
    return { ...(await browser.status()), profileId, profileDir: browser.profileDir };
  }

  async function statusAll(profileIds = [...browsers.keys()]) {
    return await Promise.all(profileIds.map(async (profileId) => {
      try {
        return await status(profileId);
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

  async function stop(profileId) {
    const browser = browsers.get(profileId);
    if (!browser) return { ok: true, stopped: false, message: "This profile has no browser session." };
    return await browser.stop();
  }

  /** Stop one profile and forget it, without touching any other profile. */
  async function release(profileId) {
    const result = await stop(profileId);
    browsers.delete(profileId);
    return result;
  }

  async function stopAll() {
    return await Promise.all([...browsers.keys()].map((profileId) => release(profileId)));
  }

  return {
    get,
    peek: (profileId) => browsers.get(profileId) ?? null,
    known: () => [...browsers.keys()],
    status,
    statusAll,
    stop,
    release,
    stopAll
  };
}

export async function cdpPortIsAlive(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(800)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Chrome writes the port it actually bound on line 1 of this file. */
export async function readDevToolsActivePort(profileDir) {
  try {
    const raw = await readFile(join(profileDir, "DevToolsActivePort"), "utf8");
    const port = Number.parseInt(raw.split(/\r?\n/)[0] ?? "", 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

const pool = createBrowserPool();

export const getProfileBrowser = (profileId) => pool.get(profileId);
export const peekProfileBrowser = (profileId) => pool.peek(profileId);
export const knownProfileBrowsers = () => pool.known();
export const profileBrowserStatus = (profileId) => pool.status(profileId);
export const profileBrowserStatuses = (profileIds) => pool.statusAll(profileIds);
export const stopProfileBrowser = (profileId) => pool.stop(profileId);
export const releaseProfileBrowser = (profileId) => pool.release(profileId);
export const stopAllProfileBrowsers = () => pool.stopAll();
export { profileStoragePaths };
