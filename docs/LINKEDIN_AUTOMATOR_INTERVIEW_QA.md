# LinkedIn Automator: Interview Questions and Answers

> Companion to `LINKEDIN_AUTOMATOR_INTERVIEW_GUIDE.md`.
>
> The short answer under each question is suitable for speaking in an interview. The supporting detail is there for follow-up questions. Do not claim that planned features are complete.

## How to use this file

1. Learn the short answer, not the exact wording.
2. Be ready to draw the architecture and both state machines.
3. Support claims with one concrete file, data field, test, or failure case.
4. Say what is not implemented. Honest boundaries make the implemented work more credible.
5. For deep questions, explain the invariant first and the code mechanism second.

## Project overview

### 1. Tell me about the project.

**Short answer:** LinkedIn Automator is a local-first campaign orchestration tool built with React, TypeScript, Node.js, and Chrome DevTools Protocol. It lets a user manage isolated LinkedIn profiles, define lead workflows, dry-run them, send explicitly approved live messages one profile at a time, preserve schedules across pauses or restarts, detect replies, and analyze outcomes.

The part I am most proud of is the execution model. A campaign becomes a frozen run snapshot, every lead follows a state machine, state is written atomically, actions are audited, and uncertain sends stop for review instead of being retried blindly.

### 2. What was the hardest problem?

**Short answer:** The hardest problem was not DOM clicking; it was knowing whether an irreversible action actually happened. Browser pages can change or respond late, so the runner verifies the recipient and exact draft before Send, then requires evidence after the click. If the result is ambiguous, it does not retry.

That combines browser inspection, idempotency, state recovery, and product safety.

### 3. Why is this more than a script?

**Answer:** A script usually runs a linear list of commands in memory. This project has persistent profiles, editable campaign definitions, frozen execution snapshots, run and lead state machines, durable deadlines, explicit control operations, audit events, safety gates, reports, and recovery after process interruption. It is a small workflow engine with a browser adapter.

### 4. Who is the intended user?

**Answer:** The current version is a local single-user prototype for controlled outreach testing. It is designed for someone who wants visibility and human approval rather than an opaque high-volume automation service.

### 5. What is the main design principle?

**Answer:** Fail closed when evidence is insufficient. It is better to stop and ask for review than to send a duplicate or message the wrong person.

### 6. What is actually live today?

**Answer:** Message-only live campaigns are implemented. The runner can enter from a lead's main profile Message button, compose, verify, send, and confirm. Live connection-request sending is intentionally blocked; that path currently supports dry-run classification only.

### 7. What is a dry run?

**Answer:** A dry run performs navigation, page classification, identity/template resolution, workflow progression, and auditing without performing the irreversible Send action. It validates the campaign and browser assumptions. A `dry_run_ok` result means "would send," not "delivered."

### 8. Why is dry run the default?

**Answer:** Browser automation has external uncertainty. Defaulting to rehearsal lets the user catch invalid URLs, wrong variables, login problems, and layout changes before authorizing a live campaign.

## Architecture

### 9. Describe the architecture.

**Short answer:** React is the control plane, a loopback Node server is the execution plane, and Chrome is the external system controlled through CDP. The frontend stores editable definitions locally and sends a frozen snapshot to a profile-specific Node runner. The runner persists state and audits around every browser action.

```text
React UI -> HTTP API -> profile runtime -> runner -> CDP -> Chrome -> LinkedIn
                         |                 |
                         |                 +-> action evidence
                         +-> state.json + audit.log
```

### 10. Why split React and Node?

**Answer:** React pages are ephemeral. They reload, unmount, and close. A campaign runner needs process-level ownership, filesystem persistence, Chrome process control, and a lifecycle independent of UI components. Node supplies that boundary.

### 11. Why does the server run only on `127.0.0.1`?

**Answer:** It controls a logged-in browser and exposes powerful local actions, so it should not be network-accessible by default. Loopback reduces attack surface. A remotely deployed version would require authentication, authorization, TLS, secrets management, and a different browser-worker design.

### 12. How does development startup work?

**Answer:** `npm run dev` starts Vite on port 5173. A Vite plugin starts `node --watch server/index.js`, and Vite proxies `/api` requests to the Node controller on port 4287.

### 13. Why use a custom Node HTTP server instead of Express?

**Answer:** The API is small enough that Node's built-in HTTP module keeps the local controller dependency-light. For a larger product, I would adopt a framework for schemas, middleware, observability, and consistent error handling.

### 14. Where are the domain boundaries?

**Answer:** The UI owns editable account and campaign definitions. The controller owns active execution. `runModel.js` owns pure state rules, `runStore.js` owns durability, `safetyPolicy.js` owns eligibility, browser/session modules own CDP, and action executors own LinkedIn-specific behavior.

### 15. Why are pure modules important here?

**Answer:** Time math, state transitions, validation, safety caps, analytics, and CSV formatting can be tested deterministically without Chrome. Only the thin action/session layer needs the external browser.

## Campaign and run modeling

### 16. What is the difference between a campaign and a run?

