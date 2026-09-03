import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every LinkedIn profile owns one folder with exactly the same shape:
 *
 *   .local/profiles/<slug>/
 *     chrome-profile/   Chrome --user-data-dir: the login, cookies and the
 *                       "this device passed two-step verification" cookie
 *     runs/<runId>/     state.json + audit.log, identical to the single-profile layout
 *     session.json      {cdpPort, pid, startedAt} for the browser serving this profile
 *
 * Nothing is shared between two profile folders, so adding, pausing or deleting
 * one profile cannot touch another.
 */

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Read lazily so tests (and a relocated install) can point the whole tree elsewhere. */
export function localDir() {
  return resolve(process.env.LINKEDIN_AUTOMATOR_LOCAL_DIR ?? join(rootDir, ".local"));
}

export function profilesRootDir() {
  return join(localDir(), "profiles");
}

/** Where the single-profile version of this app kept its state. */
export function legacyChromeProfileDir() {
  return resolve(process.env.LINKEDIN_AUTOMATOR_CHROME_PROFILE ?? join(localDir(), "chrome-profile"));
}

export function legacyRunsDir() {
  return join(localDir(), "runs");
}

export function isValidProfileId(profileId) {
  return typeof profileId === "string" && profileId.trim().length > 0 && profileId.length <= 200;
}

/**
 * Folder name for a profile id. Ids are user-facing strings, so unsafe characters
 * are replaced and a short digest of the original id keeps two ids that sanitize
 * to the same text apart (Windows folder names are case-insensitive).
 */
export function profileSlug(profileId) {
  if (!isValidProfileId(profileId)) throw new Error("A profile id is required.");
  const trimmed = profileId.trim();
  const sanitized = trimmed.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const digest = createHash("sha1").update(trimmed).digest("hex").slice(0, 8);
  return sanitized.length > 0 ? `${sanitized}-${digest}` : digest;
}

export function profileStoragePaths(profileId) {
  const slug = profileSlug(profileId);
  const root = join(profilesRootDir(), slug);
  return {
    profileId,
    slug,
    root,
    chromeProfileDir: join(root, "chrome-profile"),
    runsDir: join(root, "runs"),
    sessionFile: join(root, "session.json"),
    profileFile: join(root, "profile.json")
  };
}

export async function ensureProfileStorage(profileId) {
  const paths = profileStoragePaths(profileId);
  await mkdir(paths.chromeProfileDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });
  if (!(await exists(paths.profileFile))) {
    await writeFile(
      paths.profileFile,
      `${JSON.stringify({ profileId, slug: paths.slug, createdAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8"
    );
  }
  return paths;
}

/** Profile folders present on disk, as {slug, profileId}. */
export async function listStoredProfiles() {
  const rootPath = profilesRootDir();
  if (!(await exists(rootPath))) return [];
  const entries = await readdir(rootPath, { withFileTypes: true });
  const stored = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profileFile = join(rootPath, entry.name, "profile.json");
    let profileId = null;
    try {
      profileId = JSON.parse(await readFile(profileFile, "utf8")).profileId ?? null;
    } catch {
      profileId = null;
    }
    stored.push({ slug: entry.name, profileId });
  }
  return stored;
}

export async function readProfileSession(profileId) {
  try {
    return JSON.parse(await readFile(profileStoragePaths(profileId).sessionFile, "utf8"));
  } catch {
    return null;
  }
}

export async function writeProfileSession(profileId, session) {
  const paths = await ensureProfileStorage(profileId);
  await writeFile(paths.sessionFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  return session;
}

/**
 * Adopt the single-profile installation for one profile, by COPYING the existing
 * Chrome profile directory and that profile's run history into the new layout.
 * The legacy folders are left untouched: if anything is wrong the old setup is
 * still there, and a Chrome profile directory is never something to move first
 * and verify later — losing it means logging in and verifying the device again.
 */
export async function migrateLegacyProfileStorage(profileId, options = {}) {
  const chromeSource = options.legacyChromeProfileDir ?? legacyChromeProfileDir();
  const runsSource = options.legacyRunsDir ?? legacyRunsDir();
  const paths = await ensureProfileStorage(profileId);
  const result = { profileId, slug: paths.slug, chromeProfileCopied: false, runsCopied: 0 };

  if (!(await isEmptyDir(paths.chromeProfileDir))) return result;

  if (await exists(join(chromeSource, "Default"))) {
    await cp(chromeSource, paths.chromeProfileDir, { recursive: true, force: true });
    result.chromeProfileCopied = true;
  }

  if (await exists(runsSource)) {
    for (const entry of await readdir(runsSource, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const statePath = join(runsSource, entry.name, "state.json");
      let run = null;
      try {
        run = JSON.parse(await readFile(statePath, "utf8"));
      } catch {
        continue;
      }
      if (run?.profileId !== profileId) continue;
      const target = join(paths.runsDir, entry.name);
      if (await exists(target)) continue;
      await cp(join(runsSource, entry.name), target, { recursive: true, force: true });
      result.runsCopied += 1;
    }
  }

  return result;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isEmptyDir(path) {
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return true;
  }
}
