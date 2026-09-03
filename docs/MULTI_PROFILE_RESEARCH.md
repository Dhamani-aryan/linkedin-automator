# Multi-Profile Research: browser instances, session persistence, verification

Research date: September 2026. Sources are listed at the end; where a claim is a
community/vendor estimate rather than a documented fact, it says so inline.

## 0. Scope note on two-step verification

This document does **not** cover bypassing, defeating or automating past
LinkedIn's two-step verification, checkpoints or CAPTCHAs, and the
implementation must not attempt it. Circumventing an account security control is
off the table regardless of who owns the account.

The engineering answer is the same one a legitimate integration would give:

1. Make re-verification **rare**, by keeping each profile's browser state
   genuinely persistent and stable (§3).
2. When a challenge appears anyway, **detect it, stop that profile, and hand it
   to the human** who owns the account, then verify the session before resuming
   (§4).

That is also what LinkedIn-integration vendors do in public: Unipile's API
returns HTTP 202 with `checkpoint: {type: "2FA" | "OTP" | "IN_APP_VALIDATION" |
"CAPTCHA" | "PHONE_REGISTER"}` and gives the human a bounded window to solve it,
resuming via long-poll or webhook once the account clears.

---

## 1. What we have today (facts from this repo)

- `server/lib/browserSession.js` — module singletons `ownedChromeProcess`,
  `launchedAt`; fixed port `CHROME_REMOTE_DEBUGGING_PORT ?? 9223`; fixed
  directory `LINKEDIN_AUTOMATOR_CHROME_PROFILE ?? .local/chrome-profile`.
- Chrome is launched with `--remote-debugging-port`, `--user-data-dir`,
  `--no-first-run`, `--no-default-browser-check`, `--new-window`, and a URL.
  There is **no** `--profile-directory` (good — see §2).
- Transport is raw CDP over the HTTP endpoints `/json`, `/json/new`,
  `/json/close` plus a WebSocket `CdpSession` per tab with sequential command
  ids. Liveness is `fetch('http://127.0.0.1:9223/json')` with an 800 ms timeout.
- `checkLinkedInAuth` and `readConnectionPage` already classify pages by URL:
  `/login|authwall` -> `LINKEDIN_LOGGED_OUT`, `/checkpoint|challenge` or
  "security verification" -> `AUTH_CHALLENGE`.
- `server/lib/runner.js` has one global `activeRunId`, one `authCache`, and
  treats `AUTH_CHALLENGE` as a run-level pause (`needs_attention`).
- Controller restart marks interrupted runs `stopped`; nothing re-attaches to an
  already-running Chrome.

Two of these are already the right shape for multi-profile: URL-based auth
classification, and `AUTH_CHALLENGE` pausing rather than retrying.

---

## 2. Running several Chrome instances in parallel

### `--user-data-dir` is the isolation unit; `--profile-directory` is not

`--user-data-dir` is the root of everything Chrome stores for a launch: the
cookie database, Local Storage/IndexedDB, cache, extensions, and `Local State`
(which holds the key material used to encrypt saved cookies/passwords). Two
Chrome processes pointed at different `--user-data-dir` values share nothing.

`--profile-directory` only picks a subfolder (`Default`, `Profile 1`, ...)
*inside* one user-data-dir. Chrome holds a **singleton lock** on the
user-data-dir (`SingletonLock`/`SingletonCookie`/`SingletonSocket`): a second
launch against the same dir does not start a second process, it messages the
first one and **its `--remote-debugging-port` is silently ignored**. So one
debugging port cannot serve several isolated logins, and per-profile-directory
isolation cannot be driven independently over CDP. Reports also show that
combining `--user-data-dir` with `--profile-directory` can prevent Chrome from
writing `DevToolsActivePort` at all.

**Decision: one `--user-data-dir` per LinkedIn profile, one debugging port per
directory.** This is what the plan already says; the research confirms there is
no lighter alternative that actually isolates sessions.

### Chrome 136 (March 2025) — verified firsthand

`--remote-debugging-port` and `--remote-debugging-pipe` are **ignored when
debugging the default Chrome data directory**; they must be accompanied by
`--user-data-dir` pointing at a non-standard directory. The stated reason is
cookie theft via the debugging port. Failure mode is silent — Chrome starts, no
port opens.