**Answer:** A campaign is an editable definition in frontend storage. A run is a durable execution instance made from a frozen campaign, action, lead, safety, profile, and mode snapshot. One campaign can have many historical runs.

### 17. Why freeze a run snapshot?

**Answer:** It makes execution reproducible and auditable. Otherwise a user editing a message while a run is active could change behavior halfway through without a reliable record of what was authorized.

### 18. Why does each lead have its own state?

**Answer:** Leads progress independently. One may be waiting for acceptance, another waiting for a delay, another replied, and another need review. A campaign-level boolean cannot represent those conditions safely.

### 19. What run states exist?

**Answer:** `validating`, `queued`, `running`, `sleeping`, `paused`, `stopping`, `stopped`, `completed`, `failed`, and `needs_attention`.

### 20. What lead states exist?

**Answer:** `queued`, `running`, `waiting_acceptance`, `waiting_delay`, `replied`, `completed`, `failed`, `needs_review`, and `stopped`.

### 21. What is `actionCursor`?

**Answer:** It is the index of the next executable workflow action for that lead. Helper functions skip automatic guard cards, so the runner executes only connection-request and message actions while still modeling acceptance and reply guards.

### 22. How do you prevent illegal state changes?

**Answer:** All lead mutations go through the pure `transition()` function. Each event asserts its allowed source states and throws on an illegal transition. That centralizes invariants instead of spreading status assignments across the runner.

### 23. What is an action attempt?

**Answer:** It records the action ID, attempt number, start/completion times, outcome, error code, and details. An attempt starts before browser work and completes only after an observed result.

### 24. How are automatic workflow guards represented?

**Answer:** Adding a connection action also adds `wait_for_acceptance`; adding a message adds `reply_check`. They must immediately follow their parent. Removing the parent removes its guard, and run validation rejects unattached guards.

### 25. How do campaign batches work?

**Answer:** Selected campaign snapshots are validated together. The first starts if the profile is idle and the rest are persisted as queued runs with batch IDs and positions. When one reaches a terminal state, the runner selects the next queued run in deterministic order.

### 26. Can two campaigns run on the same profile simultaneously?

**Answer:** No. Each profile runner has one `activeRunId`. This prevents campaigns from competing for the same account's browser and messaging UI. Extra campaigns queue.

### 27. Can two different profiles run simultaneously?

**Answer:** Yes. Each profile has a separate runtime, browser, port, and active-run slot. The current code does not yet enforce a global maximum across profiles, which is a scalability and safety improvement I would add.

## Scheduling, pause, and recovery

### 28. How is a one-hour follow-up delay represented?

**Answer:** As an absolute ISO deadline: `dueAt = anchorAt + 3,600,000 ms`. The lead stores it in `nextEligibleAt`. The runner calculates `max(0, dueAt - now)` whenever it needs to wait.

### 29. Why use an absolute time instead of storing remaining minutes?

**Answer:** Absolute time survives UI closure, process restarts, and pauses. Remaining duration would need careful continuous persistence and can reset accidentally. A timestamp is also directly inspectable in the run state.

### 30. What anchors a follow-up delay?

**Answer:** If a message follows an accepted connection, `acceptedAt` is the anchor. Otherwise the anchor is the completion time of the previous non-automatic action.

### 31. What happens if I reopen after 30 minutes of a one-hour delay?

**Answer:** The stored deadline is still 30 minutes in the future, so the runner waits approximately 30 more minutes. It does not restart the hour.

### 32. What happens if I reopen after three hours?

**Answer:** The deadline is overdue, so the lead is immediately eligible. "Immediately" still means subject to working hours, rolling caps, batch cooldown, and pacing.

### 33. Does pausing freeze time?

**Answer:** No. Pause blocks execution but does not shift the absolute due date. When resumed, the runner compares the current time against that date. This was an explicit product choice.

### 34. What happens if a pending delay is edited?

**Answer:** Resume can submit the current workflow actions. The controller recomputes pending due dates from the original anchor and records `workflow_delay_updated` events. Reducing the delay below elapsed time makes it due; increasing it extends the remaining time.

### 35. How do you avoid applying the same delay twice?

**Answer:** Each lead stores `delaysSatisfiedActionIds`. When a delay elapses, that action ID is recorded, and `followUpSchedule()` will not schedule it again.

### 36. What happens when the browser tab closes?

**Answer:** The frontend is not the source of truth, so closing only the React tab does not reset run state. The Node controller can keep running. Reopening the UI fetches active/profile runs and reattaches to their state.

### 37. What happens when the Node controller stops?

**Answer:** No automation occurs while it is offline. State and audit files remain. On restart, profile runtimes scan their run stores and recover resumable runs using stored timestamps.

### 38. What if the controller dies during a Send attempt?

**Answer:** A lead with an attempt started but no recorded outcome becomes `needs_review`. The system cannot know whether the irreversible click happened, so it refuses automatic replay.

### 39. How responsive are pause and stop during long waits?

**Answer:** Sleeps are sliced into at most five-second waits and expose a control wake callback. A pause or stop wakes the loop instead of waiting for the full workflow delay or cooldown.

### 40. What is the difference between pause and stop?

