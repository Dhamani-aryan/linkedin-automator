# Chat Transfer: LinkedIn Automator

Last updated: 2026-08-09  
Repository: `https://github.com/repository-owner/linkedin-automator.git`  
Local workspace: `C:\Projects\linkedin-automator`  
Branch: `main`  
Verified HEAD before this update: `e01a107 Document controller and campaign lifecycle`

## Purpose Of This Document

This is the handoff context for continuing the LinkedIn Automator project in a
new chat or coding session. Read this document before changing code. It
separates working implementation from UI-only concepts and future plans.

## Current Checkpoint

The project is at the boundary between a functional campaign builder and a
real automation runner.

**A configured campaign cannot send LinkedIn actions yet.** The current
`Start campaign` control performs preflight, starts managed Chrome when needed,
and persists `Running` or `Stopped`. It does not process the lead queue, send a
connection request, send a message, check acceptance, or check replies.

The latest verified behavior is:

- One `npm run dev` command starts the Vite UI and supervised local controller.
- `Start Chrome` opens the real persistent Chrome profile and displays progress
  or a visible error.
- The persistent profile was verified logged into LinkedIn and reachable over
  the local DevTools port.
- Starting an empty campaign opens lead intake.
- Starting a populated campaign shows a confirmation and persists its lifecycle
  state.
- The confirmation and running-state notice explicitly say browser execution is
  not enabled, so the UI does not falsely claim outreach was sent.
- `Send now` is available for the first message action; it means no workflow
  delay, while global safety pacing still applies once the runner exists.

Recent checkpoint commits:

- `849df22` - start the local Chrome controller with the dev server
- `0910017` - surface managed Chrome startup state and errors
- `fd52104` - add campaign preflight and start/stop lifecycle
- `e01a107` - update architecture and working-feature documentation

Do not describe campaign execution as working until an executor has processed a
controlled test lead and returned a verifiable action result.

## Product Goal

Build a hosted company web application for managing LinkedIn outreach while a
small companion agent runs Chrome on the user's own Windows computer.

The intended user flow is:

1. Register or sign in to a company workspace.
2. Add a LinkedIn profile from the main profile manager.
3. Install and pair a lightweight Windows companion agent.
4. Start a managed Chrome window for that LinkedIn profile.
5. Log into LinkedIn once and keep that login in a persistent Chrome profile.
6. Add campaign leads from individual URLs, URL lists, files, or Sales
   Navigator.
7. Build an outreach workflow from connection requests and messages.
8. Run the workflow locally with enforced limits, delays, cooldowns, and reply
   guards while monitoring it from the hosted web app.

LinkedIn traffic must leave from the user's computer and normal IP address.
There is no proxy or rotating-IP requirement in the current product direction.

## Product And UX Decisions

- The profile manager is the opening product screen after company sign-in.
- Multiple logical LinkedIn profiles are managed only from that main screen.
- Opening a profile enters its dedicated campaign workspace.
- The workspace has `Workflow`, `Leads`, and `Browser` tabs.
- There is no separate campaigns index page in the current UI.
- Campaign details, workflow, lead queue, and browser access live in the
  selected profile workspace.
- Each future LinkedIn profile must own a separate persistent Chrome data
  directory and process. The current milestone intentionally proves one Chrome
  profile first.
- Connection requests automatically receive a `Wait for connection acceptance`
  guard.
- Messages automatically receive a `Check for replies` guard.
- Messages support a configurable delay after the previous workflow step.
- The first message action offers an explicit `Send now` option. It removes the
  workflow delay but does not bypass global safety pacing.
- Safety controls belong only on the Safety Limits page.
- UI direction is modern, restrained, minimal, and operational rather than a
  card-heavy marketing interface.
- Keep implementation commits small and focused. Commit each coherent step so
  work is recoverable, and push when requested.

## Current Architecture

The current repository is a local proof of concept:

