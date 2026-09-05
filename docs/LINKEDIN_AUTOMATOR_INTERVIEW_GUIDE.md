# LinkedIn Automator: Interview Study Guide

> Codebase reviewed on September 5, 2026.
>
> This document describes the implementation that exists in the repository today. It deliberately separates completed behavior from planned behavior so it can be used safely in an interview.

## 1. The 30-second explanation

LinkedIn Automator is a local-first campaign orchestration application built with React, TypeScript, Node.js, and the Chrome DevTools Protocol (CDP). A user can attach isolated LinkedIn browser profiles, build campaigns from leads and message actions, preview them in dry-run mode, execute approved live messages sequentially, pause or resume durable runs, detect replies, and inspect campaign outcomes and reports.

The interesting engineering problem is not clicking a button. It is making browser automation controlled and recoverable: every run has a frozen input snapshot, each lead moves through an explicit state machine, deadlines are stored as absolute timestamps, actions are audited, ambiguous sends are never blindly retried, and each LinkedIn account has isolated Chrome and run storage.

## 2. What problem the project solves

A basic automation script normally assumes that:

- the webpage has not changed;
- the browser remains open;
- every click succeeded;
- rerunning after a failure is harmless;
- all accounts can share one browser session;
- delays can live only in memory.

Those assumptions are unsafe for a messaging workflow. A duplicate send, a message sent to the wrong conversation, or one account inheriting another account's cookies is much worse than a failed run.

This project treats outreach as a stateful distributed workflow between three changing systems:

1. The React editor, where the user changes campaign definitions.
2. The local Node controller, which owns execution and durable run state.
3. LinkedIn in a real Chrome window, whose DOM and authentication state are external and can change.

The design goal is **fail closed when the outcome is uncertain**.

## 3. Current feature boundary

### Implemented

- Multiple logical LinkedIn accounts in the UI.
- A separate Chrome user-data directory, CDP port, browser session, run store, and runner for each account.
- Persistent local LinkedIn login cookies through Chrome profile folders.
- Campaign creation, filtering, search, selection, bulk start, pause, stop, archive, and delete.
- Workflow blocks for connection requests, waiting for acceptance, messages, and reply checks.
- Lead import from profile URLs, pasted lists, CSV/TXT input, and visible LinkedIn or Sales Navigator pages.
- Profile enrichment from the rendered LinkedIn page.
- Message templates with variables such as `{firstName}` and `{company}`.
- Dry-run validation.
- Explicitly confirmed, message-only live runs.
- Sequential lead processing within a profile.
- Pause, resume, stop, retry rules, durable deadlines, and restart recovery.
- Working-hour, rolling daily-cap, inter-action-delay, and batch-cooldown gates.
- Reply checks, per-profile unread notifications, outcome drill-down lists, and reports.
- CRM-oriented prospect CSV export and report CSV export.

### Intentionally not implemented or not production-ready

- Live connection-request sending is blocked by a controlled verification gate. Connection requests currently execute only in dry-run mode.
- There is no hosted backend, cloud scheduler, database, user authentication service, encryption layer, proxy rotation, or fleet management.
- The local "company sign-in" is UI state in `localStorage`; it is not secure authentication.
- Campaign definitions are stored in browser `localStorage`, not on the Node server.
- Safety settings are currently global to the local frontend, although each run receives a frozen copy.
- There is one active run at a time **per LinkedIn profile**, but no global cap across all profiles. Different profiles can run concurrently in separate Chrome sessions.
- LinkedIn DOM automation can break when LinkedIn changes its layout, labels, experiments, or messaging markup.
- The system does not use LinkedIn's private API. It observes and operates the visible website through CDP.
- LinkedIn restricts scraping and automation in its terms. This is a local learning prototype with human approval and conservative failure behavior, not a claim of platform approval.

## 4. Technology stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| UI | React 18 + TypeScript | Profiles, campaigns, workflow editor, leads, run controls, reports |
| Build tooling | Vite 5 | Development server, API proxy, production bundle |
| Local controller | Node.js ES modules | HTTP API, browser lifecycle, runners, persistence |
| Browser control | Chrome DevTools Protocol | Navigation, DOM evaluation, text insertion, coordinate clicks |
| Storage | `localStorage` + JSON/NDJSON files | Editable UI data plus durable execution state |
| Icons/theme | Lucide + Radix Themes | UI primitives and visual language |
| Tests | Vitest | Server state logic, storage, analytics, CSV, routing, browser pool |