**Answer:** Pause is an execution hold that preserves the run and resumes directly. Stop finalizes the current execution state, but a stopped run with resumable leads can be deliberately restarted. Both are checked before Send.

## Chrome and CDP

### 41. Why use Chrome DevTools Protocol?

**Answer:** CDP provides browser-native navigation, DOM evaluation, text insertion, mouse events, tab management, and lifecycle signals while keeping a visible real Chrome session. It also lets the app reuse a persistent profile and existing LinkedIn login.

### 42. Why not use LinkedIn's internal APIs?

**Answer:** They are undocumented/private and would couple the app to hidden network contracts and potentially inappropriate access. This prototype interacts with the visible website and bases outcomes on visible page evidence.

### 43. Why not just use Selenium or Playwright?

**Answer:** They are valid alternatives. Direct CDP was chosen to learn and control the lower-level session, event, and input primitives and to integrate with an existing local Chrome profile. For production testability and selector tooling, Playwright would likely be valuable above or beside the current browser layer.

### 44. How is a CDP port selected?

**Answer:** The pool first checks Chrome's active-port file, then a remembered per-profile port, then scans a bounded range from the configured base. It avoids ports claimed by another profile, verifies CDP responsiveness, and checks that the machine can bind the port. It records the actual port Chrome uses.

### 45. Why does every profile need a different Chrome data directory?

**Answer:** Chrome cookies, local state, login challenges, and account identity live in the user-data directory. Sharing it would mix sessions and Chrome may also lock the folder. Isolation prevents one logical account from controlling another account's LinkedIn session.

### 46. How do you prevent duplicate browser launches for the same profile?

**Answer:** The browser pool keeps both a browser map and an in-progress creation map. Concurrent callers await the same creation promise rather than starting separate processes.

### 47. How does browser navigation work?

**Answer:** The session attaches to a tab over CDP, enables relevant domains, sends navigation commands, waits for load/lifecycle completion with timeouts, and exposes typed `evaluate`, `insertText`, and `clickAt` helpers.

### 48. Why keep Chrome visible?

**Answer:** Visibility supports human supervision and debugging, and this project is not trying to hide automation. When a result needs review, the runner can leave the exact profile tab open.

## Message execution

### 49. Walk me through sending one message.

**Short answer:** The runner opens the lead's profile, finds the main profile Message action, reads the visible profile name, renders the template, opens the expected recipient's composer, refuses to overwrite another draft, inserts the text, reads it back for an exact match, rechecks pause/stop, clicks Send, and waits for evidence that the expected outgoing message appeared.

### 50. How do you know the correct first name?

**Answer:** Before rendering a live message, the executor reads the visible `h1` on the profile page and splits the display name. It does not derive the name from the URL slug. The document title is only a fallback.

### 51. How do you ensure you click the profile's Message button?

**Answer:** The page evaluator searches visible controls in the main profile area using text/ARIA semantics and viewport position. It starts from the profile page, scrolls to the top, waits for hydration, and labels the matched surface `profile_main_action`. It does not begin from the feed's global messenger button.

### 52. Why wait before clicking Message?

**Answer:** LinkedIn hydrates controls asynchronously and can shift layout after navigation. The executor waits for page hydration and then has an additional six-second profile settle period, reducing stale or misplaced click targets.

### 53. What happens if clicking Message does not open the composer?

**Answer:** It makes up to two controlled attempts and inspects the messaging surface after each. If the expected recipient composer still does not appear, it records an element/layout failure, moves the lead to review, and leaves the profile tab open.

### 54. How are line breaks and spaces preserved?

**Answer:** The rendered string is inserted through CDP, then the contenteditable text is read back and compared exactly with the expected template before Send is enabled. A mismatch prevents the click.

### 55. What if the composer already contains a draft?

**Answer:** If it is exactly the prepared campaign text, the runner can continue. If it is different, the runner leaves it untouched and marks the action `needs_review` rather than deleting someone's draft.

### 56. How do you know a message was sent?

**Answer:** Before clicking, the executor records how many matching outgoing messages are visible. After clicking, it waits up to twelve seconds for authoritative conversation evidence, including an increased matching count and sent-message indicators. Only then does it record `message_sent`.

### 57. Why not retry when confirmation is missing?

**Answer:** Because Send was already clicked. Missing confirmation could mean a delayed UI update rather than a failed send. Retrying could duplicate the message, so the outcome is ambiguous and requires human review.

### 58. What retries are safe?

**Answer:** Only failures proving Send was not clicked, such as a missing Message element or exact composer-text mismatch, plus a narrowly defined reply-check ambiguity. Retry eligibility is encoded explicitly rather than inferred from every generic error.

### 59. How are duplicate sends prevented across runs?

**Answer:** Before a live run starts, the controller searches prior runs from the same campaign for attempts where the same normalized lead URL and message action ID have a confirmed `sent` outcome. Matching lead/action deliveries block the new live run.

### 60. Is duplicate protection perfect?

**Answer:** It is strong within retained local run history and stable campaign/action IDs. It would not cover deleted history, another installation, manual LinkedIn sends, or a cloned action with a new ID. Production-grade idempotency would use a durable profile-wide delivery key and reconciliation.