Consequences for us: our custom directory already satisfies this, so nothing
breaks — but it also means **we can never drive the user's everyday Chrome
profile**, and each LinkedIn account must be logged in *inside* its own
automation directory, by hand, once.

### Ports, discovery and re-attach

- Probe liveness with `GET http://127.0.0.1:<port>/json/version`; a live
  instance returns JSON including `webSocketDebuggerUrl`. Our `/json` check is
  equivalent for tab listing but `/json/version` is the cheaper liveness probe.
- Chrome writes `DevToolsActivePort` into the user-data-dir at startup: line 1
  is the actual port, line 2 the browser WebSocket path. With
  `--remote-debugging-port=0` this is the only way to learn the port. Even with
  a fixed port it is a useful cross-check, because several Chrome versions
  silently ignore the flag.
- Recommended allocation: a deterministic base (`9223 + index`) recorded per
  profile, but **verified** by probing before use, falling back to the next free
  port and rewriting the record. Never assume the flag worked.
- Re-attach after a controller restart: for each known profile, probe its
  recorded port; if it answers, adopt the running browser instead of launching a
  second one. Our runs currently get marked `stopped` on restart — that stays
  correct, but the *browser* should be adopted rather than orphaned.
- Orphan cleanup on Windows: keep `{profileId, userDataDir, port, pid}` in a
  per-profile `session.json`; on startup, if the port is dead, kill the pid tree
  (`taskkill /PID <pid> /T`, then `/F`) after confirming the process is really
  `chrome.exe`, then delete stale `SingletonLock`/`DevToolsActivePort` before
  relaunching. Leftover singleton files are the classic cause of "profile is in
  use / something went wrong when opening your profile".

### Do we switch to Playwright or Puppeteer?

Not for this. `launchPersistentContext` ties the browser's lifetime to the
controlling process (closing the context closes the browser) and, for persistent
contexts, `context.browser()` is `null`, so there is no browser-level CDP
session. Puppeteer's `userDataDir` has the same singleton semantics we already
handle. The pattern that matches a long-lived controller is exactly what we have
— launch Chrome as an independent OS process per profile and attach over CDP —
so the work is *restructuring our own module*, not adopting a framework. If we
ever want the library ergonomics, `chromium.connectOverCDP()` /
`puppeteer.connect()` can attach to the same browsers later without changing the
launch model.

### Concurrency and machine cost

- Reported cost per Chromium instance: **400 MB – 1.5 GB** depending on page
  complexity; a production write-up puts the practical ceiling at **3–4
  concurrent browser workers per 8 GB of RAM**. Browserless's headless figure
  (~10 sessions/GB) does not apply to headed Chrome.
- Headed costs roughly 2x CPU and ~2.5x memory versus headless in one 2025
  benchmark, but headed is the right call here: CDP usage is itself detectable,
  and headless adds more signals on top.
- Within one Node process, two browsers means two WebSocket connections, so
  command ids stay naturally partitioned — our `CdpSession` already scopes ids
  per connection. The real risks are synchronous work in the controller starving
  both loops, and two async tasks driving the *same* page. Fix: one job queue /
  mutex **per profile**, and never share a `CdpSession` across tasks.
- **Stagger, don't synchronise.** Practitioner sources are unanimous that
  identical timing across accounts is a cheap detection signal independent of IP
  or fingerprint quality. Parallel profiles should carry independent jitter and,
  ideally, different working-hour windows.

**Recommended default: `MAX_PARALLEL_PROFILES = 2`** on a 16 GB laptop (1 on
8 GB), configurable, with the rest queued.

---

## 3. Keeping each profile logged in (the part that prevents 2FA prompts)

From LinkedIn's own cookie table (retrieved via a reader proxy during research;
LinkedIn blocks direct automated fetches, so treat the exact strings as
second-hand):

| Cookie | Stated purpose | Expiry |
|---|---|---|
| `li_at` | authenticate members and API clients | 1 year |
| `li_rm` | set when the user ticks "Remember me" | 1 year |
| `bscookie` | **remembering that a logged-in user is verified by two-factor authentication** | 1 year |
| `bcookie` | browser identifier, uniquely identifies devices | 1 year |
| `JSESSIONID` | CSRF protection / URL signature validation | session |