Development uses two loopback services:

```text
React/Vite:       http://127.0.0.1:5173
Node controller:  http://127.0.0.1:4287
Chrome CDP:       starts at port 9223 and allocates a usable per-profile port
```

`npm run dev` starts Vite and a watched Node controller through the custom plugin in `vite.config.ts`. Vite proxies `/api` to the controller.

## 5. High-level architecture

```text
+---------------------------------------------------------------------+
| React application                                                   |
|                                                                     |
| Profile manager -> Campaign list -> Campaign workspace -> Reports  |
|       +---------- localStorage definitions and preferences          |
+--------------------------------+------------------------------------+
                                 | HTTP JSON on 127.0.0.1
+--------------------------------v------------------------------------+
| Node controller (`server/index.js`)                                |
|                                                                     |
| Profile runtime registry                                            |
|   profile A -> browser A + runner A + run store A                   |
|   profile B -> browser B + runner B + run store B                   |
|                                                                     |
| Run state machine -> safety policy -> action executor -> audit log  |
+--------------------------------+------------------------------------+
                                 | CDP WebSocket
+--------------------------------v------------------------------------+
| Visible Chrome windows                                              |
|   isolated profile directory + cookies + tabs + LinkedIn login     |
+---------------------------------------------------------------------+
```

The React application is a control plane. It edits definitions and displays state. The Node controller is the execution plane. Once a run begins, React does not drive each click and is not the source of truth for run progress.

## 6. Repository map

### Frontend

- `src/App.tsx`: top-level account state, route selection, and per-account Chrome status.
- `src/components/ProfileCampaigns.tsx`: campaign table, outcome counters, filters, search, and bulk controls.
- `src/components/AccountWorkspace.tsx`: workflow editor, lead management, start confirmation, run controls, browser, and safety tabs.
- `src/components/WorkflowActionPicker.tsx`: sidebar of addable action blocks.
- `src/components/ReplyNotificationButton.tsx`: polling, unread count, notification panel, and reply navigation.
- `src/components/CampaignReports.tsx`: report filters, outcome toggles, totals, table, and CSV download.
- `src/components/DailyActivityChart.tsx`: scalable SVG bar chart and hover tooltip.
- `src/lib/chromeApi.ts`: typed client for profile-aware Chrome endpoints.
- `src/lib/runnerApi.ts`: typed client for run, reply, and analytics endpoints.
- `src/lib/campaignStorage.ts`: campaign definitions and legacy migration in `localStorage`.
- `src/lib/campaignMetrics.ts`: derived campaign outcomes and drill-down records.
- `src/lib/prospectCsv.ts`: CRM export schema, CSV escaping, and location splitting.
- `src/lib/workflow.ts`: action factories, default templates, and automatic guards.
- `src/types.ts`: shared frontend domain types.

### Controller

- `server/index.js`: HTTP routing and request validation.
- `server/lib/profilePaths.js`: profile IDs, safe storage slugs, and legacy storage migration.
- `server/lib/browserPool.js`: one browser session and port per profile.
- `server/lib/profileRuntime.js`: one browser, run store, and runner bundle per profile.
- `server/lib/browserSession.js`: Chrome process management and reusable CDP primitives.
- `server/lib/runModel.js`: validation, run creation, transitions, scheduling, and summaries.
- `server/lib/runStore.js`: atomic JSON state and append-only NDJSON audit logs.
- `server/lib/runner.js`: cooperative run loop and lifecycle commands.
- `server/lib/safetyPolicy.js`: pure working-window, cap, cooldown, and random-delay rules.
- `server/lib/actions/message.js`: profile-page message execution and reply observation.
- `server/lib/actions/connectionRequest.js`: connection-state classification and dry-run execution.
- `server/lib/analytics.js`: live audit-event aggregation.

## 7. Data model

### Profile

A frontend `LinkedInAccount` is a local logical account with an ID, email, display name, state, role, and archive flag. The ID is sent with every browser and run request. The controller never silently falls back to another account when a profile ID is missing.

### Campaign definition

A `CampaignWorkspaceState` contains:

- campaign metadata and presentation counters;
- ordered workflow actions;
- lead records;
- lead-source records.

This is editable state stored in `localStorage`. It is not itself an execution log.

### Frozen run snapshot

Starting a campaign sends a snapshot containing:

