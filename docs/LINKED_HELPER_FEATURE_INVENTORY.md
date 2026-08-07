# Linked Helper Feature Inventory and Product Decisions

**Research date:** August 7, 2026  
**Live instance reviewed:** Linked Helper 2 `2.130.10`, Prashant Parekh profile  
**Launcher observed:** `2.130.6`  
**Test campaign reviewed:** `SAP Install Base` (Draft, Ready to start, 16 profiles)

## Purpose

This document records how Linked Helper is organized, how its browser automation model works, the features visible in the live product, and which ideas are worth carrying into LinkedIn Automator.

It is a product reference, not a requirement to clone Linked Helper exactly. The final sections separate the useful product model from features that would add cost or complexity before the core workflow is proven.

## Evidence Levels

- **Observed:** Confirmed directly in the live Prashant instance or the supplied screenshots.
- **Documented:** Confirmed in Linked Helper's current official documentation.
- **Recommended:** A design decision for LinkedIn Automator, not a claim about Linked Helper.

No campaign was started, no message was sent, and no profile, account, action, or setting was changed during this review.

## Executive Summary

Linked Helper is effectively two applications:

1. A launcher and account manager that owns workspaces, LinkedIn accounts, licenses, proxies, and separate account instances.
2. A per-account application that contains campaigns, workflows, profile queues, inboxes, analytics, safety settings, plug-ins, and a controlled LinkedIn browser.

The most important product ideas for us are:

- One company workspace can own one or more LinkedIn accounts.
- Each LinkedIn account maps to one persistent browser profile and one isolated local data scope.
- Campaigns are ordered workflows made of action cards.
- Profiles move through explicit queues and outcome lists.
- Reply checks are first-class workflow actions and should follow outbound message steps.
- Invitations use an acceptance filter before a 1st-degree follow-up.
- Limits and working hours apply at the LinkedIn-account level across campaigns.
- Message templates support variables, variations, preview, and reusable templates.
- The browser session is visible and can still be used manually.

For our first release, we should build the account/session foundation, a focused workflow builder, profile imports, messaging personalization, reply-aware follow-ups, and safety controls. The marketplace, billing, proxy rotation, recruiter-specific flows, broad CRM catalog, and advanced enrichment can wait.

## 1. Product and Browser Architecture

### 1.1 Launcher and account instances

**Observed:** The launcher lists LinkedIn accounts and opens a separate Linked Helper window for each account. The account table exposes state, access, license, archive status, and account actions.

**Documented:** Linked Helper uses a one-account-to-one-instance rule. Each instance has separate cookies, cache, campaign/profile data, and a local database. The official account documentation also exposes local open, open-and-run, remote open, show-window, backup, and restore operations.

Conceptually:

```text
Company workspace
  -> LinkedIn account
     -> Persistent browser profile
     -> Local cookies and cache
     -> Campaign database
     -> Profile/CRM database
     -> Safety policy
     -> Runner state
```

### 1.2 How browser automation works

**Documented:** Linked Helper says it does not use the LinkedIn API. It operates LinkedIn through a browser-like instance and performs page navigation and UI interactions.

The useful architectural properties are:

- A visible browser surface rather than a hidden API-only process.
- Persistent cookies so the user logs in once and reuses the session.
- A dedicated browser profile per LinkedIn account.
- A dedicated local database per account instance.
- Browser activity and manual activity share the same account session.
- Campaign execution can be paused while the browser remains available.

### 1.3 IP behavior for our product

For the current single-profile version, LinkedIn Automator should continue to use the computer's normal network route:

- No proxy.
- No rotating IP.
- No VPN management inside the product.
- One persistent local Chrome profile.
- The same public IP the computer normally uses.

For a later multi-profile version, browser storage must be isolated per account even if all profiles intentionally share the same computer IP. Proxy support should be a separate, explicit future capability, not an implicit part of session creation.

### 1.4 Recommended internal abstraction

The single-profile implementation should already use account-scoped interfaces:

