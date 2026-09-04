# Multi-Profile Implementation Plan

Goal: run campaigns for several LinkedIn profiles from one controller, each
profile with its own Chrome login, its own runner loop, and its own safety
budget — with profiles executing **in parallel** (bounded), not in a single
global queue.

Scope: local controller only. No proxies, no hosted backend, no second machine.

Background research for every decision below — Chrome isolation mechanics, session
cookies, verification handling, concurrency limits, and the ToS picture — is in
[MULTI_PROFILE_RESEARCH.md](./MULTI_PROFILE_RESEARCH.md).

---

## What already works (do not rebuild)

- The UI already holds a list of LinkedIn accounts (`src/lib/storage.ts`,
  `loadLinkedInAccounts`) and `AddLinkedInAccountModal` already adds them.
- Campaigns, leads and workflows are already stored per account —
  `campaign-workspaces-v2` is a map of `accountId -> workspaces`.
- Reply notifications are already keyed per profile
  (`src/lib/notificationStorage.ts`).
- Every run on disk already records `profileId`, and
  `listCampaignRuns(profileId)` / `/api/analytics/campaigns?profileId=` already
  filter by it.
- `App.tsx` already threads an account id through `refreshStatus(accountId)` —
  it is simply dropped before the HTTP call.

## What blocks a second profile

1. **One Chrome, hardcoded.** `server/lib/browserSession.js` holds module-level
   `ownedChromeProcess` / `launchedAt`, a fixed port
   (`CHROME_REMOTE_DEBUGGING_PORT ?? 9223`) and a fixed profile directory
   (`.local/chrome-profile`). Every exported helper — `launch`, `stop`,
   `status`, `listTabs`, `openTab`, `attach`, `navigate`, `evaluate`,
   `closeTab`, `checkLinkedInAuth`, `collectVisibleProfiles`,
   `resolveProfileIdentities` — acts on that single browser.
2. **One run, globally.** `server/lib/runner.js` keeps `activeRunId`,
   `controlWake` and `authCache` as module singletons. `startCampaignRun`
   throws `ACTIVE_RUN_EXISTS` if *any* run is active, and `startNextQueuedRun`
   drains one global queue.
3. **The Chrome API has no profile.** `/api/chrome/start|open|stop|status|
   collect-profiles|resolve-profile-identities` accept no `profileId`.
4. **Safety limits are global and per-run.** `src/lib/safetyStorage.ts` stores
   one settings object for the whole app, and `checkSafetyGate` is fed
   `readAudit(run.id)` — the audit of the *current run only*, so daily caps
   already reset whenever a new run starts. With several profiles this becomes
   an account-safety problem, not just an accounting one.

---

## Progress

**Done — the replication framework (server side, not yet wired to the API):**

- `server/lib/profilePaths.js` — every profile owns
  `.local/profiles/<slug>/{chrome-profile,runs,session.json}`, the same shape the
  single-profile install has today. The first profile ever created **copies** the
  existing `.local/chrome-profile` and its own run history into that layout; the
  legacy folders are left untouched.
- `server/lib/browserSession.js` — the Chrome session is now
  `createBrowserSession({profileId, profileDir, cdpPort})`. Every function body is
  the single-profile implementation unchanged; only the port, directory and owned
  process moved from module scope into the closure. A default instance keeps the
  original entry points behaving exactly as before.
- `server/lib/browserPool.js` — one session per profile, created on demand;
  adopts the port from `DevToolsActivePort` when that Chrome is still alive,
  otherwise the profile's remembered port, otherwise the first free one.
- `server/lib/runner.js` — `createProfileRunner({profileId, browser, store})`.
  The run loop, state machine and safety handling are byte-identical; the active
  run, wake handle and auth cache moved into the closure.
- `server/lib/profileRuntime.js` — storage + browser + run store + runner per
  profile, built on first use, released independently.

**Done — wiring (the app now really runs per profile):**

- Every `/api/chrome/*` and campaign endpoint requires a `profileId` and is served
  by that profile's runtime; a missing id is a 400, never a silent fallback.
  Run-scoped endpoints (stop/pause/resume/retry) find the owning profile from the
  run id. `GET /api/chrome/sessions` reports every profile at once.
- The UI sends the account id with every Chrome and run call, and keeps a Chrome
  status per account instead of one shared session, so each row shows its own
  state and its own profile folder.
- Which profile inherits the original `.local/chrome-profile` login is decided
  from the existing run history and recorded in `.local/profiles/legacy-owner.json`,
  so a newly added account can never open the original account's session.

