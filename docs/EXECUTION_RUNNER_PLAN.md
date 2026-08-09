# Execution Runner Implementation Plan

Goal: take the project from "campaign lifecycle works but nothing is sent" to a
verified single-profile runner that can send real connection requests and
messages with enforced safety limits, durable state, and honest reporting.

Scope: local proof only. No hosted backend, no installer, no multi-profile
work in this plan. Everything happens in the existing repo
(`server/index.js`, `src/`), building on the working Chrome controller.

Grounded in the code as of `e01a107`:

- `server/index.js` is a single-file controller with `startChrome`,
  `openChromeUrl`, `collectVisibleProfiles`, and a one-shot
  `evaluateInChrome(webSocketUrl, expression)` CDP helper.
- Campaign state (workflow actions, leads, lifecycle) lives only in browser
  `localStorage` via `src/lib/campaignStorage.ts`.
- Workflow actions already have stable shapes: `connection_request` +
  automatic `wait_for_acceptance` guard, `message` + automatic `reply_check`
  guard, templates with `{firstName}`-style variables, and per-message delays.

The plan is nine phases. Each phase ends in a commit (or a few small ones)
that builds, passes `node --check`, and leaves the app usable.

---

## Phase 0 — Decisions to lock before writing code

1. **Runner lives in the Node controller, not React.** The browser tab can be
   closed mid-run; the controller process is the only component that survives.
   The UI becomes a viewer/remote for server-reported run state.
2. **The server becomes the source of truth for a run.** When a run starts,
   the UI uploads a frozen snapshot (workflow + leads + safety settings) to
   the controller. From then on the UI only polls/receives state; it never
   mutates run state directly. Lead data outside a run stays in localStorage
   for now.
3. **CDP session per run, not per command.** The current
   `evaluateInChrome` opens a fresh WebSocket per expression. The runner
   needs a persistent CDP session per tab with sequential command ids,
   event subscriptions (`Page.loadEventFired`, `Runtime` exceptions), and
   proper timeouts. Build this once in Phase 1.
4. **Dry run is the default execution mode** until a live send has been
   explicitly confirmed against a controlled test profile.
5. **Ambiguity is terminal, not retryable.** Any action whose outcome cannot
   be confirmed from the LinkedIn UI marks the lead `needs_review` and never
   auto-retries. This is the single most important account-safety rule.

---

## Phase 1 — Extract a BrowserSession module (foundation)

New folder: `server/lib/`. Keep `server/index.js` as the HTTP layer only.

Files:

- `server/lib/browserSession.js` — owns the Chrome process and one persistent
  CDP connection.
  - `launch()`, `stop()`, `status()` (move existing logic here unchanged:
    same profile dir, same port 9223).
  - `openTab(url)` / `closeTab(tabId)` / `attach(tabId)` returning a
    `CdpSession` with `send(method, params)`, sequential ids, per-command
    timeout, and event listeners.
  - `navigate(session, url, {timeoutMs})` — navigate and wait for load or
    a network-idle heuristic; return a typed result.
  - `evaluate(session, fn, args)` — serialize a real function + args instead
    of string expressions (template the args as JSON). Keeps page scripts
    reviewable and testable.
- `server/lib/errors.js` — stable error codes used everywhere:
  `CHROME_NOT_CONNECTED`, `LINKEDIN_LOGGED_OUT`, `NAVIGATION_TIMEOUT`,
  `ELEMENT_NOT_FOUND`, `LAYOUT_MISMATCH`, `AUTH_CHALLENGE`,
  `WEEKLY_LIMIT_REACHED`, `RUN_STOPPED`, `AMBIGUOUS_OUTCOME`.

Also add a login/auth probe here: `checkLinkedInAuth(session)` navigates to
`https://www.linkedin.com/feed/` and classifies the result (logged in /
login wall / checkpoint-challenge page) from the URL and a couple of DOM
markers. Every run pass starts with this probe.

Definition of done: existing endpoints (`/api/chrome/*`) behave identically
but route through the module; `node --check` passes; manual smoke test of
Start Chrome / open URL / collect profiles from the UI.

## Phase 2 — Run models, state machine, and durable storage

Files:

- `server/lib/runStore.js` — durable JSON state under
  `.local/runs/{runId}/state.json` written atomically
  (write temp file, `rename`). Plus `.local/runs/{runId}/audit.log` as
  append-only NDJSON: `{ts, runId, leadId, actionId, attempt, event,
  outcome, errorCode, detail}`.
- `server/lib/runModel.js` — pure functions, no I/O:
  - Types (JSDoc typedefs are fine): `CampaignRun`, `LeadRun`,
    `ActionAttempt`.
  - Lead states: `queued`, `running`, `waiting_acceptance`, `waiting_delay`,
    `replied`, `completed`, `failed`, `needs_review`, `stopped`.
  - Run states: `validating`, `running`, `sleeping`, `stopping`, `stopped`,
    `completed`, `failed`.
  - `transition(leadRun, event)` — the ONLY way state changes. Throws on
    illegal transitions.
  - Every `LeadRun` carries: `actionCursor` (index into the workflow),
    `attempts`, `nextEligibleAt`, `lastErrorCode`, `conversationSeenAt`.
  - `validateRun(snapshot)` — workflow has ≥1 non-automatic action, guards
    are attached to a parent, templates only use known variables, delays are
    positive, ≥1 queued lead, safety snapshot present and sane. Returns a
    list of structured failures for the UI.

Recovery rule: on controller start, scan `.local/runs/`; any run in
`running`/`sleeping`/`stopping` becomes `stopped` with reason
`controller_restart`. Any lead that was mid-attempt (`running` with an
attempt started but no recorded outcome) becomes `needs_review` — never
resume an action with an unknown outcome.

Definition of done: unit tests for `transition` and `validateRun` (this is
the moment to add vitest — see Phase 8, but bootstrap the test runner now);
kill-and-restart of the controller demonstrably recovers state.

## Phase 3 — Runner loop + run APIs

File: `server/lib/runner.js` — a single cooperative loop per run:

```text
loop:
  if stopRequested -> finalize stopped
  refresh auth probe (cached ~10 min)
  pick next eligible lead:
    nextEligibleAt <= now, state in {queued, waiting_acceptance, waiting_delay}
  if none -> compute next wake time, set run state sleeping, sleep in
    small slices (<= 5s) so Stop stays responsive
  check safety budget (Phase 4); if exhausted -> sleep until window opens
  execute the lead's current action via the action executor (Phases 5-7)
  record ActionAttempt + audit line, apply transition, persist atomically
  apply post-action dwell/randomized delay (also sliced for Stop)
```

One mutex: a module-level "active run" slot. Starting a second run while one
is `running`/`sleeping` returns a structured 409. This also prevents two
runs sharing the Chrome profile.

New endpoints in `server/index.js`:

- `POST /api/campaign-runs` — body: `{profileId, campaign, actions, leads,
  safety, mode: "dry_run" | "live"}`. Validates, persists, starts the loop.
  Returns `runId` or the structured validation failures.
- `GET  /api/campaign-runs/:id` — full run + per-lead state + why-sleeping +
  `nextEligibleAt`.
- `GET  /api/campaign-runs/active` — for UI reattach after reload.
- `POST /api/campaign-runs/:id/stop` — sets `stopRequested`; the loop checks
  it before navigation, before any click, and inside every sleep slice.

UI wiring (`src/lib/runnerApi.ts`, changes to `AccountWorkspace.tsx`):
`Start campaign` now builds the snapshot and calls `POST /api/campaign-runs`;
the workspace polls the status endpoint every ~3–5 s while a run exists and
renders server-reported per-lead states and counters. Remove the "execution
is not enabled" notice only when this lands. Keep localStorage as the
pre-run editing store; the run snapshot is frozen at start.

## Phase 4 — Safety enforcement (before any live click)

- `src/lib/safetyStorage.ts` — persist Safety Limits to localStorage (they
  currently reset on reload). Include them, validated, in the run snapshot.
- `server/lib/safetyPolicy.js` — pure functions over the audit log + clock:
  - Working days/hours (profile-local time) — outside the window, the run
    sleeps and records `sleepingUntil` + reason.
  - Rolling daily caps per action type (invites/day, messages/day) computed
    from audit entries, so restarts don't reset the count.
  - Randomized inter-action delay (min–max), profile dwell time, batch size
    + batch cooldown.