## Acceptance and replies

### 61. How does the app know a connection was accepted?

**Answer:** It revisits the profile and looks for semantic evidence: a first-degree marker or a main-profile Message control. A Pending control means it is still waiting, while Connect means it is not a confirmed connection. Unclear states stop for review.

### 62. How often is acceptance rechecked?

**Answer:** The current runner defers the lead for one hour between acceptance checks.

### 63. How does reply detection work?

**Answer:** A confirmed outgoing message becomes the baseline. The scanner reopens the person's profile conversation, reads messages, and looks for an incoming message after that baseline. It records the reply text, observation time, and external message ID when available.

### 64. Why does reply detection need a baseline?

**Answer:** Without a known campaign message and send time, an old conversation reply could be falsely attributed to the campaign. The baseline narrows causality.

### 65. What happens after a reply?

**Answer:** The lead moves to terminal `replied`, `nextEligibleAt` is cleared, and later follow-ups stop. The audit event feeds campaign outcomes, reports, and the notification panel.

### 66. How often are replies checked?

**Answer:** When the profile Chrome is connected, the UI schedules an initial check after about 1.5 seconds and then every two minutes. The server throttles non-forced checks to once per minute and skips scanning while that profile's runner is busy.

### 67. Why might a reply not appear immediately?

**Answer:** The controller may be offline, Chrome may be disconnected, the profile runner may be busy, the poll interval may not have elapsed, no confirmed campaign baseline may exist, or LinkedIn's DOM may not expose a reliably classifiable incoming message.

### 68. How are reply notifications deduplicated?

**Answer:** Prefer the external LinkedIn message ID. If unavailable, use a campaign/lead/time composite. The seen timestamp is stored per profile, so opening one profile's notifications does not mark another profile's replies read.

## Safety and rate limiting

### 69. What safety controls exist?

**Answer:** Working hours, a rolling total-action limit, a rolling connection-request limit, randomized inter-action delay, batch size and cooldown, explicit live authorization, sequential per-profile execution, duplicate detection, and pause-on-reply behavior.

### 70. How does a 24-hour working window work?

**Answer:** Equal start and end times mean always allowed. Different times support both same-day and overnight windows using the configured IANA time zone.

### 71. Is the daily limit reset at midnight?

**Answer:** No. It is a rolling 24-hour window based on successful audit entries. This is less sensitive to midnight bursts and survives process restarts.

### 72. How is the next cap-reset time calculated?

**Answer:** The oldest matching successful action in the rolling window determines when capacity returns. The runner sleeps until 24 hours plus one second after that event.

### 73. Does "send now" bypass safety controls?

**Answer:** No. It only means no workflow-level delay for that message. Working hours, caps, cooldown, and randomized pacing still apply.

### 74. Are limits profile-wide?

**Answer:** Not fully today. The safety snapshot is attached to the run, and cap counting uses that run's audit entries. A production improvement is a profile-level action ledger shared by all campaigns for that account.

### 75. Why randomize inter-action delay?

**Answer:** It avoids mechanical fixed timing and creates conservative pacing. It is a safety feature, not a claim that automation becomes undetectable or platform-approved.

## Multi-profile design

### 76. What is a profile runtime?

**Answer:** A profile runtime is the bundle of one browser session, one profile-specific run store, and one runner closure. Its active run, pause wake handle, auth cache, and reply-check throttle are not shared with other profiles.

### 77. How are profile folder names made safe?

**Answer:** The ID is length-validated, lowercased and sanitized to safe characters, truncated, and suffixed with the first eight hexadecimal characters of a SHA-1 digest of the original ID. The hash avoids collisions between IDs that sanitize similarly.

### 78. Why is SHA-1 acceptable there?

**Answer:** It is used as a short deterministic collision discriminator, not for passwords, signatures, or adversarial security. A cryptographic security property is not being relied upon.

### 79. How did you migrate from one profile to many?

**Answer:** The migration identifies which profile owns the legacy browser using historical run profile IDs, records that ownership, and copies the old Chrome and matching run data into the new isolated folder. It leaves legacy data untouched for rollback.

### 80. Why copy instead of move?

**Answer:** A Chrome profile contains valuable login and device-verification state. Copying makes migration recoverable and avoids destructive data loss before the new session is verified.

### 81. How do you avoid giving a new account the old login?

**Answer:** The legacy owner is inferred from run history and recorded once. Migration only gives the old Chrome data to that owner rather than whichever account happens to open first.

### 82. What if a stored profile folder is malformed?

**Answer:** Startup reads `profile.json` and initializes only usable profile IDs. Junk folders without a real ID, including old `undefined` or `null` cases, are ignored.

## Persistence and observability

### 83. What data is in `localStorage`?

**Answer:** The local company-user record, LinkedIn account list, editable campaigns, global safety preferences, and per-profile reply-notification seen times.

### 84. What data is on disk?

**Answer:** Chrome user data, profile/session metadata, per-run `state.json`, and per-run append-only `audit.log` files under `.local/profiles`.