**Not done yet:** per-profile safety budgets (Phase 4) and the parallel-profile
cap (`MAX_PARALLEL_PROFILES`) — profiles can run at the same time today with no
ceiling.

---

## Phase 0 — Decisions locked before code

1. **Isolation:** one Chrome user-data-dir per profile
   (`.local/chrome-profiles/<profileId>`) with its own remote-debugging port.
   Logins never mix; each profile is logged into once, by hand.
2. **Parallelism:** one runner loop per profile, several profiles at once, but
   never two runs for the same profile, and never more than
   `MAX_PARALLEL_PROFILES` (default 2, env-overridable) profiles executing —
   extra runs stay `queued`.
3. **Ports:** a deterministic base (`9223 + index`) recorded per profile but
   always verified before use — probe `GET /json/version`, and read the actual
   port from the `DevToolsActivePort` file Chrome writes into the profile
   directory, since Chrome silently ignores the flag in several failure modes.
   Port, pid and start time live in `.local/chrome-profiles/<profileId>/session.json`
   so a controller restart can adopt a live browser instead of orphaning it.
4. **Chrome 136+ constraint:** `--remote-debugging-port` is ignored when the
   user-data-dir is the default profile location, so every automated profile
   must live in its own non-default directory and be logged into by hand once.
   Driving the user's everyday Chrome profile is not possible at all.
5. **Every browser-touching endpoint carries a `profileId`.** No implicit
   "current profile" on the server — a missing id is a 400
   (`MISSING_PROFILE`), never a silent fallback to the first account.
6. **Safety budgets are per profile and counted across runs.**
7. Dry run stays the default; the live connection-request gate is unchanged by
   this plan.
8. **No fingerprint spoofing, no stealth patches, headed Chrome only** — a
   plain, coherent, persistent profile per account is both simpler and, per the
   research, less detectable than a spoofed one.
9. **A profile directory is never deleted or recreated in normal operation.**
   Deleting it logs the account out and makes the next sign-in look like a new
   device.

---

## Phase 1 — Browser pool (foundation)

New `server/lib/browserPool.js`; `browserSession.js` keeps the CDP mechanics but
loses its module state.

- `getProfileBrowser(profileId)` -> `{ profileId, profileDir, cdpPort, process }`,
  created on demand and held in a `Map`.
- `launch(profileId, url)` / `stop(profileId)` / `status(profileId)` /
  `statusAll()`; `openTab`, `attach`, `navigate`, `evaluate`, `closeTab`,
  `checkLinkedInAuth` all take the browser handle (or `profileId`) explicitly.
- Port allocation + `session.json` write/read; on startup, probe each recorded
  port and adopt the browser if it answers, otherwise clear the record.
- **Migration:** if `.local/chrome-profile` exists, **copy** it to
  `.local/chrome-profiles/<first account id>` on first boot, verify the session
  still authenticates there, and only then retire the old directory — never move
  first. The `bscookie`/`li_rm` cookies that remember this device's two-step
  verification live in that directory; losing it means logging in and verifying
  again.
- `stopAll()` for controller shutdown.

Done when: the existing single profile behaves exactly as before but through the
pool, `node --check` passes, and Start/Stop/Open/Collect work from the UI.

## Phase 2 — Profile-aware Chrome API

- `/api/chrome/status?profileId=`, and `profileId` required in the body of
  `/api/chrome/start`, `/open`, `/stop`, `/collect-profiles`,
  `/resolve-profile-identities`.
- New `GET /api/chrome/sessions` -> status for every known profile, for the
  accounts table.
- `src/lib/chromeApi.ts`: every function takes `profileId`.
- `App.tsx`: replace the single `status` state with a `Map<accountId, ChromeStatus>`;
  `refreshStatus(accountId)` finally sends the id it already receives. The
  accounts table stops inferring "Connected" from
  `selectedAccount?.id === account.id`.

Done when: two accounts show independent Chrome state, and starting Chrome for
profile B does not disturb profile A's window.

## Phase 3 — One runner per profile

- Replace `activeRunId` with `activeRuns: Map<profileId, { runId, wake, authCache }>`.
- `startCampaignRun` rejects only when *that profile* is busy; the error detail
  names the profile and its active run.
- `getActiveCampaignRun(profileId)` and `/api/campaign-runs/active?profileId=`;
  add `GET /api/campaign-runs/active-all` for a cross-profile view.