`bscookie` is the direct answer to "will I have to do 2FA every time": no — the
device's 2FA verification is remembered in a cookie that lives in the profile
directory. Complete two-step verification **once per profile**, with "remember
this device" ticked, and it persists as long as that directory does.

Cookie expiry is a ceiling, not a guarantee — LinkedIn can invalidate a session
server-side earlier (sign-out-everywhere, password change, security reset), and
automation vendors report sessions dying well before a year.

Operational rules that follow, all enforceable in code:

1. **Never delete or recreate a profile directory** as part of normal operation.
   Deleting it is a full logout plus a new device from LinkedIn's point of view.
2. **Never run two Chrome processes against one profile directory** — the
   singleton lock makes the second one a no-op at best, and killing processes
   uncleanly is what corrupts the cookie DB.
3. **Never flip headed/headless on the same directory** — reported to leave
   corrupt lock files.
4. **Keep the machine and IP stable per profile.** New device, new IP,
   geography change and mid-session IP changes are the triggers most consistently
   reported (LinkedIn's own historical wording is "unfamiliar location or
   device"; the rest is vendor/community reporting, not LinkedIn-published).
5. **Do not copy a profile directory between machines** to "clone" a login — it
   changes device and IP simultaneously, which is the exact shape of a
   compromised-session signal.
6. **Back up before migrating.** Phase 1 of the plan moves
   `.local/chrome-profile` into the new per-profile layout; copy first, verify
   the session still works, and only then remove the old path.

---

## 4. When a challenge appears anyway: the handoff design

Detection (we already have most of this — keep it URL-first, since DOM class
names churn):

| State | Signal |
|---|---|
| authenticated | URL on `/feed`, `/mynetwork`, `/messaging`, `/notifications` + nav present |
| logged out | URL contains `/login`, `/authwall`, `/uas/login` |
| challenged | URL contains `/checkpoint`, `/challenge`, `/uas/consumer-email-challenge` |

Proposed behaviour, extending today's `AUTH_CHALLENGE` -> `needs_attention`:

1. The **profile**, not just the run, enters `needs_verification`. Every run and
   queued run for that profile stops being eligible; other profiles keep going.
2. Record what kind of challenge it looks like (2FA code, email/phone
   verification, captcha, app confirmation) from the URL and page copy, and
   store the challenge URL.
3. Surface it in the UI as an action for the human: "Profile X needs you to
   finish verification in its Chrome window" with a button that focuses/opens
   that profile's browser at the challenge URL. **The controller never types a
   code, never stores a 2FA secret, never touches the authenticator.**
4. Poll `checkLinkedInAuth` for that profile on a slow interval (e.g. 5 s) with
   a bounded window, and require a *positive* authenticated result — never infer
   success from the absence of the challenge page.
5. On success, resume deliberately: a cooldown before the next action, and the
   first day back at reduced volume. Vendors treat a checkpoint as a signal to
   slow down generally, not a speed bump (PhantomBuster's own advice is to pause
   and resume at 50–70% of prior volume).
6. If the window expires, leave the profile paused and notify — never retry the
   action whose outcome is unknown (this matches the existing "ambiguity is
   terminal" rule).

---

## 5. Seeing the state of each browser (observability)

Three states, deliberately separate — today they are conflated into "connected":

1. **Process alive** — pid recorded in `session.json` still exists.
2. **CDP reachable** — `/json/version` answers on the recorded port.
3. **LinkedIn session valid** — `checkLinkedInAuth` returns authenticated.

A browser can be alive and reachable while logged out; that is the case that
silently produces wrong results today. Recommended additions:

- A per-profile heartbeat (last successful CDP call, last authenticated probe)
  so a *hung* profile is distinguishable from a dead one.
- A cheap periodic session probe (the `/feed` check we already have), cached
  ~10 minutes as it is now, but stored per profile and surfaced in the UI.
- Evidence on failure: our audit already captures `document.title` and a
  sanitised HTML snippet on `LAYOUT_MISMATCH`; extend that to a screenshot on
  `AUTH_CHALLENGE` and `AMBIGUOUS_OUTCOME` so a human can see what the page
  looked like without re-driving the browser.
- A per-account card in the UI: session age, last successful action, last auth
  probe, current run, queue depth, and any `needs_verification` flag.

---

## 6. Fingerprint and IP reality check (before scaling beyond two profiles)

Several profiles on one machine share the same hardware-derived fingerprint
signals (canvas/WebGL rendering, fonts, screen metrics, hardware concurrency)
and, unless proxied, the same public IP. Community reporting puts the threshold
where LinkedIn starts correlating accounts at roughly **2–3 accounts per IP** —
that number is vendor/practitioner estimate, not a LinkedIn-published figure,
but the direction is consistent across sources.

The industry answer at scale is one residential/mobile proxy per profile plus
per-profile fingerprint isolation (Multilogin, GoLogin, AdsPower, Dolphin Anty,
Kameleo all sell exactly this bundle: cookies + fingerprint + proxy per
profile). The independent counter-argument is worth weighing: bot-detection
vendors argue an unmodified real browser produces *coherent* signals across
layers, while spoofing tools produce mismatches (a spoofed UA with a canvas that
still says "this machine"), and that over-randomising is itself a tell.

Recommendation for this project: **stay plain**. No fingerprint spoofing, no
stealth patches — a genuine Chrome profile per account, headed, with
conservative volume. If more than two or three accounts are ever needed, the
honest options are separate machines or per-profile proxies, and the proxy path
brings its own failure modes (IP changing mid-session is described as the
strongest bot signal; WebRTC/DNS leaks expose the real IP behind a correctly
proxied HTTP path; shared residential pools inherit other customers' reputation).

---

## 7. Rules and legal picture (unchanged by any of this)

- LinkedIn's User Agreement §8.2 forbids scraping software/scripts/robots (2),
  redistributing data (4), monetising the service without consent (11), and
  "bots or other unauthorized automated methods" (13). The help page "Automated
  activity on LinkedIn" states: *"we don't allow the use of third-party software
  or browser extensions that scrape, modify the appearance of, or automate
  activity on LinkedIn's website."*
- Enforcement observed in public runs from temporary feature restrictions to
  permanent account termination, plus company-page removals for vendors
  (Apollo.io and Seamless.ai in 2025, HeyReach in 2026) and litigation.
- The legal frame after *Van Buren* (2021) and *hiQ* (9th Cir. 2022) is that the
  CFAA does not reach terms-of-service violations against data with no access
  gate — but *hiQ* still ended in a permanent injunction and $500,000 paid to
  LinkedIn on **breach-of-contract** grounds. *Meta v. Bright Data* (Jan 2024)
  turned on the same distinction: the defendant won because it was **logged
  off**; a logged-in, account-based automation is squarely inside the contract
  theory.
- Practical translation for us: the real exposure is **account restriction or
  loss**, for accounts we control, and it scales with volume and with the number
  of accounts run from one machine. Nothing in the product should imply limits
  make automation safe.

---

## 8. Deltas to `MULTI_PROFILE_PLAN.md`

1. Phase 1: probe `/json/version` (not `/json`) for liveness, read
   `DevToolsActivePort` as the authoritative port, and store
   `{profileId, userDataDir, port, pid}` in `session.json`.
2. Phase 1: adopt a live browser on controller restart instead of relaunching;
   clean `SingletonLock` + `DevToolsActivePort` only when the port is dead.
3. Phase 1: copy-then-verify migration of `.local/chrome-profile`, with the old
   directory left in place until the session is confirmed working.
4. Phase 3: `MAX_PARALLEL_PROFILES` default **2**, and independent jitter per
   profile — no synchronised starts across profiles.
5. Phase 3: add a profile-level `needs_verification` state with the handoff flow
   in §4, distinct from the existing run-level `needs_attention`.
6. Phase 4: per-profile working-hour windows should differ by default rather
   than all profiles sharing one schedule.
7. Phase 5: per-account session card showing the three states in §5.
8. New: never delete a profile directory in normal operation; document the
   headed-only, no-spoofing, no-profile-copying rules in the UI copy.

## 9. To verify on the Windows machine

- Chrome version >= 136 (it will be) and that our launch flags still open the
  port — check `DevToolsActivePort` appears in the profile directory.
- Actual RAM per headed instance with LinkedIn loaded, to set
  `MAX_PARALLEL_PROFILES` from measurement rather than the estimate above.
- Whether the existing `.local/chrome-profile` still holds a valid session
  before it is migrated.

---

## Sources

Chrome/CDP: [Changes to remote debugging switches, Chrome 136, 17 Mar 2025](https://developer.chrome.com/blog/remote-debugging-port) (verified directly) ·
[Chromium user_data_dir.md](https://github.com/chromium/chromium/blob/main/docs/user_data_dir.md) ·
[puppeteer#13581 (shared userDataDir + profile-directory)](https://github.com/puppeteer/puppeteer/issues/13581) ·
[selenium#15729 (DevToolsActivePort not written)](https://github.com/SeleniumHQ/selenium/issues/15729) ·
[chromedp#1041 (DevToolsActivePort discovery)](https://github.com/chromedp/chromedp/issues/1041) ·
[playwright#35466 (SingletonLock corruption)](https://github.com/microsoft/playwright/issues/35466) ·
[playwright#13111 (no browser CDP session for persistent context)](https://github.com/microsoft/playwright/issues/13111) ·
[Playwright BrowserType docs](https://playwright.dev/docs/api/class-browsertype) ·
[getting-started-with-cdp](https://github.com/aslushnikov/getting-started-with-cdp) ·
[DataDome on CDP detection](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/)

Resources/concurrency: [Browserless: 2M headless sessions](https://www.browserless.io/blog/observations-running-headless-browser) ·
["8GB Was a Lie: Playwright in Production"](https://medium.com/@onurmaciit/8gb-was-a-lie-playwright-in-production-c2bdbe4429d6) ·
[Anchor Browser headful vs headless benchmark, Aug 2025](https://anchorbrowser.io/blog/choosing-headful-over-headless-browsers) ·
[CloakBrowser: production failure modes](https://cloakbrowser.dev/blog/browser-automation-in-production/)

LinkedIn session/policy: [LinkedIn cookie table](https://www.linkedin.com/legal/l/cookie-table) (robots-blocked to direct fetch; read via proxy) ·
[Automated activity on LinkedIn](https://www.linkedin.com/help/linkedin/answer/a1340567) ·
[LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) (§8.2 clauses quoted via [Nubela litigation writeup, 2026](https://nubela.co/blog/is-scraping-linkedin-legal-in-2026/)) ·
[Unipile checkpoint/handoff API](https://developer.unipile.com/docs/linkedin) ·
[PhantomBuster: disconnected by LinkedIn](https://support.phantombuster.com/hc/en-us/articles/33893991671826-How-to-Fix-Disconnected-by-LinkedIn-and-Other-Account-Disconnection-Errors) ·
[linkedin-mcp-server auth.py (URL-based state detection, manual-login wait)](https://github.com/stickerdaniel/linkedin-mcp-server)

Fingerprint/proxy/legal: [scraping.club fingerprinting deep dive](https://www.scraping.club/p/browser-fingerprinting-deep-dive) ·
[cSide on spoofing limits](https://cside.com/blog/browser-fingerprint-spoofing) ·
[Kameleo fingerprint concepts](http://developer.kameleo.io/concepts/fingerprints/) ·
[Multilogin storage docs](https://multilogin.com/help/en_US/functionality/cloud-and-local-storage) ·
[EFF: hiQ v. LinkedIn](https://www.eff.org/cases/hiq-v-linkedin) ·
[Fenwick: 9th Cir. reaffirms hiQ](https://www.fenwick.com/insights/publications/hiq-labs-scrapes-by-again-the-ninth-circuit-reaffirms-that-data-scraping-does-not-violate-the-cfaa-1) ·
[Zwillgen: hiQ settlement](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/) ·
[Cooley on Van Buren](https://cdp.cooley.com/us-supreme-court-narrows-scope-of-computer-fraud-and-abuse-act-in-van-buren/) ·
[Meta v. Bright Data analysis](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/)