### 85. Why use both state and an event log?

**Answer:** State provides fast recovery of the latest truth. The event log explains how the system reached it and supports analytics, debugging, and safety counting. Rebuilding everything from events would add complexity; storing only state would lose history.

### 86. How is state written safely?

**Answer:** The store writes complete JSON to a uniquely named temporary file and atomically renames it to `state.json`. Readers see either the old complete file or the new complete file, not a partially written document.

### 87. What is in an audit event?

**Answer:** Timestamp, run ID, lead ID, action ID, attempt number, event, outcome, stable error code, and structured detail.

### 88. Why NDJSON?

**Answer:** Each event is one appendable JSON line. It is human-inspectable, streamable, tolerant of large histories, and simple for a local prototype.

### 89. What is the downside of filesystem storage?

**Answer:** Cross-process locking, query performance, indexes, migrations, backups, retention, and multi-device sync are limited. SQLite would be a strong next local step; PostgreSQL would fit a hosted scheduler.

### 90. What happens if browser `localStorage` is cleared?

**Answer:** Editable profiles/campaign definitions and preferences can disappear while server-side run history remains. That split is current technical debt and a reason to consolidate persistence.

## Leads and CSV

### 91. What lead URLs are supported?

**Answer:** Standard LinkedIn `/in/...` profiles and Sales Navigator `/sales/lead/...` links. Input is normalized to HTTPS `www.linkedin.com`, trailing punctuation is removed, and duplicate URLs are collapsed.

### 92. How is lead data enriched?

**Answer:** The profile Chrome opens the requested LinkedIn pages and reads available visible identity and employment information from the rendered DOM. The frontend merges successful results into its lead records.

### 93. Why was the company missing from an earlier CSV?

**Answer:** A URL-only lead initially has no company field. The export was improved to refresh profile identity before generating CSV and include both current company text and company LinkedIn URL when the page exposes them. Data can still be absent if LinkedIn does not render it or the selector cannot identify it.

### 94. How do you split location?

**Answer:** It is a deterministic comma-based heuristic. One component becomes city; two become city/country; three or more use the last two as state/country and join the rest as city. The original location is always preserved because global address formats are not uniform.

### 95. How is CSV made compatible with CRMs and spreadsheets?

**Answer:** It has stable headers, CRLF rows, a UTF-8 BOM, and RFC-style escaping for commas, quotes, and newlines. It includes campaign/source provenance in addition to contact fields.

### 96. What fields are exported?

**Answer:** IDs, names, title/headline, company, personal/company/Sales Navigator URLs, raw and split location, industry, contact fields when visible, about, degree, public ID, campaign, status, source, and added time.

## Analytics and UI outcomes

### 97. How are campaign outcomes calculated?

**Answer:** The frontend scans attempts across that campaign's runs, deduplicates leads by LinkedIn URL, and derives the latest invited, accepted, messaged, replied, and failed record for each person.

### 98. What happens when I click an outcome number?

**Answer:** Hash routing opens that campaign's Leads tab with an outcome filter, and the UI renders the corresponding person records with event detail.

### 99. How are report metrics calculated?

**Answer:** The controller reads tracked audit events from live runs, filters by profile/campaign/date in the selected time zone, deduplicates, fills missing dates with zero totals, and aggregates invitations, acceptances, messages, and replies.

### 100. How are acceptance and reply rates calculated?

**Answer:** Acceptance rate is accepted divided by invitations sent; reply rate is replies divided by messages sent. A zero denominator produces zero rather than `NaN` or infinity.

### 101. Why can the campaign list and report show different invitation counts?

**Answer:** The campaign-list derivation currently treats `dry_run_ok` connection actions as invited outcomes, while analytics only reads tracked events from live runs. This is a known semantic inconsistency; I would relabel dry outcomes as "would invite" or exclude them from delivered metrics.

### 102. How does the chart handle many dates and zero values?

**Answer:** Chart scale and tick generation are pure tested functions. The API fills absent days, visible series can be toggled, and hover hit areas show exact values without relying only on bar size.

### 103. Why use polling for UI updates?

**Answer:** For a local single-user system, polling is simple and dependable. Campaign lists poll more quickly in live states and less often while idle; workspaces poll active runs roughly every four seconds. I would use server-sent events for a larger system.

## Validation and errors

### 104. What is validated before a run starts?

**Answer:** Campaign identity, executable actions, guard adjacency, template variables, message delays, included leads and LinkedIn URLs, safety values, live workflow type, and exact live authorization scope.

### 105. What is the difference between `failed` and `needs_review`?

**Answer:** `failed` means the system has a confident negative result. `needs_review` means the external outcome or layout is uncertain and human judgment is required. The containing run becomes `needs_attention` for the latter.

### 106. Why use stable error codes?

**Answer:** UI text can change, but control flow, tests, diagnostics, and analytics need stable machine-readable categories such as `ELEMENT_NOT_FOUND`, `AUTH_CHALLENGE`, or `AMBIGUOUS_OUTCOME`.

### 107. How do you handle LinkedIn layout changes?