```text
Workspace
  -> LinkedInAccount
     -> BrowserSessionProvider
     -> CampaignRepository
     -> ProfileRepository
     -> SafetyPolicy
     -> WorkflowRunner
```

Today, `BrowserSessionProvider` can always return the one local Chrome profile. Later, it can resolve `accountId -> profile directory + debug port + process` without changing campaign or workflow code.

## 2. Launcher and Workspace Features

### 2.1 Workspace management

**Observed:** The launcher sidebar includes Workspace Management and shows the active workspace with its ID.

**Documented:** Workspace owners can invite users and assign roles. Linked Helper describes owner/admin/member-style access and account assignment.

Recommended for us:

- Company registration and sign-in.
- One workspace created during registration.
- Workspace owner role in the MVP.
- Account ownership and access fields in the data model now.
- Team invites and granular roles later.

### 2.2 LinkedIn account manager

**Observed features:**

- Add account.
- Search accounts.
- Filter by all/current machine and account state.
- Running, stopped, in-use, and archived filters.
- Favorite/starred accounts.
- Account email, display name, avatar, and details.
- State and campaign access.
- License and expiry information.
- Owner/access badge.
- Archive status.
- Start/open, stop, edit, archive, show-window, and related row actions.

Recommended for our MVP:

- Add account using a label and optional LinkedIn email.
- Launch the persistent Chrome session.
- Show whether LinkedIn is logged in.
- Open/show the existing Chrome window.
- Stop only the automation runner without deleting the browser profile.
- Delete with explicit confirmation and a clear statement about session-data removal.
- Archive later; hard deletion should be uncommon.

### 2.3 Other launcher areas

**Observed:**

- Licenses.
- Billing.
- Proxies.
- Notifications.
- Settings.
- Update checker.
- Knowledge base, tutorials, changelog, and support channels.

Recommended disposition:

- Keep notifications and basic settings.
- Defer billing and licensing until there is a hosted commercial plan.
- Defer proxies.
- Replace the many support links with one Help area.
- Use ordinary app updates rather than reproducing Linked Helper's launcher updater UI.

## 3. Per-Account Application Shell

**Observed navigation:**

- Campaigns.
- LinkedIn browser.
- Plug-in Store.
- Dashboard.
- Settings.
- Help.

The campaign sidebar remains visible while a campaign is open and shows:

- Current campaign and state.
- Queue/progress state.
- Profiles and Exclude toggles.
- Total profiles and profiles to process.
- Profile source selector.
- Campaign target selector.
- Collect button.
- Start/stop campaign control.

Recommended for us:

- Retain an account-level shell after the user opens a LinkedIn account.
- Keep campaign context visible in a compact left rail.
- Make browser, workflow, contacts, inbox, and dashboard first-class views.
- Keep safety settings at account level, not inside the account-list page.

## 4. Campaign Management

### 4.1 Campaign list

**Observed:** The campaign list supports:

- Main and archived campaigns.
- List and activity modes.
- Search.
- Upload campaigns.
- Create campaign.
- Start/stop the campaigns runner.
- Selecting multiple campaigns for additional actions.
- Campaign state such as Draft, Queued, Sleeping, Running, Stopped, and Completed.
- Per-campaign totals for processing, processed, successful, failed, invited, accepted, messaged, replied, followed, and post-liked activities.

### 4.2 Campaign templates

**Documented workflow templates include:**

- Empty campaign.
- Invite and follow-up.
- Messaging sequence.
- Export profile information.
- InMail sequence.
- Event messaging sequence.
- Group messaging sequence.
- Warmed-up 1st-degree message chain.
- Snov.io email campaign handoff.
- Visit and extract profiles.
- Find profile emails.
- Remove 1st-degree connections.

Recommended for our MVP:

- Empty workflow.
- Invite and follow-up.
- Messaging sequence.
- Visit and extract.
- CSV/URL import plus message sequence.

Other templates can be assembled from the same action registry later.

### 4.3 Campaign lifecycle

Recommended states:

```text
Draft -> Ready -> Running -> Cooling down -> Paused -> Completed
                         \-> Needs attention
```