```text
React + Vite UI at http://127.0.0.1:5173
  -> Vite starts and supervises the local controller, then proxies /api
  -> Node controller at http://127.0.0.1:4287
  -> controller launches local Google Chrome
  -> Chrome uses .local/chrome-profile
  -> controller talks to Chrome DevTools on 127.0.0.1:9223
```

Chrome is launched with a dedicated `--user-data-dir`, so LinkedIn cookies and
login state survive restarts. Chrome uses the computer's normal network path.

The Vite UI is not currently deployable as a functional hosted app by itself.
Its `/api` calls assume the local development proxy, and product data is stored
in browser `localStorage`.

## What Works Now

### Local company workspace prototype

- Registration/sign-in form opens a local workspace.
- Workspace identity survives reloads in `localStorage`.
- Sign-out clears the active local company user.
- Hash routing preserves manager pages and workspace tabs across refreshes.
- Browser Back and Forward navigation are supported.

### LinkedIn profile manager

- Add multiple logical LinkedIn profile records.
- Open one profile workspace at a time.
- Delete a logical profile after an explicit confirmation dialog.
- A one-time recovery rule restores Sample User's accidentally deleted profile only
  for the local workspace email `workspace@example.test` when its account list is empty.

### Managed Chrome proof

- `npm run dev` starts both the UI and local controller.
- Start and stop a Chrome process owned by the controller.
- Reuse `.local/chrome-profile` for a persistent LinkedIn login.
- Open LinkedIn or another validated URL in a new managed tab.
- Read Chrome connection status and open tabs from the DevTools endpoint.
- Collect LinkedIn and Sales Navigator lead links currently present in the DOM.

### Campaign workspace

- Store one campaign workspace per logical LinkedIn profile.
- Starting an empty campaign opens lead intake.
- Campaign preflight, confirmation, persisted `Running`, and `Stopped` lifecycle
  states work without discarding leads or workflow state.
- Add, select, and remove connection-request and message actions.
- Keep each automatic acceptance/reply guard attached to its parent action.
- Edit connection notes and direct-message templates.
- Insert profile variables such as `{firstName}`, `{lastName}`, `{company}`,
  `{position}`, and `{location}`.
- Preview template variables against sample lead data.
- Configure message delays in minutes, hours, or days.
- Choose `Send now` on the first message action; later message actions retain
  their normal delay controls.

### Lead intake

- Add one LinkedIn profile URL.
- Paste a custom list of LinkedIn URLs.
- Upload CSV or TXT content containing profile URLs.
- Paste Sales Navigator lead URLs.
- Open a Sales Navigator search/list and collect visible lead links.
- Normalize, validate, and deduplicate supported URLs.
- Persist leads and sources per logical profile workspace.

### Safety interface

- Separate tabs exist for Limits, Working hours, Actions, Interface, and
  External CRMs.
- Limits, working-day modes, delays, batch cooldowns, and human-touch toggles
  can be edited in the current React state.
- The `Do not work` setting changes visual state when selected.

## What Does Not Work Yet

- Campaign lifecycle controls work, but no LinkedIn action is executed yet.
- Connection requests and messages are workflow definitions only.
- No scheduler, job queue, lead state machine, retry policy, or campaign runner
  exists.
- Safety settings are not enforced by execution code.
- Safety settings are not persisted across a full reload.
- Reply detection and inbox synchronization are not implemented.
- Analytics and campaign history are not implemented.
- Multiple logical profiles are not separate browser identities. They all map
  to the same `.local/chrome-profile` and DevTools port.
- Authentication is not real. Register and sign-in use the same local handler,
  passwords are not stored or validated, and there is no backend session.
- Company and campaign data are not synchronized to a database.
- Sales Navigator collection only reads links currently loaded in the page. It
  does not scroll or paginate.
- The local controller has no pairing, device authentication, outbound cloud
  connection, auto-update, tray UI, or installer.
- There are no automated tests in the repository yet.

## Sanity Check Results

Verified on 2026-08-09:

```text
npm run build             PASS
node --check server/index.js  PASS
git worktree              CLEAN before adding this document
```