- `startNextQueuedRun(profileId)` drains that profile's queue; a global
  admission check enforces `MAX_PARALLEL_PROFILES` (default **2** on a 16 GB
  machine — a headed Chrome with LinkedIn loaded costs roughly 0.4–1.5 GB).
- Profiles get **independent jitter and, by default, different working-hour
  windows**: identical timing across accounts is itself a detection signal,
  regardless of how well the profiles are isolated.
- `scheduleRunLoop` / `runLoop` / stop / pause / resume / retry all key their
  bookkeeping by the run's `profileId`; `checkLinkedInAuth` caching moves into
  the per-profile entry.
- Reply checks (`checkCampaignReplies`) already take a `profileId`; make the
  in-flight promise per profile so one profile's check cannot block another's.
- Boot recovery: `recoverInterruptedRuns()` then resume or queue **per profile**;
  adopt any Chrome whose recorded port still answers rather than relaunching.
- New profile-level state `needs_verification`, separate from the run-level
  `needs_attention`: an `AUTH_CHALLENGE` stops every run for that profile, records
  the challenge URL and kind, and asks the human to finish verification in that
  profile's own Chrome window. The controller never enters a code and never
  stores a 2FA secret. Resume only on a positive authenticated probe, after a
  cooldown and at reduced volume.

Done when: unit tests cover the per-profile mutex, the parallel cap and queue
draining, and two dry runs on two profiles complete concurrently.

## Phase 4 — Per-profile safety budgets

- `safetyStorage`: new key `safety-settings-v2` holding `accountId -> settings`,
  migrating today's single object onto every existing account.
- `runStore`: `readProfileAudit(profileId, { sinceMs })` concatenating the audit
  logs of that profile's runs (bounded window — caps only need ~48 h), memoized
  per profile with invalidation on append.
- `checkSafetyGate` is fed those entries instead of `readAudit(run.id)`. This
  also fixes today's bug where daily caps reset with every new run.
- Working hours/timezone, delays, batch cooldown all read from the profile's own
  settings; staggering windows per profile is then a user choice.

Done when: tests show caps counted across two runs of one profile, and one
profile hitting its cap sleeping without touching the other.

## Phase 5 — UI for several profiles

- Accounts table: per-row Chrome state, active-run badge, per-row Start Chrome /
  Open LinkedIn.
- `AddLinkedInAccountModal`: replace the "Single-profile v1" note — each profile
  now gets its own Chrome folder and needs one manual login.
- A cross-profile Runs view (active, queued, needs-attention) built on
  `/api/campaign-runs/active-all`.
- Safety Limits page becomes per-profile (with a "copy to all profiles" action).
- Honest copy: every profile still runs from this machine and this IP.

## Phase 6 — Verification before any live parallel run

1. Two profiles, dry run, in parallel, end to end; audit logs stay separate.
2. Kill the controller mid-run; both profiles recover, no lead in an unknown state.
3. Force profile A to its daily cap; confirm profile B keeps running.
4. `MAX_PARALLEL_PROFILES=1` still behaves like today's queue.
5. Only then: one live single-lead test per profile, one profile at a time.

---

## Commit sequence

1. `extract per-profile browser pool from browserSession`
2. `migrate existing chrome profile directory into the pool`
3. `require profileId on every chrome endpoint`
4. `track chrome status per account in the UI`
5. `replace the global active run with a per-profile run map` (+ tests)
6. `enforce a maximum number of parallel profiles` (+ tests)
7. `store safety settings per profile and migrate v1 settings`
8. `count safety caps from the profile audit across runs` (+ tests)
9. `show per-profile chrome and run state in the accounts table`
10. `add the cross-profile runs view`

## Risks

- **Same machine, same IP for every profile.** LinkedIn correlates sessions;
  more profiles from one IP is the biggest account risk in this plan, and no
  amount of local pacing removes it. Keep caps conservative and stagger each
  profile's working hours.
- **Two browsers automating at once** is heavier and more visible than one; the
  parallel cap and per-profile pacing exist for that.
- **Losing the existing login** during the profile-directory migration — move,
  verify, and keep a one-time backup copy.
- **Stale ports/pids** after a crash: probe before adopting, clear otherwise.
- **Editing while running:** with several profiles active, the workspace must
  lock workflow and lead edits per profile, not globally.

## Out of scope

Proxy or IP rotation per profile, hosted auth/storage, multi-machine
orchestration, and the live connection-request gate (still Phase 8/11 of the
execution-runner plan — invites stay 0 in reports until that lands).