Campaign deletion should be blocked while running. Pausing a campaign must preserve every profile's current action and next eligible execution time.

## 5. Workflow Builder

### 5.1 Card model

**Observed:** Each action is a card in a vertical sequence. Cards expose:

- Profiles waiting for the action.
- Action name and icon.
- Success, reply/acceptance, failure, and excluded counters as relevant.
- Click-to-edit settings in a right-side inspector.
- Add-action controls between steps.
- Reorder controls when allowed.
- Delete control with an irreversible-change warning.
- Optional general and action-specific plug-ins.

### 5.2 Profile movement

**Documented:** Profiles normally move from the top of the workflow to the bottom. Delay, acceptance-filter, and reply-check actions can hold profiles. The runner may process profiles one by one or in batches depending on the action and its delay behavior.

Our workflow engine should store one execution record per profile per action:

```text
queued -> processing -> successful | failed | excluded | replied | accepted
```

Each transition should include timestamps, attempt count, reason, and the browser URL where the result was observed.

### 5.3 `SAP Install Base` test workflow

The live draft campaign contains this exact sequence:

1. **Invite 2nd and 3rd level contacts** with two message variations.
2. **Filter contacts out of my network (keep 1st level only)** to detect accepted invitations.
3. **Delay between actions**.
4. **Message to 1st connections**.
5. **Check for replies**.
6. **Message to 1st connections**.
7. **Check for replies**.
8. Finish.

This is the right pattern for our default follow-up workflow.

### 5.4 Automatic guard steps

Recommended builder behavior:

- After an invitation action, offer or automatically insert an acceptance filter.
- After every outbound message action, automatically insert a reply check.
- Do not insert reply checks after delays, filters, exports, extraction, or non-message engagement actions.
- If the user removes a guard step, show the consequence before saving.
- The final outbound message should also have a reply check, optionally with no expiry.

This keeps the user's original intent while avoiding meaningless reply checks after every technical step.

## 6. Action Catalog

The following actions were visible in the `2.130.10` action picker or plug-in store. Availability can depend on installed plug-ins and account subscriptions.

| Action | Purpose | Recommendation |
|---|---|---|
| Invite 2nd and 3rd level contacts | Send connection requests with optional notes | Build now |
| Message to 1st connections | Send personalized direct messages | Build now |
| Visit and extract profiles | Open profiles and collect available fields | Build now, limited fields |
| Find profile emails | Enrich email through providers/data credits | Later |
| Data Enrichment | Find phones, emails, social links, profile/company data | Later |
| AI ICP Detection | Score profiles against an ideal-customer profile | Later |
| AI personalized messages | Generate profile-aware outreach | Later, after manual templates |
| Auto-collect people | Continuously collect profiles from a source | Later |
| Follow/Unfollow profiles | Change follow state | Later |
| Like and comment posts and articles | Engage with profile content | Later |
| Boost post | Mention people in comments to increase post activity | Spare initially |
| Message to group members | Message non-1st-degree members through a shared group | Later |
| Message to event attendees | Message through a shared event | Later |
| Send person to webhook | Send profile/message data to external systems | Next phase |
| Send person to Snov.io | Add a lead to Snov.io | Later |
| InMail to 2nd and 3rd contacts | Send paid InMail | Later |
| Scrape messaging history | Save conversations to inbox/CRM or CSV | Next phase |
| Filter contacts out of my network | Hold profiles until invitations are accepted | Build now |
| Check for replies | Poll conversations and stop/branch follow-ups | Build now |
| Invite to follow organization | Invite 1st-degree contacts to follow a page | Spare initially |
| Invite person to event | Invite 1st-degree contacts to an event | Later |
| Invite to group | Invite 1st-degree contacts to a group | Later |
| Endorse my contacts | Endorse selected skills | Spare initially |
| Remove from 1st connections | Remove existing connections | Spare initially |
| Send person to external CRM | Map and send profile/message data to a CRM | Later |
| Delay between actions | Hold a profile before the next step | Build now |
| Organizations extractor | Extract organization-page data | Later |
| Employees extractor | Collect employees from company data/pages | Later |
| Send organization to webhook | Export organization data | Later |

