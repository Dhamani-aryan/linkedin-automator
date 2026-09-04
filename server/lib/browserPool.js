import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { createBrowserSession } from "./browserSession.js";
import {
  ensureProfileStorage,
  migrateLegacyProfileStorage,
  profileStoragePaths,
  readProfileSession,
  recordLegacyProfileOwner,
  resolveLegacyProfileOwner,
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
  const findLegacyOwner = dependencies.resolveLegacyProfileOwner ?? resolveLegacyProfileOwner;
  const claimLegacyOwner = dependencies.recordLegacyProfileOwner ?? recordLegacyProfileOwner;
  const isPortAlive = dependencies.isPortAlive ?? cdpPortIsAlive;
  const isPortBindable = dependencies.isPortBindable ?? portIsBindable;
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
    // Only the profile that owns the single-profile installation inherits its
    // Chrome directory. Every other profile starts empty and is logged into by
    // hand, so a newly added account can never open the old account's session.
    const legacyOwner = await findLegacyOwner();
    const paths = await ensureProfileStorage(profileId);
    let adoptedLegacyProfile = false;
    if (legacyOwner === profileId) {
      adoptedLegacyProfile = (await migrateLegacyProfileStorage(profileId)).chromeProfileCopied;
    } else if (legacyOwner === null) {
      // Nothing on disk says who the old login belongs to (no run history), so the
      // first profile to open a browser claims it, and the claim is recorded.
      adoptedLegacyProfile = (await migrateLegacyProfileStorage(profileId)).chromeProfileCopied;
      await claimLegacyOwner(profileId);
    }

    const cdpPort = await resolvePort(profileId, paths);
    // Extend the session in place rather than copying it: callers hold on to this
    // exact object, so stop() and status() must act on the session they were given.
    const entry = Object.assign(makeSession({ profileId, profileDir: paths.chromeProfileDir, cdpPort }), {
      paths,
      adoptedLegacyProfile
    });
    // Chrome may bind a different port than the one we asked for; record whatever it
    // ended up on so the next controller start finds this profile again.
    const launchWithoutRecord = entry.launch;
    entry.launch = async (...args) => {
      const result = await launchWithoutRecord(...args);
      await rememberSession(profileId, paths, entry.cdpPort);
      return result;
    };
    browsers.set(profileId, entry);
    await rememberSession(profileId, paths, cdpPort);
    return entry;
  }

  async function rememberSession(profileId, paths, cdpPort) {
    await writeProfileSession(profileId, {
      ...(await readProfileSession(profileId)),
      profileId,
      cdpPort,
      profileDir: paths.chromeProfileDir,
      updatedAt: new Date().toISOString()
    });
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
    if (remembered && (await isPortUsable(remembered, claimed))) return remembered;

    for (let offset = 0; offset < portScanLimit; offset += 1) {
      const candidate = basePort + offset;
      if (await isPortUsable(candidate, claimed)) return candidate;
    }
    throw new Error(`No free Chrome debugging port between ${basePort} and ${basePort + portScanLimit}.`);
  }

  /**
   * A port is only usable if nothing answers on it AND Chrome can actually bind it.
   * On Windows whole ranges can be reserved (Hyper-V, WSL) or held by software that
   * never answers HTTP: handing Chrome one of those makes it start with no
   * automation port at all, which looks like a broken profile.
   */
  async function isPortUsable(port, claimed) {
    if (claimed.has(port)) return false;
    if (await isPortAlive(port)) return false;
    return await isPortBindable(port);
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

/** Can a server actually listen on this port on this machine right now? */
export async function portIsBindable(port) {
  return await new Promise((resolve) => {
    const probe = createServer();
    const finish = (usable) => {
      probe.removeAllListeners();
      resolve(usable);
    };
    probe.once("error", () => finish(false));
    probe.once("listening", () => probe.close(() => finish(true)));
    try {
      probe.listen(port, "127.0.0.1");
    } catch {
      finish(false);
    }
  });
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
