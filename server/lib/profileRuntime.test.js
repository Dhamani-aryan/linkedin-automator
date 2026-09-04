import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProfileRuntimeRegistry } from "./profileRuntime.js";

process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR = mkdtempSync(join(tmpdir(), "profile-runtime-"));

function registryWith() {
  const released = [];
  const browsers = new Map();
  const runners = [];
  const registry = createProfileRuntimeRegistry({
    getProfileBrowser: async (profileId) => {
      const browser = browsers.get(profileId) ?? { profileId, cdpPort: 9223 + browsers.size };
      browsers.set(profileId, browser);
      return browser;
    },
    releaseProfileBrowser: async (profileId) => {
      released.push(profileId);
      return { ok: true, stopped: true };
    },
    createProfileRunner: ({ profileId, browser, store }) => {
      const runner = {
        profileId,
        browser,
        store,
        initialized: 0,
        initializeRunner: async () => {
          runner.initialized += 1;
        }
      };
      runners.push(runner);
      return runner;
    }
  });
  return { registry, released, runners };
}

describe("profile runtime registry", () => {
  let counter = 0;
  const nextProfile = () => `runtime-${(counter += 1)}-${Math.random().toString(36).slice(2)}`;

  it("builds one runtime per profile and reuses it", async () => {
    const { registry, runners } = registryWith();
    const profileId = nextProfile();
    expect(await registry.get(profileId)).toBe(await registry.get(profileId));
    expect(runners).toHaveLength(1);
  });

  it("does not build two runtimes for concurrent callers", async () => {
    const { registry, runners } = registryWith();
    const profileId = nextProfile();
    const [first, second] = await Promise.all([registry.get(profileId), registry.get(profileId)]);
    expect(first).toBe(second);
    expect(runners).toHaveLength(1);
  });

  it("gives each profile its own runs folder, browser and runner", async () => {
    const { registry } = registryWith();
    const first = await registry.get(nextProfile());
    const second = await registry.get(nextProfile());

    expect(first.store.runsDir).not.toBe(second.store.runsDir);
    expect(first.paths.chromeProfileDir).not.toBe(second.paths.chromeProfileDir);
    expect(first.runner).not.toBe(second.runner);
    expect(first.runner.store.runsDir).toBe(first.store.runsDir);
    expect(first.runner.browser).toBe(first.browser);
  });

  it("recovers a profile as soon as its runtime is built", async () => {
    const { registry } = registryWith();
    const profileId = nextProfile();
    const runtime = await registry.get(profileId);
    expect(runtime.runner.initialized).toBe(1);
    expect(runtime.recoveryError).toBeNull();

    // asking again must not recover twice
    await registry.initialize([profileId]);
    expect(runtime.runner.initialized).toBe(1);
  });

  it("keeps a failed recovery on the profile that failed", async () => {
    const { registry, runners } = registryWith();
    const healthy = nextProfile();
    const broken = nextProfile();
    await registry.get(healthy);
    runners[0].profileId; // healthy runtime built first

    const failing = createProfileRuntimeRegistry({
      getProfileBrowser: async (profileId) => ({ profileId }),
      releaseProfileBrowser: async () => ({ ok: true }),
      createProfileRunner: () => ({
        initializeRunner: async () => {
          throw new Error("runs folder unreadable");
        }
      })
    });

    const [result] = await failing.initialize([broken]);
    expect(result).toEqual({ profileId: broken, ok: false, error: "runs folder unreadable" });
    expect((await registry.get(healthy)).recoveryError).toBeNull();
  });

  it("releasing one profile leaves the others in place", async () => {
    const { registry, released } = registryWith();
    const stayingId = nextProfile();
    const goingId = nextProfile();
    const staying = await registry.get(stayingId);
    await registry.get(goingId);

    await registry.release(goingId);

    expect(released).toEqual([goingId]);
    expect(registry.known()).toEqual([stayingId]);
    expect(await registry.get(stayingId)).toBe(staying);
  });

  it("refuses a missing profile id instead of falling back to a default", async () => {
    const { registry } = registryWith();
    await expect(registry.get("")).rejects.toThrow(/profile id is required/i);
  });
});
