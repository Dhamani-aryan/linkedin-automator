# Current Working Features

Last verified: 2026-08-08

## Working now

### Company workspace

- Register and sign in to a local company workspace.
- Keep the local workspace signed in across reloads.
- Preserve manager pages, the selected LinkedIn workspace, and its active tab across refreshes.
- Support browser Back and Forward navigation between routed views.
- Sign out from the manager sidebar.

### LinkedIn profile manager

- Add multiple logical LinkedIn profile records from the main page.
- Open the workspace for one selected LinkedIn profile at a time.
- Delete a profile record after confirmation.
- View the selected profile's Chrome connection state.

### Managed Chrome

- Start and stop a local Chrome window.
- Reuse one persistent Chrome data directory so the LinkedIn login survives restarts.
- Open LinkedIn in the managed Chrome window.
- Use the computer's normal network connection and IP address.
- Read connected Chrome tabs through the local Chrome DevTools endpoint.

### Campaign workspace

- Persist one campaign workspace per logical LinkedIn profile.
- Add, select, and remove connection-request and message actions.
- Automatically attach a wait-for-acceptance guard after connection requests.
- Automatically attach a reply-check guard after messages.
- Keep automatic guards attached when inserting or removing actions.

### Message templates

- Edit connection notes and direct-message templates.
- Configure a message delay in minutes, hours, or days after the previous workflow step.
- Choose `Send now` for the first message action instead of a workflow delay; global safety pacing still applies.
- Persist message delays and show the configured timing in the workflow inspector.
- Insert LinkedIn lead variables such as first name, last name, company, position, and location.
- Preview resolved variables against sample lead data.
- Enforce the 300-character connection-note limit and the 8,000-character message limit.

### Lead intake

- Add an individual LinkedIn profile URL.
- Paste a custom list of LinkedIn URLs.
- Upload CSV or TXT files containing LinkedIn URLs.
- Paste individual Sales Navigator lead URLs.
- Open a Sales Navigator search or list in managed Chrome and collect currently visible lead links.
- Normalize and validate supported LinkedIn URLs.
- Deduplicate leads and keep source counts synchronized.
- Persist, list, and remove campaign leads.

### Safety settings UI

- Configure daily and action-specific limits.
- Configure working-day modes.
- Configure human-touch delays, batch cooldowns, and related toggles.

## Not working yet

- The Start Campaign control does not execute LinkedIn actions yet.
- Logical LinkedIn profiles are not isolated into separate Chrome data directories yet.
- Safety settings are not yet enforced by a campaign runner.
- Reply detection, inbox synchronization, analytics, and campaign history are not implemented.
- Sales Navigator collection reads only links currently loaded in the page; it does not paginate or scroll automatically.
- Company authentication and data are local to this browser, not backed by a production server or database.