- `profileId`;
- campaign ID and name;
- ordered actions and templates;
- included leads;
- safety settings;
- execution mode;
- explicit live confirmation data when applicable.

The snapshot is copied into the run. Later edits to the campaign do not silently alter an already running campaign. Resume is the deliberate exception for pending action delays: the UI can submit the current actions, and the controller records any recalculated deadlines in the audit log.

### Campaign run

A run stores its ID, profile, mode, state, timestamps, control flags, sleep reason/deadline, snapshot, and lead runs.

Run states are:

```text
validating -> queued -> running <-> sleeping
                         |  |
                         |  +-> paused -> running
                         +----> stopping -> stopped
                         +----> needs_attention
                         +----> failed
                         +----> completed
```

### Lead run

Each lead has an independent cursor through the workflow and these states:

```text
queued -> running -> waiting_acceptance -> queued
             |
             +-> waiting_delay -> queued
             +-> replied
             +-> completed
             +-> failed
             +-> needs_review
             +-> stopped
```

It also stores:

- `actionCursor`: index of the next executable action;
- `attempts`: started/completed timestamps, outcome, error, and details;
- `delaysSatisfiedActionIds`: prevents the same workflow delay from being reapplied;
- `nextEligibleAt`: absolute time at which the lead can run again;
- `acceptedAt`: anchor for a post-acceptance message delay;
- `conversationSeenAt`: reply-observation timestamp;
- `lastErrorCode`.

All legal lead changes go through `transition()` in `runModel.js`. Illegal transitions throw instead of corrupting state.

## 8. Campaign workflow semantics

The workflow editor exposes two manual action types:

1. **Connection request**: adds an automatic `wait_for_acceptance` guard immediately after it.
2. **Message**: adds an automatic `reply_check` guard immediately after it.

Removing a manual action also removes its attached automatic guard. Run validation rejects orphaned or incorrectly ordered guards.

Automatic guards are represented in the saved workflow because they explain the product behavior, but the runner's `actionCursor` skips non-executable actions. Acceptance and reply behavior are implemented as state/deferred checks around the executable actions.

Supported template variables include:

```text
{firstName} {lastName} {fullName} {company} {position}
{location} {industry} {publicId} {memberId} {mutualTotal}
{mutualFirstFullName} {mutualSecondFullName}
```

Unknown variables fail validation. Missing known values render as empty strings. For live messages, identity is refreshed from the visible profile before rendering, so `{firstName}` comes from the profile heading rather than from the profile URL slug.

## 9. Starting a run

The workspace opens a confirmation dialog with two modes.

### Dry run

Dry run is the default. It navigates to profiles, validates page eligibility, resolves templates, and records what would happen, but does not click Send. It is useful for testing sequencing, variables, lead URLs, login state, and DOM recognition.

A dry-run outcome is `dry_run_ok`; it must never be described as a real delivered message.

### Live run

Live mode requires:

- at least one included lead;
- at least one message action;
- a message-only executable workflow;
- typed/explicit scope confirmation covering the frozen lead and action IDs.

The controller validates the same scope. It also searches previous runs from the same campaign for already-sent lead/action pairs and blocks duplicate live delivery.

Within one profile, only one run is active. Batch-started campaigns are queued and run sequentially. A different profile owns a different runner, so profiles can operate independently.

## 10. The runner loop

The runner is a cooperative, persistent loop:

```text
load run
  -> honor stop
  -> wait while paused
  -> complete if every lead is terminal
  -> verify LinkedIn authentication
  -> reconcile follow-up deadlines
  -> choose an eligible lead
  -> sleep if no lead is due
  -> reconcile acceptance if required
  -> enforce safety gates
  -> execute one action
  -> persist result and audit event
  -> wait a randomized inter-action delay
  -> repeat
```

The runner opens one lead profile at a time within a run. A successful action uses a temporary tab that is closed afterward. If an action needs review, the profile tab is intentionally left open to help a human inspect the exact state.

Sleeps are divided into slices of at most five seconds. This allows pause and stop requests to wake the loop promptly rather than waiting for a long timeout to finish.

Authentication is probed and cached for approximately ten minutes. Login walls and security challenges become explicit error states rather than normal page failures.

## 11. Exact live-message algorithm

This is the most important browser automation path.