Build output is currently larger than expected for this UI. Both
`src/styles.css` and `src/design-system.css` are large and imported together;
the latter acts as an override layer. The generated CSS was approximately 771
KB before gzip. Consolidate these styles later, but do not combine that cleanup
with feature work.

## Important Implementation Details

### Storage keys

- `linkedin-automator.company-user`
- `linkedin-automator.linkedin-accounts`
- `linkedin-automator.campaign-workspace-v1`
- `linkedin-automator.restore-sample-user-account-v1.<workspace-email>`

The Sample User restoration code in `src/lib/storage.ts` is a narrowly scoped data
recovery migration, not a default profile seed. It should be removed after the
local recovery is no longer needed and must not ship as production behavior.

### Browser controller endpoints

- `GET /api/health`
- `GET /api/chrome/status`
- `GET /api/chrome/tabs`
- `POST /api/chrome/start`
- `POST /api/chrome/open`
- `POST /api/chrome/collect-profiles`
- `POST /api/chrome/stop`

The controller listens on `127.0.0.1:4287`. Chrome DevTools uses port `9223`.
The controller currently permits CORS from any origin, which is acceptable only
for this local proof. A production local agent must authenticate every request
and restrict origins or avoid a public local HTTP API entirely.

### Environment variables

- `LINKEDIN_AUTOMATOR_HOST`
- `LINKEDIN_AUTOMATOR_PORT`
- `CHROME_REMOTE_DEBUGGING_PORT`
- `CHROME_PATH`
- `LINKEDIN_AUTOMATOR_CHROME_PROFILE`

## Target Hosted Architecture

The agreed target is a hosted control plane plus a local Windows companion:

```text
Hosted web app and API
  -> authentication, companies, users, profiles, campaigns, workflow data
  -> scheduler, job records, audit log, device inventory
  -> sends scoped jobs over an authenticated connection

Windows companion agent
  -> pairs with one company using a short-lived code
  -> opens an outbound encrypted WebSocket to the hosted API
  -> launches and supervises visible local Chrome windows
  -> owns persistent Chrome profile directories and local secrets
  -> executes browser commands and reports progress

Local Chrome
  -> uses the user's computer IP
  -> retains LinkedIn cookies locally
  -> never uploads LinkedIn passwords, cookies, or the Chrome profile
```

For future multi-profile support, preserve this mapping:

```text
LinkedInProfile -> BrowserSession -> Chrome process + CDP port + profile dir
```

Suggested profile layout:

```text
%LOCALAPPDATA%\LinkedIn Automator\
  agent\
  logs\
  chrome-profiles\
    {linkedinProfileId}\
```

## Local Installation Direction

Normal customers should receive a signed `LinkedInAutomatorSetup.exe`; a CLI
should be optional.

Recommended first implementation:

1. Bundle the existing Node controller and runtime into a Windows executable.
2. Package it with a per-user Windows installer.
3. Run it as a tray/startup application in the interactive user session so it
   can launch visible Chrome windows.
4. Pair it from the website using a short-lived one-time code or a custom URL
   such as `linkedin-automator://pair?code=...`.
5. Store the device credential using Windows DPAPI.
6. Maintain an outbound WSS connection; do not expose an inbound machine port.
7. Add signed automatic updates, health status, logs, revocation, and clean
   uninstall behavior.

A Windows Service alone is not suitable for the first version because services
run outside the user's interactive desktop session. A service plus per-user
helper can be considered only if later requirements justify the complexity.

## HeySnap Findings

HeySnap was inspected locally at `G:\heysnap`. Its architecture is useful as a
reference but should not be copied wholesale.

HeySnap provisions Ubuntu cloud machines or local Docker containers. A machine
bootstrap installs a machine server, registers the machine, sends heartbeats,
downloads verified releases, runs migrations, restarts only when safe, and
opens an outbound tunnel to the cloud gateway.

Its browser path is approximately:

```text
agent/browser-control request
  -> machine server
  -> browser-control WebSocket
  -> HeySnap web browser-control manager
  -> Chrome extension bridge through chrome.runtime
  -> remembered Chrome window and CDP commands
```