## 7. Reply Detection

**Observed:** `Check for replies` is a separate action and has success, replied, failed, and excluded-style outcomes.

**Documented behavior:**

- It monitors replies to earlier campaign messages.
- It can poll repeatedly during a configured time window.
- When no reply is found before the deadline, the profile moves forward.
- When a reply is found, the profile moves to Replied and should leave the follow-up path.
- It can be configured as an indefinite final monitor.
- Optional extensions can forward replies to a webhook or recognize additional reply-like events.

Recommended implementation:

- Store the last outbound message ID/time and conversation URL.
- Poll only within working hours.
- Use an adjustable poll interval with jitter.
- Treat a newly observed inbound message after the outbound timestamp as a reply.
- Stop all later outreach in that campaign for the profile.
- Optionally stop outreach across all campaigns for the same LinkedIn profile.
- Surface replies in an inbox requiring human review.

## 8. Lead and Profile Sources

### 8.1 Regular LinkedIn sources

**Observed:**

- Search page.
- My network page.
- School alumni page.
- Company people page.
- My group page.
- My event page.
- Who viewed your profile page.
- Sent invitations page.
- Followers page.
- Following page.
- LinkedIn profile URLs.

### 8.2 Premium LinkedIn sources

**Observed:**

- Sales Navigator search page.
- Sales Navigator list page.
- Recruiter/Talent search page.
- Recruiter/Talent project page.

### 8.3 Files and existing data

**Observed:**

- CSV, TXT, or HTML upload.
- Pasted LinkedIn profile URLs.
- Linked Helper-exported CSV with delimiter detection.
- Existing campaign/action lists.
- Campaign sub-lists such as queue, processed, failed, accepted, or replied.

### 8.4 Recommended source rollout

Build now:

- Paste profile URLs.
- Upload CSV.
- Current LinkedIn search-result collection through the visible browser.
- Reuse an existing campaign list.

Build later:

- Sales Navigator search and list collection.
- Followers, following, events, groups, and alumni collectors.
- Recruiter/Talent support.
- Continuous auto-collection.

## 9. Profile Lists and CRM-Like Records

### 9.1 Campaign list states

**Observed tabs:**

- Profiles to process.
- Exclude list.
- Processing.
- Processed.
- Successful.
- Excluded.
- Replied.
- Failed.
- Accepted.

Each row can display identity, headline/position, Linked Helper ID, queue timestamp, execution platform, and target platform.

### 9.2 Filtering and editing

**Observed filters include:**

- First name.
- Last name.
- Company.
- Position.
- Email.
- Phone.
- Headline.
- Location.
- Internal ID.
- LinkedIn ID.
- Avatar and additional fields lower in the filter panel.
- Set / Not set filters for field availability.

**Documented:** Profiles can be edited, moved between action queues, excluded, retried, and previewed with rendered message variables.

Recommended data model:

```text
Profile
  identity: LinkedIn URL, public ID, member ID
  person: first name, last name, headline, position, company, location
  contact: email, phone
  network: connection degree, mutual connection data
  source: source type, source URL, imported timestamp
  campaign memberships: action state, timestamps, outcomes
  custom variables: workspace, campaign, and action scopes
```

## 10. Message Template Editor

### 10.1 Core editor features

**Observed:**

- Multiple message variations.
- Preview using a real/sample profile.
- Template gallery.
- Character count, including the 300-character invitation-note constraint.
- Copy and delete controls.
- AI message entry point.
- Spintax.
- Variables menu.
- Optional plug-ins.

### 10.2 Standard variables observed

- `{firstName}`
- `{lastName}`
- `{company}`
- `{position}`
- `{mutualFirstFullName}`
- `{mutualSecondFullName}`
- `{mutualTotal}`
- `{industry}`
- `{publicId}`
- `{memberId}`

The editor also showed a greeting variation such as `[Hello | Hi | Greetings]` and rendered `{firstName}` into a preview.

### 10.3 Optional message extensions observed