- `Send now` on the first message means "no workflow delay"; safety pacing
  still applies — implement exactly that: skip `waiting_delay`, never skip
  the pacing gate.

Definition of done: unit tests for cap counting across a simulated restart,
window math around midnight, and randomized delay bounds.

## Phase 5 — Connection requests (dry run first, then live)

File: `server/lib/actions/connectionRequest.js`.

Page-reading strategy: prefer stable semantics over brittle class names —
button text/`aria-label` ("Connect", "Pending", "Message", "More"), URL
shape, and modal roles. Centralize selectors in
`server/lib/actions/selectors.js` so layout changes are one-file fixes, and
capture `document.title` + a sanitized outerHTML snippet into the audit
detail on `LAYOUT_MISMATCH` for later fixture-building.

Dry-run executor (default):

1. Navigate to the lead's profile URL; classify page (profile / login wall /
   challenge / unavailable).
2. Read connection state: already connected (Message button, 1st degree
   badge), invitation pending, Connect available (directly or under More),
   Connect unavailable.
3. Resolve the note template with the lead's variables (reuse one shared
   template-resolution function — see Phase 7).
4. Record `would_send_connection_request` with the resolved note in the
   audit log, mark the attempt outcome `dry_run_ok`, and advance state as if
   sent, into `waiting_acceptance` (so the whole workflow can be rehearsed).

Live executor (enabled per run only after the Phase 8 confirmation flow):

5. Click Connect → handle the "Add a note" modal (add note if template
   non-empty, respecting the 200/300-char limit) → click Send.
6. Confirm success ONLY from an authoritative signal: the button flipping to
   "Pending", or the confirmation toast. If neither appears within the
   timeout, outcome = `AMBIGUOUS_OUTCOME` → lead `needs_review`, and the
   runner pauses the run (`needs_attention`) rather than continuing blind.
7. Distinct outcomes, each its own error code and transition: already
   connected (skip forward to the message step), pending (enter
   `waiting_acceptance`), weekly invite limit modal (`WEEKLY_LIMIT_REACHED` →
   run sleeps until next week boundary, lead stays `queued`), auth challenge
   (`AUTH_CHALLENGE` → run pauses, needs the human), layout mismatch
   (`LAYOUT_MISMATCH` → lead `needs_review`).

## Phase 6 — Acceptance waiting and reply checks

- `wait_for_acceptance` is a deferred state, not a loop: the lead sits in
  `waiting_acceptance` with `nextEligibleAt = now + recheckInterval`
  (e.g. 4–24 h, configurable). On recheck, open the profile and read the
  degree/Message state: accepted → advance cursor; still pending → push
  `nextEligibleAt` again; withdrawn/expired → `failed` with reason.
