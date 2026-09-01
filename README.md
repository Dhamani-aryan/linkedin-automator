# LinkedIn Automator

LinkedIn Automator is a local-first outreach workflow lab for designing safer browser-based LinkedIn campaign automation.

The project focuses on the hard parts of agentic browser automation: persistent sessions, workflow state, message templates, lead intake, safety limits, dry-run execution, and reply-aware follow-up logic. It is built as a real product surface, not a script collection.

> Platform note: LinkedIn restricts scraping and automation in its terms. This repo is written as a responsible automation prototype with low-volume limits, human review, and account-risk awareness built into the design.

## Why I built this

Most outreach automation tools hide the interesting system design behind a black box. I wanted to understand and build the core primitives myself:

- A local Chrome controller that can reuse a real browser profile.
- A campaign builder that models workflows as stateful actions.
- Guardrails for connection notes, message limits, delays, working hours, and daily caps.
- A lead intake pipeline that normalizes LinkedIn and Sales Navigator URLs.
- A dry-run runner that proves sequencing before live execution.

The result is a practical agentic automation playground for learning how browser sessions, UI state, safety constraints, and human approval fit together.

## What works now

- Company workspace sign-in stored locally.
- Multiple logical LinkedIn profile records.
- Managed local Chrome window with persistent profile storage.
- Campaign workspaces with filters, selection, status, and durable run history.
- Workflow action builder for connection requests and messages.
- Automatic wait-for-acceptance and reply-check guard cards.
- Message template editor with variables, preview, and character limits.
- Lead intake from single URLs, pasted lists, CSV, TXT, and visible Sales Navigator links.
- Safety settings for action limits, working days, delays, and cooldowns.
- Sequential dry-run queue for selected campaigns.

## Architecture

```text
React + Vite UI
  -> Local Node controller at 127.0.0.1
    -> Launches Chrome from this computer
    -> Reuses a persistent local Chrome profile
    -> Exposes browser session and runner endpoints
```

The first milestone keeps execution local and transparent. The browser uses the machine's normal network connection, and all campaign state is stored on the user's device.

## Product model

The core model is intentionally simple:

- A profile owns campaigns.
- A campaign owns leads, workflow actions, templates, and run history.
- A workflow action can add automatic guard steps.
- A runner processes the campaign queue with safety pacing.
- Replies stop later follow-ups for that lead.

This gives the project a clear upgrade path from one persistent Chrome profile to isolated profiles per account.

## Tech stack

- TypeScript
- React
- Vite
- Node.js
- Chrome DevTools Protocol
- Vitest

## Local setup

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Use `npm run server` only when running the Chrome controller separately for debugging.

## Project status

This is an active prototype. The UI, campaign modeling, lead intake, templates, safety controls, and dry-run queue are working. Full live connection-request execution, reply sync, analytics, and multi-profile browser isolation are the next major milestones.

## What this shows

This repo represents the kind of work I enjoy most: turning messy browser workflows into controlled, observable agent systems where automation can assist without removing human judgment.