1. Open or reuse the lead's LinkedIn profile page.
2. Classify the page as profile, login wall, challenge, or unknown layout.
3. Wait for hydration and locate the visible **Message** control in the main profile action area. The executor does not use the feed's default messaging button as its starting point.
4. Read the visible profile heading (`h1`) and derive display name, first name, and last name. The page title is only a fallback.
5. Merge the refreshed identity into the lead and render the message template.
6. Scroll to the top, wait six seconds for the profile controls to settle, and try the profile Message control up to two times.
7. Wait for the composer belonging to the expected recipient.
8. If the composer contains a different existing draft, leave it untouched and mark the action `needs_review`.
9. Focus the editor and insert the rendered text through CDP's text insertion primitive.
10. Read the composer back and require an exact text match, preserving spaces and line breaks. If it differs, do not click Send.
11. Wait until the Send control is available.
12. Recheck stop and pause flags immediately before the irreversible click.
13. Click the measured center point through CDP.
14. Wait up to twelve seconds for authoritative confirmation that the expected outgoing message appeared and the matching-message count increased.
15. Record `message_sent`, `sentAt`, confirmation evidence, and an external message ID when available.

The two crucial ambiguity rules are:

- **Text mismatch before click:** Send is not clicked; a narrowly safe retry may be allowed.
- **No confirmation after click:** the lead becomes `needs_review`, the run becomes `needs_attention`, and automatic retry is forbidden because the message may actually have been delivered.

## 12. Why coordinate clicks are used

The DOM evaluator finds a semantic target using visible text, ARIA labels, recipient identity, viewport position, and visibility. It then returns a point, and CDP dispatches the click at that point.

This mirrors a real user's interaction while keeping DOM inspection separate from the input event. It also avoids depending entirely on unstable generated CSS class names. The tradeoff is that overlays, experiments, and layout changes can still invalidate the target, which is why the action requires post-click evidence.

## 13. Time-specific scheduling

### Absolute deadlines, not countdowns

Every deferred action uses an ISO timestamp in `nextEligibleAt`. A one-hour delay does not mean "sleep in memory for one hour." It means:

```text
dueAt = anchorAt + delayInMilliseconds
remaining = max(0, dueAt - currentTime)
```

The anchor is:

- `acceptedAt` when a message follows a confirmed connection acceptance; or
- the completed timestamp of the previous non-automatic action for later follow-ups.

Examples:

- Reopen after 30 minutes of a one-hour delay: 30 minutes remain.
- Reopen after three hours: the deadline is already due, so the lead can run immediately, subject to working hours, caps, cooldown, and inter-action pacing.
- Change a pending delay from one hour to 15 minutes after 20 minutes have elapsed: resume recalculates from the original anchor; the action is due now.
- Change it from 15 minutes to one hour after 20 minutes: 40 minutes remain.

`delaysSatisfiedActionIds` prevents an elapsed delay from being scheduled again after the action advances.

### Pause behavior

Pausing does not move the due date forward. Time continues to elapse against the absolute deadline. On resume, the runner compares the current time with the stored/recalculated deadline.

This matches the requested semantics: pause prevents execution, but it does not erase real elapsed time.

### Closing the UI or controller

- Closing only the React tab does not make the UI the scheduler; the Node controller can continue the run.
- If the Node controller is also stopped, nothing can be sent while it is offline.
- Run state and deadlines remain on disk.
- On restart, the profile runtime recovers resumable runs and evaluates the absolute timestamps again.
- A lead interrupted in the middle of an unconfirmed browser attempt becomes `needs_review`, because replaying it could duplicate an action.
- A paused run remains paused after restart. A run already stopping becomes stopped.

The system is durable, but it is not an operating-system service. It only executes while the local controller and machine are running.

## 14. Pause, stop, resume, and retry

### Pause

Pause is reversible. The loop stores `pauseRequested`, enters `paused`, clears transient sleep labels, and performs no Send click while paused. If pause arrives during message preparation, the current attempt is completed as paused and the lead returns to the queue.

### Stop

Stop ends the current run. A stopped run may be restarted later if its remaining lead states are resumable. Leads are converted to stopped during finalization, and a new/restarted run must still pass safety and duplicate-delivery rules.

### Resume/restart

Resume can update pending workflow delays from the current campaign actions. Recalculations are audited as `workflow_delay_updated`. If another run for that profile is active, the resumed run is queued.

### Retry

Retry is deliberately narrow. It is allowed only when the previous failure proves that the irreversible send did not happen, for example:

- the Message element was not found;
- composer text did not exactly match and Send was not clicked;
- a specific reply-check ambiguity that did not perform a send.

It is not allowed after an unconfirmed post-click outcome.

## 15. Connection acceptance and reply detection

### Connection state

The profile page is classified using semantic evidence:

- a visible `Pending` control means the invitation is pending;
- a visible first-degree marker means accepted;
- a main-profile Message control is additional connected evidence;
- a visible Connect control means a connection is available but not accepted.

Waiting acceptance is deferred for one hour at a time. On the next check, confirmed acceptance records `acceptedAt` and advances the action cursor. Ambiguous state becomes `needs_review`.

Remember: the live connection-request click path is currently disabled, so this logic mainly supports dry-run workflows and existing relationship state. Complete live campaigns are message-only.

### Replies

A sent message creates a baseline containing its send time and message identity. Reply checks reopen the lead from the profile page, enter that campaign conversation, read the conversation, and look for an incoming message after the baseline.

Reply scanning:

- considers the latest live run for each campaign;
- skips leads already marked replied;
- requires a prior confirmed sent-message baseline;
- is skipped while the profile's runner is busy;
- is throttled on the server to once per minute unless forced;
- runs from the UI about 1.5 seconds after connection and every two minutes afterward;
- records reply text, observation time, and external message ID when found.

A reply moves the lead to terminal state `replied`, which prevents later follow-ups. Notifications are deduplicated by external message ID or a stable campaign/lead/time fallback. Read state is stored separately for each profile.

## 16. Safety policy

Safety is evaluated before each executable action from the frozen safety snapshot and that run's audit entries.

### Working hours

The policy converts the current instant into the configured IANA time zone and supports:

- normal same-day windows, such as 09:30 to 18:30;
- overnight windows, such as 22:00 to 06:00;
- equal start/end times as a 24-hour window.

Outside the window, the run stores `sleepingUntil` for the next opening.

### Rolling daily caps

The "daily" cap is a rolling 24-hour window, not a midnight reset. Successful outcomes from audit logs are counted, so restarting the controller does not reset the budget.

There is a total action limit and a separate connection-request limit. The next eligible time is one second after the oldest matching action exits the 24-hour window.

### Batch cooldown

After each complete batch of successful actions, the run sleeps until the configured cooldown has elapsed from the latest action.

### Random pacing

After an executed action, the runner waits a random duration between the configured minimum and maximum delays. A workflow action configured as "send now" skips its workflow delay, not these safety gates.

### Scope caveat

Because caps are calculated from the current run's audit log, the current implementation does not aggregate a profile-wide daily cap across separate runs. A production version should use a profile-level action ledger.

## 17. Multi-profile isolation

Each profile ID is validated, normalized into a safe folder prefix, and combined with an eight-character SHA-1 digest. The digest prevents two IDs that sanitize to the same Windows folder name from colliding.

```text
.local/profiles/<safe-slug>-<digest>/
  chrome-profile/        cookies, login, browser data
  runs/<run-id>/
    state.json           latest durable run state
    audit.log            append-only NDJSON events
  session.json           remembered CDP port/process metadata
  profile.json           original profile ID and folder metadata
```

The runtime registry lazily builds a bundle for each profile:

```text
profile runtime = browser session + run store + runner
```

Simultaneous requests for the same missing runtime or browser are coalesced so they cannot launch duplicates.

The browser pool chooses the active Chrome port from, in order:

1. Chrome's `DevToolsActivePort` file when it is alive;
2. a remembered session port when still usable;
3. the first bindable, unclaimed port in a bounded range starting at the configured base.

It checks both CDP responsiveness and whether the machine can bind the port. After launch, it records the actual port Chrome selected.

Legacy single-profile data is **copied**, not moved or deleted. Ownership is inferred from historical run `profileId` values and recorded once so a newly added account cannot accidentally inherit another account's LinkedIn login.

## 18. Persistence and crash recovery

### Browser `localStorage`

Stores:

- company user UI record;
- linked LinkedIn account records;
- editable campaign workspaces;
- global safety settings;
- per-profile notification seen timestamps.

### Filesystem

Stores:

- isolated Chrome user-data directories;
- profile metadata and remembered CDP ports;
- immutable run snapshots inside mutable `state.json` records;
- append-only `audit.log` entries.