- Filter by message content/stop words.
- Send replied profiles to a webhook.
- IF/THEN/ELSE conditions in templates.
- Personalized image attachments.
- Custom template variables.
- Ignore generic replies.

### 10.4 Recommended MVP behavior

- Variable insertion menu; users should never need to type tokens manually.
- Highlight variable tokens inside the editor.
- Preview against selected imported profiles.
- Warn when required fields are missing.
- Support two or more text variations.
- Support simple spintax.
- Enforce the applicable character limit.
- Save reusable templates per workspace.
- Render and persist the exact outgoing text before execution for auditability.

AI generation, conditional templates, custom images, and multi-scope custom variables should follow later.

## 11. Inbox

**Observed campaign inbox tabs:**

- Replied.
- Sent.
- Scheduled.
- Unscheduled.
- Failed.
- Draft.

**Observed filters:**

- Read/unread.
- Reply date range.
- Name, company, position, headline, location, internal ID, and LinkedIn ID.

**Documented:** Linked Helper can combine messages captured from LinkedIn, Sales Navigator, and Recruiter, although each LinkedIn platform has its own underlying inbox.

Recommended for us:

- Start with Replied, Sent, Scheduled, Failed, and Draft.
- Add a conversation drawer with campaign and profile context.
- Mark automation-originated messages separately.
- Let a human take over and pause future workflow actions.
- Add global suppression when a reply is detected.

## 12. Dashboards and Reporting

### 12.1 Account dashboard

**Observed:**

- LinkedIn Social Selling Index and its component scores.
- Inbox totals for replies, sent, scheduled, unscheduled, and failed.
- Date range and campaign filter.
- CSV download.
- Daily activity chart.
- LinkedIn-only activity.
- Invited versus accepted.
- Messaged versus replied.
- Per-action totals for the day and selected period.
- Campaign summary below the chart.

### 12.2 Campaign dashboard

**Observed:**

- Performance period selector.
- Acceptance rate.
- Reply rate.
- Issues to fix.
- Replies to check.
- Failed messages to fix.
- Profile statistics.
- Activity charts with CSV export.
- Processed-statistics date range.

Recommended MVP metrics:

- Invites sent and accepted.
- Messages sent and replied.
- Acceptance and reply rates.
- Failed actions by reason.
- Profiles at each workflow step.
- Daily activity against safety limits.
- CSV export.

SSI and elaborate visual analytics are lower priority.

## 13. Safety, Limits, and Human-Like Scheduling

### 13.1 Global account limits

**Observed/documented:** Limits are account-wide across campaigns, not separate per campaign. Linked Helper supports a maximum number of actions per 24 hours and additional per-activity limits.

Examples include limits for:

- Invitations.
- Messages.
- Profile-page loads.
- InMail.
- Follow/unfollow.
- Email finding.
- Endorsements.
- Event/group/page invitations.
- Webhook and CRM sends.

Multiple rolling limits can apply to one activity, such as a daily cap plus an hourly cap.

### 13.2 Working hours

**Observed:**

- Account timezone.
- Separate configuration for every weekday.
- 24-hour mode.
- Do-not-work mode.
- Multiple time ranges per day.

### 13.3 Action timing and human touch

**Observed plug-ins:**

- Action-step delays for pauses between clicks, navigation, and text entry.
- Batch/step behavior.
- Postpone action start.
- Action-specific working hours.
- Override execution platform.

Recommended safety policy for us:

- Daily total-action cap.
- Per-action rolling limits.
- Randomized delay range between actions.
- Randomized pauses between browser steps.
- Profile dwell-time range.
- Small scroll/pause behavior when appropriate.
- Batch size and batch cooldown.
- Per-day working schedule and timezone.
- Randomized daily start/end jitter.
- Pause on login challenge, CAPTCHA, unusual page, repeated failure, or reply.
- Manual emergency stop.
- Same-IP local Chrome indicator.

Safety limits should live only on the Safety Limits page and be enforced by the runner, never merely displayed in UI.

## 14. Plug-In System

### 14.1 Store model

