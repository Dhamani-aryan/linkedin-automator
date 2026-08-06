# LinkedIn Automator Architecture

Version one is a local-first web app with one persistent Chrome profile.

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

- sign in to the app
- view the account manager
- start one managed Chrome session
- open LinkedIn with a persistent local profile
- manage campaigns, profile queues, message templates, and workflow cards

Multi-profile support can extend the same model by assigning a different
Chrome `--user-data-dir` to each LinkedIn account.

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

Start the local controller:

```sh
npm run server
```

Start the web UI:

```sh
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The Chrome profile folder is ignored by git:

```text
.local/chrome-profile
```

Set `CHROME_PATH` if Chrome is installed somewhere unusual.
