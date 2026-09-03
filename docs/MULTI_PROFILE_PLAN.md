# Multi-Profile Implementation Plan

Goal: run campaigns for several LinkedIn profiles from one controller, each
profile with its own Chrome login, its own runner loop, and its own safety
budget — with profiles executing **in parallel** (bounded), not in a single
global queue.

Scope: local controller only. No proxies, no hosted backend, no second machine.

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

## Phase 0 — Decisions locked before code

1. **Isolation:** one Chrome user-data-dir per profile
   (`.local/chrome-profiles/<profileId>`) with its own remote-debugging port.
   Logins never mix; each profile is logged into once, by hand.
2. **Parallelism:** one runner loop per profile, several profiles at once, but
   never two runs for the same profile, and never more than
   `MAX_PARALLEL_PROFILES` (default 3, env-overridable) profiles executing —
   extra runs stay `queued`.
3. **Ports:** allocated dynamically from 9223 upward by probing for a free
   port; the chosen port, pid and start time are written to
   `.local/chrome-profiles/<profileId>/session.json` so a controller restart can
   re-attach instead of orphaning a browser.
4. **Every browser-touching endpoint carries a `profileId`.** No implicit
   "current profile" on the server — a missing id is a 400
   (`MISSING_PROFILE`), never a silent fallback to the first account.
5. **Safety budgets are per profile and counted across runs.**
6. Dry run stays the default; the live connection-request gate is unchanged by
   this plan.

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
- **Migration:** if `.local/chrome-profile` exists, move it to
  `.local/chrome-profiles/<first account id>` on first boot (and log it), so the
  LinkedIn session already logged in today is not lost.
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
  admission check enforces `MAX_PARALLEL_PROFILES`.
- `scheduleRunLoop` / `runLoop` / stop / pause / resume / retry all key their
  bookkeeping by the run's `profileId`; `checkLinkedInAuth` caching moves into
  the per-profile entry.
- Reply checks (`checkCampaignReplies`) already take a `profileId`; make the
  in-flight promise per profile so one profile's check cannot block another's.
- Boot recovery: `recoverInterruptedRuns()` then resume or queue **per profile**.

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
