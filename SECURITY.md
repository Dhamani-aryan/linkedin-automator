# Security and Safe Sharing

LinkedIn Automator is a local development project. It controls visible Chrome
windows on the same computer and stores browser login state locally. The Git
repository must never contain a real login, browser profile, campaign export,
or run history.

## Data that stays local

The following data is intentionally excluded by `.gitignore`:

- `.env` files other than the documented `.env.example` template;
- `.local/`, including Chrome profiles, cookies, session metadata, runs, and
  audit logs;
- CSV/spreadsheet exports;
- screenshots, browser captures, HAR files, logs, and temporary files;
- databases, private keys, and credential bundles.

Do not copy `.local/` when transferring the project. A recipient should clone
the repository, run `npm install`, start the app, and create a fresh local
Chrome profile by signing in manually.

## Before sharing

Run:

```powershell
npm run audit:repo -- --history
npm test
npm run build
git status --short
```

The audit checks tracked files and reachable Git history for common secret
formats, sensitive file paths, non-example email addresses, local Windows user
paths, and non-example LinkedIn profile URLs. It is a guardrail, not a complete
replacement for a dedicated scanner or manual review.

## If a secret is committed

Removing it in a new commit is not sufficient because the old blob remains in
Git history. Revoke or rotate the credential first, then remove it from all Git
refs with a history-rewriting tool and force-push the cleaned refs. Existing
clones must be discarded or carefully rebased onto the rewritten history.

## Reporting

Do not open a public issue containing a token, cookie, password, personal lead
list, or browser data. Share only a redacted description of the affected file
and commit with the repository owner through a private channel.