Useful ideas to copy:

- Device registration and heartbeat
- Outbound authenticated tunnels
- Short-lived access sessions
- Capability/status reporting
- Release manifests, checksums, health checks, and safe updates
- Structured browser command protocol
- Reconnect and progress reporting

Unnecessary for the first LinkedIn Automator release:

- EC2 provisioning
- Docker machines
- Remote filesystem and terminal protocols
- Full remote-computer streaming
- General-purpose coding-agent runtime

HeySnap's extension controls a remembered window in an existing Chrome profile;
it does not solve our requirement for one persistent Chrome identity per
LinkedIn profile. We still need the local launcher/agent. An extension may be
added later for browser commands if it proves more reliable than direct CDP.

## Recommended Next Milestones

Keep each milestone in small commits.

The immediate milestone is a **single-profile local campaign runner**. Build it
before hosted infrastructure, installers, or multi-profile orchestration.

### 1. Extract browser control boundaries

- Move Chrome process and CDP operations out of the monolithic
  `server/index.js` into a `BrowserSession` module.
- Preserve the current profile directory and port behavior.
- Add typed command results and stable error codes for disconnected Chrome,
  logged-out LinkedIn, missing elements, timeouts, and interrupted runs.
- Keep all LinkedIn page interaction behind the browser-session boundary so a
  Chrome extension or different controller can replace direct CDP later.

### 2. Define the runner state machine

- Add structured `CampaignRun`, `LeadRun`, and `ActionAttempt` models.
- Give every lead an action cursor, status, attempt count, `nextEligibleAt`, and
  last error.
- Use explicit states such as `queued`, `running`, `waiting_acceptance`,
  `waiting_delay`, `replied`, `completed`, `failed`, and `stopped`.
- Define transitions centrally instead of updating counters ad hoc in React.
- Validate workflows before accepting a run: no orphan guards, supported action
  types, valid templates, valid delays, and at least one queued lead.

### 3. Add durable local execution storage

- Store run state under `.local/` using atomic JSON writes for the first
  version; do not keep active jobs only in memory or React state.
- Add an append-only audit log containing timestamp, profile, campaign, lead,
  action, attempt, outcome, and error code.
- Recover an interrupted run as `stopped` or safely resumable after controller
  restart. Never automatically resend an action with an unknown outcome.

### 4. Expose runner APIs

- `POST /api/campaign-runs` to validate and start a run.
- `GET /api/campaign-runs/:id` for status and progress.
- `POST /api/campaign-runs/:id/stop` for cooperative cancellation.
- `POST /api/campaign-runs/:id/resume` only after durable recovery exists.
- Return structured preflight failures to the workspace instead of generic
  server errors.
- Update the React workspace from server-reported run state. The UI must not be
  the source of truth for execution.

### 5. Enforce safety before browser actions

- Persist Safety Limits settings and send a validated snapshot with each run.
- Enforce working days/hours, rolling daily action caps, invite caps,
  randomized delays, profile dwell time, batch size, and cooldown.
- Apply a single-run mutex so two campaigns cannot control the same Chrome
  profile concurrently.
- Make Stop cooperative and check it before navigation, before clicking, and
  during every delay.
- Record why a run is sleeping and its next eligible time.

### 6. Implement connection requests first

- Begin with a dry-run mode that navigates to one controlled test profile,
  reads the visible state, resolves the note template, and records the action it
  would take without clicking Send.
- Require an explicit test confirmation before enabling a live send.
- Handle already connected, invitation pending, Connect unavailable, weekly
  limit reached, auth challenge, and page-layout mismatch as separate outcomes.
- Mark success only after the LinkedIn UI provides an authoritative success or
  pending-invitation signal.
- Stop or quarantine the lead when the result is uncertain; do not retry an
  ambiguous send automatically.

### 7. Implement acceptance waiting and messages

- Make `Wait for connection acceptance` a real deferred state, not a blocking
  loop that keeps Chrome busy.
