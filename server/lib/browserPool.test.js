import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createBrowserPool } from "./browserPool.js";
import { profileStoragePaths } from "./profilePaths.js";

process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR = mkdtempSync(join(tmpdir(), "browser-pool-"));

function fakeSessionFactory(created) {
  return ({ profileId, profileDir, cdpPort }) => {
    const session = {
      profileId,
      profileDir,
      cdpPort,
      stopped: false,
      launch: async () => ({ ok: true, connected: true, profileId }),
      stop: async () => {
        session.stopped = true;
        return { ok: true, stopped: true };
      },
      status: async () => ({ ok: true, connected: !session.stopped, cdpPort, tabs: [] })
    };
    created.push(session);
    return session;
  };
}

function poolWith(options = {}) {
  const created = [];
  const pool = createBrowserPool({
    createBrowserSession: fakeSessionFactory(created),
    isPortAlive: options.isPortAlive ?? (async () => false),
    readDevToolsActivePort: options.readDevToolsActivePort ?? (async () => null),
    basePort: options.basePort ?? 9223
  });
  return { pool, created };
}

describe("browser pool", () => {
  let counter = 0;
  const nextProfile = () => `pool-profile-${(counter += 1)}-${Math.random().toString(36).slice(2)}`;

  beforeEach(() => {
    counter += 1;
  });

  it("creates one session per profile and reuses it", async () => {
    const { pool, created } = poolWith();
    const profileId = nextProfile();
    const first = await pool.get(profileId);
    const second = await pool.get(profileId);
    expect(first).toBe(second);
    expect(created).toHaveLength(1);
  });

  it("gives each profile its own directory and port", async () => {
    const { pool } = poolWith();
    const a = await pool.get(nextProfile());
    const b = await pool.get(nextProfile());
    expect(a.profileDir).not.toBe(b.profileDir);
    expect(a.cdpPort).not.toBe(b.cdpPort);
    expect(a.profileDir).toBe(profileStoragePaths(a.profileId).chromeProfileDir);
  });

  it("does not create a second session while the first is still opening", async () => {
    const { pool, created } = poolWith();
    const profileId = nextProfile();
    const [first, second] = await Promise.all([pool.get(profileId), pool.get(profileId)]);
    expect(first).toBe(second);
    expect(created).toHaveLength(1);
  });

  it("skips ports that another Chrome already answers on", async () => {
    const busy = new Set([9223, 9224]);
    const { pool } = poolWith({ isPortAlive: async (port) => busy.has(port) });
    const browser = await pool.get(nextProfile());
    expect(browser.cdpPort).toBe(9225);
  });

  it("adopts the port Chrome recorded for that profile when it is alive", async () => {
    const { pool } = poolWith({
      readDevToolsActivePort: async () => 9310,
      isPortAlive: async (port) => port === 9310
    });
    const browser = await pool.get(nextProfile());
    expect(browser.cdpPort).toBe(9310);
  });

  it("stopping or releasing one profile leaves the others running", async () => {
    const { pool } = poolWith();
    const stayingId = nextProfile();
    const goingId = nextProfile();
    const staying = await pool.get(stayingId);
    const going = await pool.get(goingId);

    await pool.release(goingId);

    expect(going.stopped).toBe(true);
    expect(staying.stopped).toBe(false);
    expect(pool.known()).toEqual([stayingId]);
    expect((await pool.status(stayingId)).connected).toBe(true);
  });

  it("reports a status per profile without failing the whole batch", async () => {
    const { pool } = poolWith();
    const okId = nextProfile();
    await pool.get(okId);
    const broken = await pool.get(nextProfile());
    broken.status = async () => {
      throw new Error("Chrome is gone");
    };

    const statuses = await pool.statusAll();
    expect(statuses).toHaveLength(2);
    expect(statuses.find((entry) => entry.profileId === okId).connected).toBe(true);
    expect(statuses.find((entry) => entry.profileId === broken.profileId).error).toBe("Chrome is gone");
  });

  it("only the first profile ever created adopts the single-profile chrome directory", async () => {
    const legacy = mkdtempSync(join(tmpdir(), "legacy-chrome-"));
    await mkdir(join(legacy, "Default"), { recursive: true });
    await writeFile(join(legacy, "Default", "Cookies"), "session", "utf8");
    process.env.LINKEDIN_AUTOMATOR_CHROME_PROFILE = legacy;
    process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR = mkdtempSync(join(tmpdir(), "browser-pool-first-"));

    const { pool } = poolWith();
    const first = await pool.get(nextProfile());
    const second = await pool.get(nextProfile());

    expect(first.adoptedLegacyProfile).toBe(true);
    expect(second.adoptedLegacyProfile).toBe(false);
    delete process.env.LINKEDIN_AUTOMATOR_CHROME_PROFILE;
  });
});

describe("legacy chrome directory ownership", () => {
  it("only the recorded owner inherits the existing login", async () => {
    const legacy = mkdtempSync(join(tmpdir(), "legacy-chrome-owner-"));
    await mkdir(join(legacy, "Default"), { recursive: true });
    await writeFile(join(legacy, "Default", "Cookies"), "session", "utf8");
    process.env.LINKEDIN_AUTOMATOR_CHROME_PROFILE = legacy;
    process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR = mkdtempSync(join(tmpdir(), "browser-pool-owner-"));

    const pool = createBrowserPool({
      createBrowserSession: ({ profileId, profileDir, cdpPort }) => ({ profileId, profileDir, cdpPort }),
      isPortAlive: async () => false,
      readDevToolsActivePort: async () => null,
      resolveLegacyProfileOwner: async () => "the-original-account",
      recordLegacyProfileOwner: async () => null
    });

    const newAccount = await pool.get("a-brand-new-account");
    const original = await pool.get("the-original-account");

    expect(newAccount.adoptedLegacyProfile).toBe(false);
    expect(original.adoptedLegacyProfile).toBe(true);
    delete process.env.LINKEDIN_AUTOMATOR_CHROME_PROFILE;
  });
});