`state.json` is written atomically: write a temporary file, then rename it. This avoids leaving a partially written JSON document if the process stops mid-write.

Audit entries are newline-delimited JSON with timestamp, run, lead, action, attempt, event, outcome, error code, and detail. They are useful for debugging, recovery decisions, analytics, and explaining what the automation did.

On startup, stored profile folders are discovered and their runtimes initialized. Invalid legacy folders such as literal `undefined` or `null` IDs are ignored.

## 19. Lead acquisition and enrichment

The URL parser accepts standard profile paths and Sales Navigator lead paths, normalizes them to HTTPS `www.linkedin.com`, removes duplicate URLs, and rejects unsupported hosts/paths.

Lead sources can be created from:

- one profile URL;
- pasted profile URLs;
- CSV or TXT content;
- visible links on a supported LinkedIn/Sales Navigator page.

For enrichment, the controller opens profiles and reads available rendered data such as:

- display, first, and last name;
- headline and current position;
- company name and company LinkedIn URL;
- personal LinkedIn and Sales Navigator URLs;
- location, industry, about text;
- public identifier and connection degree;
- email, phone, and website when visibly available.

Availability depends on LinkedIn permissions, page layout, and what the member exposes. The system must not claim data that was not present.

## 20. CSV exports

### Prospect/CRM export

Before export, the app refreshes profile identities when possible. The CSV contains:

- record ID;
- first, last, and full name;
- job title and headline;
- company name;
- personal LinkedIn, company LinkedIn, and Sales Navigator URLs;
- original location plus city, state, and country;
- industry, email, phone, website, and about;
- connection degree and public identifier;
- campaign, lead status, source metadata, and added time.

CSV cells containing commas, quotes, or line breaks are quoted, embedded quotes are doubled, rows use CRLF, and a UTF-8 BOM helps spreadsheet applications detect encoding.

Location splitting is heuristic:

- one part -> city;
- two parts -> city and country;
- three or more -> everything before the last two parts is city, followed by state and country.

This cannot perfectly understand every global location format. A production CRM integration should use a geocoder or preserve a verified structured source.

### Report export

The report CSV exports one row per day with invitations, acceptances, messages, and replies for the selected range.

## 21. Campaign outcomes and reports

The campaign table derives unique outcome records from all runs for that campaign and shows invited, accepted, messaged, replied, and failed counts. Clicking a number routes to the campaign's Leads tab with that outcome filter and displays the matching people.

The reports API reads only live-run audit events, filters by profile/campaign/date, deduplicates events, fills missing calendar days with zeros, and calculates:

```text
acceptance rate = accepted / invitations sent * 100
reply rate      = replies / messages sent * 100
```

The report UI offers date inputs, campaign selection, series toggles, daily bars, hover values, summary totals, a daily table, and CSV export.

One current semantic caveat: the campaign-list `invited` derivation treats a successful dry-run connection attempt as an invited outcome, while the reports API only counts tracked events from live runs. These two surfaces can therefore differ. This should be normalized before describing dry-run invitations as real invitations.

## 22. API surface

All account-sensitive calls require `profileId` either in the query or body.

### Browser endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Controller liveness |
| GET | `/api/chrome/status?profileId=...` | One profile's Chrome state |
| GET | `/api/chrome/sessions` | All initialized browser states |
| GET | `/api/chrome/diagnose?profileId=...` | Port/process/profile diagnostics |
| GET | `/api/chrome/tabs?profileId=...` | Current tabs |
| POST | `/api/chrome/start` | Start or attach profile Chrome |
| POST | `/api/chrome/open` | Open a URL in profile Chrome |
| POST | `/api/chrome/collect-profiles` | Collect visible profile links |
| POST | `/api/chrome/resolve-profile-identities` | Enrich requested profiles |
| POST | `/api/chrome/stop` | Stop only that profile's managed browser |

### Run and reporting endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/campaign-runs` | Validate, persist, and start one run |
| POST | `/api/campaign-runs/batch` | Create sequential campaign runs |
| GET | `/api/campaign-runs?profileId=...` | List profile run history |
| GET | `/api/campaign-runs/active?profileId=...` | Reattach UI to active/resumable run |
| GET | `/api/campaign-runs/:id` | Read one run |
| POST | `/api/campaign-runs/:id/pause` | Pause run |
| POST | `/api/campaign-runs/:id/resume` | Resume/restart and update delays |
| POST | `/api/campaign-runs/:id/stop` | Stop run |
| POST | `/api/campaign-runs/:id/retry` | Retry only a provably safe failure |
| POST | `/api/campaign-replies/check` | Scan eligible live conversations |
| GET | `/api/analytics/campaigns` | Aggregate live audit events |

