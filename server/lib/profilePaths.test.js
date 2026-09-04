import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureProfileStorage,
  isValidProfileId,
  listStoredProfiles,
  migrateLegacyProfileStorage,
  profileSlug,
  profileStoragePaths,
  readProfileSession,
  recordLegacyProfileOwner,
  resolveLegacyProfileOwner,
  writeProfileSession
} from "./profilePaths.js";

// Paths are read lazily, so pointing this at a temp tree keeps every test folder
// out of the real .local directory.
process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR = mkdtempSync(join(tmpdir(), "profile-paths-"));

describe("profileSlug", () => {
  it("keeps readable ids readable", () => {
    expect(profileSlug("restored-sample-linkedin")).toMatch(/^restored-sample-linkedin-[0-9a-f]{8}$/);
  });

  it("replaces characters that are unsafe in a folder name", () => {
    expect(profileSlug("profile-owner@example.com/second")).toMatch(/^sample-user-klouddata.com-second-[0-9a-f]{8}$/);
  });

  it("keeps two ids apart when they sanitize to the same text", () => {
    expect(profileSlug("Profile One")).not.toBe(profileSlug("profile-one"));
  });

  it("rejects an empty id", () => {
    expect(isValidProfileId("")).toBe(false);
    expect(() => profileSlug("")).toThrow();
  });
});

describe("profileStoragePaths", () => {
  it("gives every profile the same folder shape under its own root", () => {
    const first = profileStoragePaths("profile-a");
    const second = profileStoragePaths("profile-b");
    expect(first.chromeProfileDir.startsWith(first.root)).toBe(true);
    expect(first.runsDir.startsWith(first.root)).toBe(true);
    expect(first.root).not.toBe(second.root);
    for (const key of ["chromeProfileDir", "runsDir", "sessionFile", "profileFile"]) {
      expect(first[key]).not.toBe(second[key]);
    }
  });
});

describe("storage lifecycle", () => {
  it("creates, records and reads back an isolated profile folder", async () => {
    const profileId = `test-${Math.random().toString(36).slice(2)}`;
    const paths = await ensureProfileStorage(profileId);
    const stored = await listStoredProfiles();
    expect(stored.some((entry) => entry.profileId === profileId)).toBe(true);
    expect(JSON.parse(await readFile(paths.profileFile, "utf8")).profileId).toBe(profileId);

    expect(await readProfileSession(profileId)).toBeNull();
    await writeProfileSession(profileId, { cdpPort: 9224, pid: 42, startedAt: "2026-09-03T00:00:00.000Z" });
    expect((await readProfileSession(profileId)).cdpPort).toBe(9224);
  });
});

describe("migrateLegacyProfileStorage", () => {
  async function legacyFixture(profileId) {
    const base = await mkdtemp(join(tmpdir(), "legacy-"));
    const chrome = join(base, "chrome-profile");
    await mkdir(join(chrome, "Default"), { recursive: true });
    await writeFile(join(chrome, "Default", "Cookies"), "cookie-jar", "utf8");
    const runs = join(base, "runs");
    await mkdir(join(runs, "run-mine"), { recursive: true });
    await writeFile(join(runs, "run-mine", "state.json"), JSON.stringify({ id: "run-mine", profileId }), "utf8");
    await writeFile(join(runs, "run-mine", "audit.log"), "{}\n", "utf8");
    await mkdir(join(runs, "run-theirs"), { recursive: true });
    await writeFile(join(runs, "run-theirs", "state.json"), JSON.stringify({ id: "run-theirs", profileId: "someone-else" }), "utf8");
    return { legacyChromeProfileDir: chrome, legacyRunsDir: runs };
  }

  it("copies the existing chrome profile and only that profile's runs", async () => {
    const profileId = `migrate-${Math.random().toString(36).slice(2)}`;
    const fixture = await legacyFixture(profileId);

    const result = await migrateLegacyProfileStorage(profileId, fixture);
    expect(result.chromeProfileCopied).toBe(true);
    expect(result.runsCopied).toBe(1);

    const paths = profileStoragePaths(profileId);
    expect(await readFile(join(paths.chromeProfileDir, "Default", "Cookies"), "utf8")).toBe("cookie-jar");
    expect(await readFile(join(paths.runsDir, "run-mine", "state.json"), "utf8")).toContain("run-mine");
    await expect(readFile(join(paths.runsDir, "run-theirs", "state.json"), "utf8")).rejects.toThrow();
  });

  it("leaves the legacy folders in place", async () => {
    const profileId = `migrate-${Math.random().toString(36).slice(2)}`;
    const fixture = await legacyFixture(profileId);
    await migrateLegacyProfileStorage(profileId, fixture);
    expect(await readFile(join(fixture.legacyChromeProfileDir, "Default", "Cookies"), "utf8")).toBe("cookie-jar");
  });

  it("never overwrites a profile that already has a chrome profile", async () => {
    const profileId = `migrate-${Math.random().toString(36).slice(2)}`;
    const paths = await ensureProfileStorage(profileId);
    await mkdir(join(paths.chromeProfileDir, "Default"), { recursive: true });
    await writeFile(join(paths.chromeProfileDir, "Default", "Cookies"), "existing-session", "utf8");

    const result = await migrateLegacyProfileStorage(profileId, await legacyFixture(profileId));
    expect(result.chromeProfileCopied).toBe(false);
    expect(await readFile(join(paths.chromeProfileDir, "Default", "Cookies"), "utf8")).toBe("existing-session");
  });
});

describe("resolveLegacyProfileOwner", () => {
  it("infers the owner from the run history already on disk", async () => {
    process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR = mkdtempSync(join(tmpdir(), "legacy-owner-"));
    const runs = join(tmpdir(), `legacy-runs-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(runs, "old"), { recursive: true });
    await writeFile(join(runs, "old", "state.json"), JSON.stringify({
      id: "old", profileId: "the-original-account", updatedAt: "2026-08-01T00:00:00.000Z"
    }), "utf8");
    await mkdir(join(runs, "newer"), { recursive: true });
    await writeFile(join(runs, "newer", "state.json"), JSON.stringify({
      id: "newer", profileId: "the-original-account", updatedAt: "2026-08-22T00:00:00.000Z"
    }), "utf8");

    const owner = await resolveLegacyProfileOwner({ legacyRunsDir: runs });
    expect(owner).toBe("the-original-account");
    // recorded, so a later call never re-infers from a different runs folder
    expect(await resolveLegacyProfileOwner({ legacyRunsDir: join(tmpdir(), "does-not-exist") }))
      .toBe("the-original-account");
  });

  it("returns null when no run history says who the login belongs to", async () => {
    process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR = mkdtempSync(join(tmpdir(), "legacy-owner-empty-"));
    expect(await resolveLegacyProfileOwner({ legacyRunsDir: join(tmpdir(), "missing") })).toBeNull();
  });

  it("keeps a recorded claim", async () => {
    process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR = mkdtempSync(join(tmpdir(), "legacy-owner-claim-"));
    await recordLegacyProfileOwner("claimed-account");
    expect(await resolveLegacyProfileOwner()).toBe("claimed-account");
  });
});