- Reply detection (`reply_check` guard): before every follow-up message,
  open the conversation with the lead (via the profile's Message control)
  and read the thread. Persist the conversation URN/URL and the timestamp of
  the last message seen from us. Any inbound message newer than our last
  outbound → transition to terminal `replied`; suppress all later automated
  follow-ups for that lead.
- Never infer "no reply" from a missing selector: if the thread cannot be
  read, outcome is `AMBIGUOUS_OUTCOME` → `needs_review`, not "no reply".

## Phase 7 — Messages

Files: `server/lib/actions/message.js`, `src/lib/templateResolver.ts`
(shared logic: keep one pure resolver used by both UI preview and runner —
simplest is to duplicate the ~30-line function in `server/lib/template.js`
and unit-test both against the same fixture table, since the server is JS
and the UI is TS).

1. Eligibility: reply check first (Phase 6), then workflow delay
   (`waiting_delay` until `nextEligibleAt`), then safety pacing.
2. Resolve variables from stored lead data at send time, not enqueue time.
   Missing variable → configurable fallback (empty vs skip-lead), recorded
   in audit.
3. Open composer from the profile's Message button; if unavailable
   (not connected anymore, restricted), record a distinct outcome.
4. Insert text via CDP (`Input.insertText` or setting the contenteditable +
   input events), verify the composer content matches the resolved template,
   then click Send.
5. Confirm success by seeing the message appear in the thread; capture its
   timestamp as the new "last outbound". Anything else → `AMBIGUOUS_OUTCOME`
   → `needs_review`. Never re-send on uncertainty.
6. Dry-run mode does everything through step 2, records
   `would_send_message` with resolved text, and advances state.

## Phase 8 — Controlled live verification

Gate between dry run and live, in this order:

1. Full dry run of a 2-action workflow (connect + message) against a queue
   of 2–3 controlled/consenting test profiles. Review the audit log:
   correct page classification, correct resolved templates, correct state
   flow including `waiting_acceptance`.
2. UI adds a per-run "live send" confirmation that names the exact lead
   count and shows the first resolved note — no global live toggle.
3. First live run: exactly ONE test lead, connection request only. Verify
   the pending state on LinkedIn manually, verify the audit entry, verify
   acceptance detection after the test account accepts.
4. First live message to that same accepted test lead; verify reply
   detection by replying from the test account.
5. Verify Stop mid-run (during a delay and just before an action), and
   restart recovery (`kill` the controller mid-sleep, restart, confirm the
   run is `stopped` and no lead is in an unknown state).

Only after all five pass may a run with more than one lead go live.

## Phase 9 — Tests and fixtures (grows alongside Phases 2–7)

- Unit (vitest, no browser): state transitions, run validation, safety math,
  template resolution, delay computation, recovery classification,
  audit-log cap counting.
- Taylorpter tests: run the page-reading functions against saved sanitized HTML
  fixtures (profile with Connect, with Pending, 1st-degree, login wall,
  challenge page, weekly-limit modal, message thread with/without reply)
  loaded into jsdom or a local Chrome tab via the same `evaluate` path.
  Build the fixture set during Phase 5 dry runs.
- Add `npm test` and run it plus `npm run build` +
  `node --check server/index.js` before every commit.

---

## Commit sequence (suggested)

1. `extract BrowserSession and CDP session from server/index.js`
2. `add typed browser error codes and LinkedIn auth probe`
3. `add run models, state machine, and validation` (+ tests, vitest setup)
4. `add durable run store with atomic writes and audit log` (+ recovery)
5. `add runner loop, run endpoints, and single-run mutex`
6. `wire Start campaign to campaign-run API and poll run state`
7. `persist safety settings and enforce windows, caps, and pacing` (+ tests)
8. `add connection-request executor in dry-run mode` (+ selectors module)
9. `add acceptance recheck and reply detection`
10. `add message executor in dry-run mode` (+ shared template resolver)
11. `add live-send confirmation gate and enable live connection requests`
12. `enable live messages after verified test lead`
13. `add browser-adapter fixtures and remaining tests`

Each of these should leave `npm run build` green. Steps 1–7 involve zero
LinkedIn interaction risk; 8–10 only navigate and read; only 11–12 click
Send.

## Known risks and mitigations

- **LinkedIn DOM drift**: selectors centralized in one file; layout mismatch
  is a first-class outcome that pauses instead of misfiring; audit captures
  evidence for fixing.
- **Account restriction risk**: conservative default caps, dry-run default,
  one-lead live gate, ambiguous outcomes never retried, human-attention
  pause states. Make it explicit in the UI that no limits guarantee safety
  (LinkedIn prohibits unauthorized automation).
- **Two sources of truth during migration**: frozen run snapshot on the
  server vs editable workspace in localStorage. Rule: while a run is active,
  the workspace locks workflow and lead edits for that campaign.
- **Controller crash mid-click**: attempt records "started" before the click
  and "outcome" after; recovery treats started-without-outcome as
  `needs_review`. This is why the audit log is append-only NDJSON.
- **Time math**: all persisted timestamps ISO-8601 UTC; working-hours checks
  convert using the profile's configured timezone (default to the machine's).

## Explicitly out of scope for this plan

Hosted auth/Postgres, agent pairing and WSS, Windows installer,
multi-profile Chrome orchestration, Sales Navigator scrolling/pagination,
analytics, CSS consolidation. Start these only after Phase 8 passes.