Run-specific endpoints locate the owning runtime from persisted run directories. This prevents a caller from having to guess which in-memory runner owns an ID.

## 23. Error and uncertainty model

Stable codes distinguish failures such as:

- Chrome not connected;
- LinkedIn logged out;
- authentication challenge;
- navigation timeout;
- element not found;
- layout mismatch;
- weekly limit reached;
- run stopped;
- ambiguous outcome.

The most important distinction is between **failed before an irreversible action** and **unknown after an irreversible action**. Only the first category may be automatically safe to retry.

When a page cannot be classified, selected HTML is sanitized and captured in action details for debugging. The executor does not continue clicking through an unknown surface.

## 24. Validation strategy

Before a run is created, pure validation checks:

- snapshot and campaign structure;
- at least one executable action;
- supported action types;
- automatic guard adjacency;
- known template variables;
- non-negative delays in minutes, hours, or days;
- at least one non-excluded lead;
- valid LinkedIn profile URLs;
- sane safety settings;
- live message-only workflow and exact authorization scope.

Pure functions are used for state transitions, deadline calculations, safety windows, analytics aggregation, URL normalization, and CSV generation. This keeps the most failure-prone logic testable without launching Chrome.

## 25. Test coverage and verification

The current suite has 17 test files and 111 passing tests. It covers:

- run transitions, validation, queueing, deadlines, and delay updates;
- atomic run storage, audit reading, recovery, and duplicate-send detection;
- working windows, caps, cooldowns, and random delay bounds;
- message reply classification and composer-related rules;
- browser-pool isolation, port choice, concurrent creation, and release;
- profile paths, slug collisions, legacy ownership/migration, and runtime isolation;
- analytics aggregation and deduplication;
- frontend routing and outcome derivation;
- campaign storage migration;
- chart scaling and tooltip geometry;
- notification seen state;
- CRM CSV formatting and location splitting;
- API error parsing.

At the review point for this guide:

```text
npm test       -> 17 files passed, 111 tests passed
npm run build  -> TypeScript and Vite production build passed
```

The main remaining test gap is browser end-to-end coverage against controlled LinkedIn fixtures or a test double. Unit tests cannot guarantee that today's live LinkedIn DOM matches the selectors.

## 26. Security, privacy, and responsible-use discussion

Positive controls already present:

- services bind to loopback by default;
- profile IDs are validated before filesystem use;
- folder names are sanitized and hashed;
- each account has isolated cookies and run data;
- live sends require explicit confirmation;
- duplicate sends are checked against prior campaign history;
- existing drafts are never overwritten;
- ambiguous post-click outcomes are not retried;
- local data is exported only on user action;
- proxy rotation is disabled.

Production gaps to mention honestly:

- `localStorage` is not appropriate for credentials or trusted authentication;
- Chrome profile directories contain sensitive cookies and need OS-level protection;
- the HTTP API has no authorization because it is designed for loopback use;
- audit details may contain message text and profile information;
- data retention and deletion policies are not implemented;
- LinkedIn's terms and member privacy must be reviewed before any real deployment.

## 27. Important design decisions and tradeoffs

### Why Node owns the runner

A React component can unmount, reload, or close. The Node process gives the run a lifecycle independent of the page and can persist state before/after each action.

### Why use a frozen snapshot

Execution must be reproducible. Without a snapshot, changing a template halfway through a run could make the same run send two different definitions without an audit trail.

### Why JSON and NDJSON instead of a database

For a local prototype, they are inspectable, dependency-free, and easy to recover. Atomic JSON handles the current state; append-only NDJSON supplies event history. The tradeoff is weaker querying, locking, indexing, and multi-process concurrency.

### Why poll instead of WebSockets

The frontend polls active campaign lists every 3.5 seconds, idle lists every 12 seconds, and a workspace run roughly every four seconds. Polling is simple and adequate for a local single-user app. Server-sent events or WebSockets would reduce redundant requests and improve immediate updates at greater complexity.

### Why semantic selectors

Visible text, roles, ARIA labels, recipient names, and page structure survive CSS class renaming better than generated class selectors. The downside is localization and A/B-test sensitivity.