**Answer:** Selectors favor visible semantics and are centralized where possible. Unknown layouts stop rather than clicking optimistically, and sanitized page snippets/details are recorded for diagnosis. The long-term solution is versioned strategies and fixture-based browser tests.

### 108. How does the API avoid "Endpoint not found" confusion?

**Answer:** Frontend API helpers call explicit controller routes and robustly parse empty, invalid, and error responses. The server returns structured JSON errors. The app still depends on the controller and Vite proxy being started correctly.

## Testing and engineering process

### 109. How did you test the project?

**Answer:** The current suite has 17 Vitest files and 104 passing tests. It concentrates on pure high-risk logic: transitions, recovery, scheduling, safety, duplicate delivery, profile isolation, port allocation, analytics, routing, CSV, notifications, and message classification. TypeScript plus the Vite production build provide an additional integration check.

### 110. What commands verify it?

```powershell
npm test
npm run build
```

At the time these interview documents were created, both passed.

### 111. What would you test next?

**Answer:** Controlled browser end-to-end tests. I would capture representative profile and composer fixtures, serve them in a deterministic harness, drive the CDP adapter, and test recipient matching, draft preservation, Send confirmation, overlays, delayed hydration, and changed markup.

### 112. How do you test time-dependent behavior?

**Answer:** Core functions accept `Date`, time zone, or random-function dependencies. Tests supply fixed clocks and deterministic random values to cover midnight, overnight windows, rolling 24-hour expiry, and delay recalculation.

### 113. How do you test multi-profile isolation?

**Answer:** Tests create temporary profile roots and dependency-injected browser/session factories, request profiles concurrently, verify unique paths and ports, verify creation coalescing, and ensure releasing one profile does not stop another.

### 114. What does the Git history demonstrate?

**Answer:** The project was developed incrementally with small feature and fix commits: execution state, browser behavior, messaging evidence, campaign controls, reporting, and multi-profile migration each have reviewable history. That made regressions easier to isolate.

## Security and ethics

### 115. Is the local sign-in secure authentication?

**Answer:** No. It is a local workspace UI record in `localStorage`. I would never present it as a security boundary. Production authentication needs hashed credentials or an identity provider, secure sessions, and server-side authorization.

### 116. What sensitive data exists?

**Answer:** Chrome cookies and login state, lead profile data, message templates/text, replies, run history, and audit details. Profile directories should be protected by OS permissions and excluded from source control.

### 117. Does automation comply with LinkedIn's terms?

**Answer:** LinkedIn restricts automation and scraping. This repository is a controlled local engineering prototype, not evidence of LinkedIn approval. Any real use requires a current legal/platform-policy review, consent and privacy controls, conservative limits, and potentially a different approved integration.

### 118. Why include safety controls if automation may still be restricted?

**Answer:** Safety engineering remains necessary for controlled testing and demonstrates responsible system design, but it does not override platform rules. Rate limits and human approval reduce risk; they do not create permission.

### 119. Could another local process call the API?

**Answer:** Yes, in the current threat model a local process can reach the loopback controller. A hardened version should authenticate commands, use OS IPC or scoped tokens, protect audit data, and validate origins.

### 120. How is path traversal prevented?

**Answer:** Profile IDs are validated and transformed into sanitized, hashed folder names. Run IDs accept only alphanumeric characters, underscores, and hyphens before being joined into filesystem paths.

## Tradeoffs and improvement questions

### 121. Why not use a database now?

**Answer:** JSON state and NDJSON logs kept the local prototype transparent and dependency-light while validating workflow semantics. Once querying, cross-run limits, migrations, or concurrent workers matter, SQLite is the natural local upgrade.

### 122. What would you change first for production?

**Answer:** I would consolidate data into a transactional store and create a profile-wide action ledger with idempotency keys. That fixes the largest consistency gaps: split storage, per-run caps, and duplicate protection tied only to retained run files.

### 123. How would you scale to many profiles?

**Answer:** Separate scheduling from browser workers. Persist jobs in a database, lease one job per profile, cap organization-wide concurrency, heartbeat workers, isolate secrets, and stream events. A profile remains a serialization key because one account should not have competing actions.

### 124. How would you make the scheduler distributed?

**Answer:** Store due timestamps and states transactionally, select due work with row locking or leases, attach idempotency keys to actions, renew worker heartbeats, and recover expired leases. Never use an in-memory timeout as the source of truth.

### 125. How would you improve selector resilience?

**Answer:** Use a layered strategy: accessibility role/name first, stable href/data semantics second, structural fallback third. Version strategies, record sanitized failure fixtures, test multiple locales/layouts, and require outcome evidence after every action.

### 126. How would you support localization?

**Answer:** Avoid hard-coded English text where roles or URL semantics suffice, add locale-specific label maps, detect active locale, and validate selectors against fixtures for supported languages. Current English text matching is a limitation.

### 127. How would you improve notifications?

**Answer:** Move reply scanning into the controller scheduler instead of relying on an open UI, persist notification records server-side, use server-sent events, and add backoff plus per-profile scan cursors.

### 128. How would you improve analytics accuracy?

