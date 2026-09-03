import { getProfileBrowser, releaseProfileBrowser } from "./browserPool.js";
import { ensureProfileStorage } from "./profilePaths.js";
import { createRunStore } from "./runStore.js";
import { createProfileRunner } from "./runner.js";

/**
 * The whole single-profile setup, once per LinkedIn profile:
 *
 *   runtime = storage folder + chrome session + run store + run loop
 *
 * Asking for a profile that has never been seen builds its runtime on the spot,
 * so nothing has to be written or configured to add the second, third or tenth
 * profile — the framework replicates itself.
 *
 * Runtimes never share state, so a profile can be started, paused, stopped or
 * deleted while every other profile keeps running.
 */

export function createProfileRuntimeRegistry(dependencies = {}) {
  const openBrowser = dependencies.getProfileBrowser ?? getProfileBrowser;
  const closeBrowser = dependencies.releaseProfileBrowser ?? releaseProfileBrowser;
  const makeRunner = dependencies.createProfileRunner ?? createProfileRunner;
  const makeStore = dependencies.createRunStore ?? createRunStore;
  const makeStorage = dependencies.ensureProfileStorage ?? ensureProfileStorage;

  const runtimes = new Map();
  const opening = new Map();

  async function get(profileId) {
    if (!profileId || typeof profileId !== "string") {
      throw new Error("A profile id is required to reach a profile runtime.");
    }
    const existing = runtimes.get(profileId);
    if (existing) return existing;
    if (opening.has(profileId)) return await opening.get(profileId);

    const creation = create(profileId).finally(() => opening.delete(profileId));
    opening.set(profileId, creation);
    return await creation;
  }

  async function create(profileId) {
    const paths = await makeStorage(profileId);
    const browser = await openBrowser(profileId);
    const store = makeStore({ runsDir: paths.runsDir });
    const runtime = {
      profileId,
      paths,
      browser,
      store,
      runner: makeRunner({ profileId, browser, store }),
      createdAt: new Date().toISOString()
    };
    runtimes.set(profileId, runtime);
    return runtime;
  }

  /** Boot recovery, per profile: each profile recovers its own interrupted runs. */
  async function initialize(profileIds = []) {
    return await Promise.all(profileIds.map(async (profileId) => {
      try {
        const runtime = await get(profileId);
        await runtime.runner.initializeRunner();
        return { profileId, ok: true };
      } catch (error) {
        return {
          profileId,
          ok: false,
          error: error instanceof Error ? error.message : "Profile runtime failed to start."
        };
      }
    }));
  }

  /** Forget one profile: stop its browser, drop its runtime, touch nothing else. */
  async function release(profileId) {
    runtimes.delete(profileId);
    return await closeBrowser(profileId);
  }

  async function releaseAll() {
    return await Promise.all([...runtimes.keys()].map((profileId) => release(profileId)));
  }

  return {
    get,
    peek: (profileId) => runtimes.get(profileId) ?? null,
    known: () => [...runtimes.keys()],
    initialize,
    release,
    releaseAll
  };
}

const registry = createProfileRuntimeRegistry();

export const getProfileRuntime = (profileId) => registry.get(profileId);
export const peekProfileRuntime = (profileId) => registry.peek(profileId);
export const knownProfileRuntimes = () => registry.known();
export const initializeProfileRuntimes = (profileIds) => registry.initialize(profileIds);
export const releaseProfileRuntime = (profileId) => registry.release(profileId);
export const releaseAllProfileRuntimes = () => registry.releaseAll();