**Observed:** Plug-ins are grouped into Installed, Not installed, and All, with category filters for Actions, Action extensions, Message action extensions, CRM, Campaigns, and Other. The live store states that plug-ins are free.

### 14.2 Action extensions observed

- Tagging system.
- Postpone action start.
- Action-step delays.
- Override platform.
- Action working hours.
- Advanced invitation settings.
- Advanced acceptance-filter settings.
- Advanced reply-check settings.
- Auto-accept incoming invitations.
- Automatic stale sent-invitation cancellation.

### 14.3 CRM plug-ins observed

- Tagging system.
- Built-in CRM.
- Inbox.

### 14.4 Campaign plug-ins observed

- Organizations extractor.
- Employees extractor.
- Campaign information/metadata tab.

### 14.5 Other plug-ins observed

- Lists manager.
- Accept incoming invitations.
- Sent invites canceler.

### 14.6 Recommendation for our architecture

Use an internal action registry from the beginning, but do not build a public plug-in marketplace yet.

Each action definition should declare:

```text
id
category
accepted connection degrees
configuration schema
required profile fields
possible outcomes
safety activity type
browser executor
optional extensions
```

This preserves extensibility without requiring installation, versioning, security review, and marketplace UI in the MVP.

## 15. CRM and External Integrations

### 15.1 External CRMs observed

- HubSpot.
- Close.
- Pipedrive.
- ActiveCampaign.
- Salesforce.
- HighLevel.
- Zoho CRM.
- Zoho Recruit.

### 15.2 Configuration model

**Observed:**

- Access token or OAuth connection.
- Set a default CRM.
- Send messaging history as LinkedIn activity.
- Associate with contact and/or company.
- Select owner.
- Contact and company field mapping.
- Select identifier fields.
- Choose overwrite behavior.
- Send to a list.

### 15.3 Generic integrations

- Webhooks to automation platforms and custom systems.
- Snov.io list/campaign export.
- CSV export.
- External CRM action in a workflow.

Recommended order:

1. CSV import/export.
2. Generic outbound webhook.
3. One CRM connector based on actual customer demand.
4. Additional connectors through a shared mapping interface.

## 16. Settings and Personalization

### 16.1 Action settings

**Observed:** A toggle controls whether replies remain unread when reply checks inspect conversations.

### 16.2 Interface settings

**Observed:**

- Per-instance zoom.
- Restore default zoom.
- Interface language.
- White-label mode.
- Company name.
- Small logo plus text or large-logo-only mode.
- Logo URL and logotype text.
- Sound mute.

Recommended:

- Keep theme, zoom, notifications, and sound only when needed.
- Defer white labeling until a commercial workspace plan exists.

## 17. Data Ownership, Backup, and Recovery

**Documented:** Linked Helper stores instance data locally and provides backup/restore to move it to another machine.

Recommended for us:

- Store browser profile data locally.
- Store account/workflow/profile metadata in an explicit application database.
- Never store LinkedIn passwords when manual login can establish the session.
- Back up campaign and profile metadata separately from the Chrome profile.
- Treat deleting a LinkedIn account and deleting its Chrome session as two distinct actions.
- Prefer archive over delete.
- Record an audit event for campaign start/stop, workflow changes, sends, failures, and deletions.

## 18. Recommended Product Scope

### 18.1 Build now: single-profile foundation

- Company registration and sign-in.
- Workspace shell.
- One LinkedIn account.
- Persistent local Chrome login.
- Start, show, and stop browser session.
- Account deletion confirmation.
- Account-scoped storage interfaces ready for multiple profiles.
- Safety Limits page with limits, schedules, delays, cooldowns, and emergency stop.

### 18.2 Build next: useful automation MVP

- Campaign list and lifecycle.
- Card-based workflow builder.
- Invite, acceptance filter, delay, message, and reply-check actions.
- Automatic guard-step insertion.
- CSV and URL imports.
- Profiles-to-process, accepted, replied, failed, excluded, and completed lists.
- Message variables, variations, spintax, preview, and templates.
- Basic inbox and reply suppression.
- Basic dashboard and CSV export.

### 18.3 Build after the MVP is reliable