**Answer:** Define one event taxonomy for real versus simulated outcomes, use stable delivery/event IDs, record source timestamps separately from observation timestamps, and aggregate from a profile-level event ledger. Dry-run events should never enter real-delivery totals.

### 129. How would you support deletion and privacy requests?

**Answer:** Add profile/campaign/run retention policies, redact message bodies where not needed, encrypt sensitive local data, provide deterministic export/deletion operations, and ensure audit requirements are balanced with data minimization.

### 130. What technical debt would you mention proactively?

**Answer:** Outdated README claims, global frontend safety settings, per-run rather than profile-wide caps, split storage, disabled live invitations, dry-run invitation labeling, no global profile concurrency cap, a prototype-specific account migration, and missing controlled browser E2E tests.

## Scenario questions

### 131. LinkedIn opens the profile but the Message button is missing. What happens?

**Answer:** The page is classified, the executor waits for hydration, and if no visible main-profile Message control appears it records `ELEMENT_NOT_FOUND`, puts the lead in `needs_review`, puts the run in `needs_attention`, and leaves the tab open for inspection.

### 132. The message was typed but Send stayed disabled. What happens?

**Answer:** The executor reads the composer back, waits for a valid send point, and does not click if the control never becomes available. It records a reviewable pre-send failure, which may be safely retryable because Send was not clicked.

### 133. Send was clicked, then the network stalled. What happens?

**Answer:** If no authoritative confirmation appears within the timeout, the outcome becomes ambiguous. The run stops for review and will not automatically retry that send.

### 134. There is already a personal draft in the conversation. What happens?

**Answer:** It is preserved. Unless it exactly matches the campaign message, the automation refuses to overwrite or send it.

### 135. A lead replies before the next follow-up is due. What happens?

**Answer:** A reply check compares incoming messages with the sent baseline, marks the lead `replied`, clears its deadline, and no further action is selected for that lead.

### 136. The user pauses five seconds before Send. What happens?

**Answer:** The executor checks `pauseRequested` immediately before the click. It returns a paused result, completes the in-progress attempt as paused, and requeues the lead without sending.

### 137. Two Start requests arrive at once for the same profile. What happens?

**Answer:** The profile runner's active-run guard allows only one active run. Batch APIs create an explicit queue; conflicting direct starts receive an active-run error.

### 138. Two API calls request the same profile runtime at once. What happens?

**Answer:** Runtime creation is coalesced through an in-progress promise map, so both calls receive the same initialized runtime.

### 139. Two profile IDs sanitize to the same text. What happens?

**Answer:** Their SHA-1 digest suffixes differ, so the physical folders remain distinct.

### 140. The configured CDP port is occupied by an unrelated process. What happens?

**Answer:** The pool checks whether CDP responds and whether the port is bindable, then scans for another usable port rather than assuming that any occupied port belongs to the right Chrome.

### 141. The user changes a campaign while it is running. Does the active message change?

**Answer:** No. The run uses its frozen snapshot. Pending delays can be deliberately updated during resume, with audit events, but templates and lead scope do not silently mutate mid-run.

### 142. The UI reports a run after a refresh. Where did it get the state?

**Answer:** It queries the profile-aware active/list run endpoints. The controller reads the durable profile run store and decorates the run with summary counts.

### 143. A run reaches its daily limit. Does it fail?

**Answer:** No. It enters `sleeping` with a reason and absolute wake time. When the oldest counted action leaves the rolling 24-hour window, it can continue.

### 144. Working hours are configured 22:00 to 06:00. Is that invalid?

**Answer:** No. The safety policy recognizes it as an overnight window. At 23:00 or 05:00 it is allowed; at noon it sleeps until 22:00 in the configured time zone.

### 145. Working-hours start and end are both 00:00. What does that mean?

**Answer:** Equal times mean a 24-hour allowed window, not a zero-length window.

### 146. A campaign has an unknown `{school}` variable. What happens?

**Answer:** Validation rejects the snapshot with an unknown-template-variable error before execution.

### 147. One lead has an invalid host such as `example.com/in/name`. What happens?

**Answer:** URL validation rejects it. Supported URLs must be on LinkedIn and match a profile or Sales Navigator lead path.

### 148. A live run includes a connection-request action. What happens?

**Answer:** Live validation blocks the run because complete live execution currently supports message-only workflows. The connection executor itself also refuses non-dry mode.

### 149. Why might a user's GitHub contribution count not equal the number of commits?

**Answer:** GitHub counts qualifying commits, not every local commit. Commits must be pushed to the repository's default or `gh-pages` branch, use an email associated with the account, and meet repository/fork visibility rules. Multiple commits can also appear after GitHub processes them rather than immediately.

### 150. What is one bug you found through real usage?

**Answer:** The early messaging path could open a profile/composer but fail to send consistently. The fix was not just another selector: the flow was redesigned to start from the main profile action, wait for hydration, identify the expected recipient, verify exact composer text, locate an enabled send point, confirm delivery afterward, and retain the tab when diagnosis is needed.

## Behavioral and ownership questions

### 151. How did requirements evolve?

