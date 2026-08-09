# LinkedIn Automator Architecture

Version one is a local-first web app with company workspace auth, LinkedIn
account records, and one persistent Chrome profile.

```text
React UI
  -> local Node controller at http://127.0.0.1:4287
    -> launches Chrome from this computer
    -> uses .local/chrome-profile for persistent LinkedIn login
    -> exposes status/start/open/stop endpoints
```

The Chrome session uses the computer's normal network connection. There is no
proxy or IP rotation in v1.

## Why Single Profile First

The first milestone proves the user flow with one LinkedIn login:

- register or sign in to a company workspace
- add a LinkedIn account record
- view the account manager
- start one managed Chrome session for the selected account
- open LinkedIn with a persistent local profile and log in once
- manage campaigns, profile queues, message templates, and workflow cards

## Multi-Profile Upgrade Path

The UI already treats LinkedIn accounts as records. The runner should treat
browser control as an implementation behind an account session:

```text
LinkedInAccount
  -> BrowserSession
    -> chromeProfileDir
    -> cdpPort
    -> state/status/tabs
```

Version one maps every account to:

```text
.local/chrome-profile
```

Multi-profile support should keep the same account manager, campaign workspace,
workflow cards, templates, and safety settings, then change the browser session
mapping to:

```text
.local/chrome-profiles/{accountId}
```

Each future account should launch with its own `--user-data-dir` and optionally
its own remote debugging port. The network still comes from the same computer
unless proxy support is explicitly added later.

## Safety Layer

Human-like execution settings live separately from the UI workflow model:

- daily action and invite limits
- randomized delay range
- batch cooldown
- working hours
- random scroll/profile dwell time
- pause follow-ups when replies are detected

The runner should read these limits before executing browser actions. The UI can
change without changing the browser controller, and the browser controller can
move from one profile to many profiles without changing campaign definitions.

## Workflow Rule

Every actionable workflow card is followed by an automatic reply-check card.

```text
Profiles to process
  -> Invite contacts
  -> Check for replies
  -> Filter accepted contacts
  -> Check for replies
  -> Send follow-up
  -> Check for replies
```

The runner should stop follow-up automation for a lead once a reply is detected.

## Local Chrome Endpoint

Start the web UI. In development, Vite also starts and supervises the local
Chrome controller:

```sh
npm run dev
```

Use `npm run server` only to run the controller separately for debugging.

Open:

```text
http://127.0.0.1:5173
```

The Chrome profile folder is ignored by git:

```text
.local/chrome-profile
```

Set `CHROME_PATH` if Chrome is installed somewhere unusual.