- Multiple local Chrome profiles.
- Sales Navigator collection.
- Webhooks.
- Shared team workspaces and permissions.
- Built-in CRM and tags.
- Additional collectors.
- AI-assisted message drafting.
- CRM connectors.
- Backup/restore UI.

### 18.4 Spare for now

- Proxy marketplace or automatic proxy rotation.
- Recruiter/Talent automation.
- Licensing marketplace.
- Full plug-in store UI.
- White labeling.
- SSI dashboard.
- Endorsement automation.
- Connection removal automation.
- Post boosting.
- Broad data enrichment and phone/email credit systems.
- Remote-machine control.

## 19. Suggested MVP Workflow

```text
Import or collect profiles
  -> Invite 2nd/3rd-degree contacts
  -> Wait until accepted
  -> Delay with jitter
  -> Send personalized message
  -> Check for replies
     -> Replied: stop outreach and show in Inbox
     -> No reply by deadline: continue
  -> Send follow-up
  -> Check for replies indefinitely or until expiry
  -> Complete
```

This one workflow proves the browser session, action engine, variables, queues, safety scheduler, reply detection, and dashboard without requiring the entire Linked Helper catalog.

## 20. Product Decisions to Make

Before expanding beyond the current foundation, decide:

1. Whether campaign data remains local or syncs to a hosted backend.
2. Whether a reply suppresses one campaign or all campaigns for that profile.
3. Whether browser actions require a visible window at all times.
4. Which LinkedIn fields are essential enough to scrape and retain.
5. Whether Sales Navigator is part of the first paid version.
6. Which one CRM or webhook use case has real customer demand.
7. Retention and deletion rules for message history and profile data.

## 21. Official References

- [LinkedIn Accounts menu](https://support.linkedhelper.com/hc/en-us/articles/360016793020-LinkedIn-Accounts-menu)
- [How to manage multiple LinkedIn accounts](https://support.linkedhelper.com/hc/en-us/articles/360015219400-How-to-manage-multiple-LinkedIn-accounts)
- [Linked Helper instance](https://support.linkedhelper.com/hc/en-us/sections/360004780040-Instance)
- [Workflow](https://support.linkedhelper.com/hc/en-us/articles/360016470720-Workflow)
- [How to add profiles to a campaign](https://support.linkedhelper.com/hc/en-us/articles/360015790859-How-to-add-profiles-to-a-campaign)
- [Managing profiles](https://support.linkedhelper.com/hc/en-us/articles/360016183800-Managing-profiles-in-Linked-Helper-2)
- [Check for replies](https://support.linkedhelper.com/hc/en-us/articles/360017905660-Check-for-replies)
- [Working hours and limits](https://support.linkedhelper.com/hc/en-us/articles/360016435499-Working-Hours-and-Limits)
- [Plug-ins overview](https://support.linkedhelper.com/hc/en-us/sections/360004660100-Plug-ins)
- [Plug-in store](https://support.linkedhelper.com/hc/en-us/articles/360016844320-Plug-in-store)
- [Custom variables](https://support.linkedhelper.com/hc/en-us/articles/360015589860-Linked-Helper-2-Custom-Fields)
- [Linked Helper Inbox](https://support.linkedhelper.com/hc/en-us/articles/5422237843218-Linked-Helper-Inbox-menu)
- [Proxies menu](https://support.linkedhelper.com/hc/en-us/articles/360017047039-Proxies-menu)
- [Browser and mobile-use precautions](https://support.linkedhelper.com/hc/en-us/articles/360017023219-Can-I-use-LinkedIn-account-via-browser-mobile-app-when-Linked-Helper-is-running)

## Bottom Line

The core value is not the number of actions in the catalog. It is the combination of a persistent per-account browser, a queue-based workflow engine, reply-aware guard steps, profile state visibility, and account-wide safety enforcement.

Our first complete product should make that smaller system excellent. Once it reliably executes the `SAP Install Base`-style flow, the remaining collectors, actions, integrations, and multi-profile support can be added through the same account-scoped action registry without changing the foundation.