**Answer:** It began as campaign UI and a single browser controller. Real tests exposed missing execution, ambiguous clicks, timing across closures, reply tracking, reporting, and multi-account isolation. I evolved the architecture incrementally instead of pretending the original prototype already solved those problems.

### 152. Describe a decision where you prioritized safety over speed.

**Answer:** After Send is clicked, missing confirmation does not trigger a retry. That may require manual work, but it prevents duplicate outreach. The same principle preserves unknown drafts and blocks live invitations until their evidence path is verified.

### 153. How did you debug browser failures?

**Answer:** I separated each stage into observable evidence: page classification, matched control, composer opening attempt, recipient, exact draft, send point, and final confirmation. Structured audit details and leaving a failed profile tab open made real-page behavior inspectable.

### 154. What would you do differently if starting again?

**Answer:** I would establish the server-side event/state model and profile isolation earlier, then build UI on top of those contracts. I would also build controlled LinkedIn-like fixtures before tuning live selectors.

### 155. What did this project teach you?

**Answer:** Browser automation is a consistency problem as much as a UI problem. Durable deadlines, idempotency, evidence, recovery, and isolation matter more than how quickly a selector can click a button.

### 156. What part did you personally own?

**Answer template:** Be precise about your actual contribution. A strong structure is: "I owned the product flow and implementation across the React campaign UI, Node runner, CDP action logic, persistence, multi-profile isolation, tests, and iterative debugging. I used development tools and AI assistance where appropriate, but I made and validated the architecture and behavior decisions."

Do not claim work you cannot explain at code level.

## Whiteboard prompts

### 157. Draw the runner loop.

```text
load -> controls -> auth -> reconcile time -> select lead
  ^                                            |
  |                                            v
persist <- transition <- audit <- execute <- safety
  |
  +-> sleep/pause/queue/complete
```

Explain that every arrow crossing an external action is surrounded by persistence and evidence.

### 158. Draw the multi-profile model.

```text
profile A -> folder A -> Chrome A : port A -> runner A -> runs A
profile B -> folder B -> Chrome B : port B -> runner B -> runs B
```

The profile ID is the partition key across HTTP, storage, browser, runner, and analytics.

### 159. Draw the time calculation.

```text
anchorAt + configuredDelay = dueAt
remaining = max(0, dueAt - now)
eligible = remaining == 0 && safetyGateAllows(now)
```

### 160. Draw the message safety boundary.

```text
profile -> recipient -> draft exact -> Send available
                                      |
                               irreversible click
                                      |
                           authoritative confirmation
                                      |
                             sent OR needs_review
```

## Rapid-fire answers

### 161. Frontend language?

TypeScript with React 18.

### 162. Backend language?

Modern JavaScript ES modules on Node.js.

### 163. Browser protocol?

Chrome DevTools Protocol over WebSocket.

### 164. UI state persistence?

Browser `localStorage`.

### 165. Run persistence?

Atomic JSON state plus append-only NDJSON audit files.

### 166. Default UI port?

5173.

### 167. Default controller port?

4287.

### 168. Default base CDP port?

9223, with per-profile allocation.

### 169. Test framework?

Vitest.

### 170. Current verified test count?

104 tests in 17 files at the document review point.

### 171. Live connection requests?

No; controlled dry run only.

### 172. Live messages?

Yes, for explicitly confirmed message-only campaigns.

### 173. One active campaign globally?

No. One active run per profile.

### 174. Is the app a background service?

No. The local Node controller and computer must be running.

### 175. Does pause reset a delay?

No. Absolute deadlines preserve elapsed time.

### 176. Does "send now" bypass limits?

No.

### 177. Does the first name come from the URL?

No. Live execution refreshes it from the visible profile heading.

### 178. Does it overwrite existing drafts?

No.

### 179. Does it retry an unconfirmed post-click send?

No.

### 180. Strongest production improvement?

A transactional profile-wide action ledger with durable idempotency keys.

## Questions to ask the interviewer

These turn the project discussion into a broader engineering conversation:

1. How does your team model idempotency around external side effects?
2. When do you prefer event logs plus materialized state over a purely event-sourced model?
3. How do your browser or integration tests handle third-party UI changes?
4. What is your approach to per-tenant serialization and global concurrency limits?
5. How do you decide which ambiguous failures are automatically retryable?
6. How are long-running jobs recovered after worker restarts?
7. What observability do you require before automating an irreversible workflow?

## Final answer framework

When a question surprises you, answer in this order:

1. **Invariant:** what must always remain true.
2. **Mechanism:** which state, timestamp, evidence, or isolation boundary enforces it.
3. **Failure behavior:** what happens when the system cannot prove the invariant.
4. **Tradeoff:** what complexity or limitation the choice introduces.
5. **Next step:** how you would improve it at production scale.

Example:

> The invariant is that one campaign action should not produce two messages. Before Send, I verify the expected recipient and exact composer text. After Send, I require conversation evidence and persist the result. If confirmation is missing after the click, I mark the lead for review and prohibit automatic retry. That sacrifices throughput for safety; at production scale I would add durable idempotency keys and reconciliation against a trusted event source.

That pattern works for nearly every deep question about this project.