### Why fail closed

For messaging, a false negative is inconvenient; a duplicate send is harmful. Therefore uncertainty becomes `needs_attention` instead of an optimistic retry.

## 28. Known defects and technical debt

Be ready to discuss these without becoming defensive:

1. `README.md` is behind the current code and still describes multi-profile isolation, analytics, and reply sync as future work.
2. Frontend campaign definitions and server run history are split across storage systems, so backup and cross-device sync are incomplete.
3. Safety settings are global in frontend storage and caps are per run, not a single profile-wide action ledger.
4. Live connection requests are not enabled.
5. Campaign-list dry-run invitation semantics can be mistaken for actual invitations.
6. The `chromeProfileMode` value still says `single-local-profile`, even though runtime isolation now supports multiple profiles.
7. There is no global concurrency limit across profile runners.
8. The browser automation lacks a maintained fixture suite and controlled end-to-end test environment.
9. Reply scanning is periodic and UI-driven; it is not a background OS service and cannot discover replies while the controller is offline.

## 29. Production evolution

A sensible next architecture would add:

1. SQLite or PostgreSQL for campaigns, profile-scoped action ledgers, events, and migrations.
2. A proper local/hosted authentication and secret-management boundary.
3. A job scheduler with leases, idempotency keys, and worker heartbeats.
4. Profile-wide and organization-wide rate limits.
5. A global maximum for concurrently active browser profiles.
6. CDP fixture recording plus Playwright end-to-end tests against controlled pages.
7. Versioned selector strategies and localization support.
8. Server-sent events for run/notification updates.
9. Explicit data retention, redaction, export, and deletion controls.
10. A platform-compliance review before use beyond controlled testing.

## 30. How to demonstrate it in an interview

A strong five-minute walkthrough is:

1. Open Profiles and explain that each row maps to an isolated Chrome profile/runtime.
2. Enter a profile workspace and show the campaign list, status filters, outcome counters, and bulk controls.
3. Open a campaign and show workflow blocks, automatic guards, variables, leads, and safety settings.
4. Start a dry run and explain frozen snapshots and the lead state machine.
5. Show `state.json` and one `audit.log` to prove durable state and observability.
6. Show a paused lead with `nextEligibleAt` and explain absolute deadline math.
7. Explain the live message pre-click verification and post-click confirmation boundary.
8. Open the outcome list/report and connect the UI numbers back to run attempts and audit events.
9. Finish with one limitation you would address next, such as a profile-wide action ledger.

## 31. A concise interview narrative

Use this structure rather than listing screens:

> I started with a UI prototype and a single Chrome controller, but the real complexity appeared when messages had to be safe across delays, restarts, and multiple accounts. I moved execution into a Node runner, modeled each lead as a state machine, froze campaign inputs at start, and persisted state atomically with an append-only audit log. I then isolated every LinkedIn profile into its own browser, port, run store, and runner. For live messages, the system enters from the profile's main Message button, verifies the recipient and exact draft before clicking, then requires evidence that the message appeared. Any uncertain post-click outcome stops for human review. That design prioritizes idempotency and recoverability over maximum throughput.

## 32. Commands to remember

```powershell
npm install
npm run dev
npm test
npm run build
```

Useful local locations:

```text
.local/profiles/<profile-slug>/chrome-profile/
.local/profiles/<profile-slug>/runs/<run-id>/state.json
.local/profiles/<profile-slug>/runs/<run-id>/audit.log
```

Useful environment variables:

```text
LINKEDIN_AUTOMATOR_HOST
LINKEDIN_AUTOMATOR_PORT
CHROME_REMOTE_DEBUGGING_PORT
CHROME_PATH
LINKEDIN_AUTOMATOR_CHROME_PROFILE   # legacy profile location override
LINKEDIN_AUTOMATOR_LOCAL_DIR        # supported by profile storage code
```

## 33. Final mental model

Remember the project as five nested guarantees:

1. **Profile isolation:** the right account owns the browser and files.
2. **Snapshot isolation:** the run executes an approved, frozen definition.
3. **State-machine control:** each lead can make only legal, persisted transitions.
4. **Safety and time control:** absolute deadlines and audit-derived gates decide when work is eligible.
5. **Evidence-based browser actions:** the runner verifies before and after irreversible clicks and stops when evidence is insufficient.

That is the core engineering story of LinkedIn Automator.