- Recheck eligible waiting leads on later runner passes.
- Resolve message variables from stored lead data immediately before sending.
- Apply `Send now` or the configured workflow delay in addition to global
  safety pacing.
- Handle unavailable Message controls, composer failures, character limits,
  duplicate/uncertain sends, and navigation interruptions explicitly.

### 8. Implement reply guards

- Check for replies before every follow-up message, not only after sending.
- Persist conversation identity and last observed inbound message timestamp.
- Move replied leads to a terminal `replied` state and suppress all later
  automated follow-ups.
- Never infer “no reply” solely because one selector is missing.

### 9. Add tests and controlled verification

- Unit-test workflow validation, transitions, limits, delay calculation,
  template resolution, recovery, and idempotency.
- Test browser adapters against saved sanitized HTML fixtures before live use.
- Use one explicitly approved test profile for the first live connection and
  message checks.
- Verify Stop, restart recovery, and ambiguous-outcome handling before running
  more than one lead.

### 10. Continue the broader product only after the runner is proven

- Add real hosted authentication, Postgres persistence, and company ownership.
- Add local-agent pairing, heartbeat, and outbound WSS communication.
- Package and sign the Windows companion installer.
- Add one isolated Chrome profile and port per LinkedIn profile.
- Add analytics, inbox views, exports, and integrations from audited run data.

Do not begin multi-profile process orchestration before the one-profile runner,
limits, recovery, and audit logging are proven.

Do not spend the next implementation cycle on additional visual redesign. The
current blocking capability is execution correctness and recoverability.

## Key Files

- `src/App.tsx`: auth prototype, profile manager, app routing, Chrome status.
- `src/components/AccountWorkspace.tsx`: selected profile workspace, workflow,
  leads, and browser tabs.
- `src/components/LeadSourceWizard.tsx`: URL/file/Sales Navigator lead intake.
- `src/components/MessageTemplateEditor.tsx`: variables, previews, and delays.
- `src/components/SafetyLimitsPage.tsx`: safety settings tabs.
- `src/components/HumanTouchPanel.tsx`: delay and cooldown controls.
- `src/lib/workflow.ts`: action creation and automatic guard pairing.
- `src/lib/campaignStorage.ts`: per-profile local campaign persistence.
- `src/lib/storage.ts`: local company/profile records and recovery migration.
- `src/lib/chromeApi.ts`: frontend calls to the local controller.
- `server/index.js`: Chrome launcher, DevTools status, navigation, and visible
  lead collection.
- `docs/ARCHITECTURE.md`: original local and multi-profile boundaries.
- `docs/CURRENT_WORKING_FEATURES.md`: concise implementation status.
- `docs/LINKED_HELPER_FEATURE_INVENTORY.md`: researched Linked Helper feature
  catalogue used for product selection.

## Run Locally

Requirements: Node.js, npm, and Google Chrome.

```powershell
cd "C:\Projects\linkedin-automator"
npm install
```

Start the UI and its supervised local controller:

```powershell
npm run dev
```

Use `npm run server` only when debugging the controller independently.

Open `http://127.0.0.1:5173`.

Build verification:

```powershell
npm run build
node --check server\index.js
```

## Engineering Guardrails

- Read the current worktree and recent commits before editing.
- Do not overwrite unrelated user changes in a dirty worktree.
- Keep Chrome credentials and profile data local and ignored by Git.
- Do not claim a UI control is functional unless execution exists and is
  verified.
- Model workflows and jobs with structured types, not ad hoc strings.
- Preserve automatic workflow guards when inserting, reordering, or removing
  actions.
- Stop follow-ups when a reply is detected once reply handling exists.
- Treat limits as mandatory runner policy, not decorative UI settings.
- Add tests with the runner because it will affect external accounts.
- LinkedIn prohibits unauthorized automation and scraping. Maintain conservative
  limits, transparent user controls, auditability, opt-out handling, and manual
  intervention paths. No implementation can guarantee that an account will not
  be restricted.
