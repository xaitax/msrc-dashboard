# MSRC Dashboard

A browser extension for researchers who report vulnerabilities to Microsoft through the
[MSRC Researcher Portal](https://msrc.microsoft.com/report/vulnerability). It keeps a copy of your
submissions on your own machine, shows what changed and when, notifies you about new activity, and
lets you write reports and messages without the portal.

This is an unofficial tool. It is not affiliated with or endorsed by Microsoft. It talks to the same
API the portal uses, so a portal update can break parts of it at any time.

## What it does

- **Board.** Your cases in columns by MSRC stage (New, Review / Repro, Develop, Pre-release,
  Complete), with what changed since your last visit on top. A case MSRC has put on hold until you
  reply is marked **Action required**. Search with `/`, step through cases with `j` and `k`.
- **Case page.** Every field the portal has, plus one timeline of messages, status changes (with
  the exact time from MSRC's notification feed) and file uploads. On top, MSRC's banner for the case
  and the portal's explanation of what the status means and what, if anything, you should do.
  Messages and report text render as Markdown.
- **Notifications.** A desktop notification when MSRC replies, a status or bounty changes, or a CVE
  appears. It checks every 2 minutes (two requests when nothing changed) and re-reads everything
  every 6 hours.
- **Public CVEs.** Reads Microsoft's public Security Update Guide for CVEs that credit you, which
  often appear before MSRC updates the case. It suggests the matching case and you confirm it.
- **Recognition and bounties.** Recognition points per case (the portal stores them but doesn't
  show them), leaderboards, and the bounty awards added up across your cases.
- **Reports.** MSRC's report form on one page: drafts saved on MSRC, local autosave, attachments
  encrypted the same way the portal does it, a checklist of what MSRC requires, and a typed
  confirmation before submitting.
- **Messages.** A message box on each case, with a preview before anything is sent.
- **Planned disclosures.** Add, change or cancel a planned talk or blog post on a submitted case,
  as on the portal's Disclosure tab. Each change is confirmed in a dialog first.
- **MSRC announcements.** The portal's site-wide alert and banners appear at the top, dismissible.
- **Portal internals.** A page (linked from Profile) showing what the portal publishes about
  itself: its AI pre-screening setup, the environments compiled into its script, and its feature
  flags with MSRC's own descriptions.
- **Export.** One JSON file with everything about your cases, including a field guide for an LLM.
- **Staying signed in.** The portal's session is kept alive and renewed in a background tab, so
  there's no daily sign-in.

## Install

You need a Chromium browser, version 120 or later (Brave, Chrome, Edge).

If you have a `dist/` folder (a prebuilt copy), skip to step 3. Otherwise build it, which needs
Node.js 22.12 or later:

1. `npm ci`
2. `npm run build` (writes `dist/`)
3. Open `brave://extensions` (or `chrome://extensions`), turn on **Developer mode**, click
   **Load unpacked** and pick the `dist/` folder.
4. Sign in on the [portal](https://msrc.microsoft.com/report/vulnerability) once, in a normal tab.
5. Click the extension's toolbar icon to open the dashboard. The first load reads all your cases
   and messages and takes about a minute.

Keep Developer mode on. With it off, Brave and Chrome may disable unpacked extensions on restart.

To update, replace the folder, then click the reload icon on the extension's card. Your data stays.
[CHANGELOG.md](CHANGELOG.md) lists what changed in each version.

## Security and privacy

Read this before installing.

- **Your MSRC session is stored unencrypted.** To stay signed in, the extension keeps a copy of
  the portal's session, including its refresh token, in the extension's storage inside your browser
  profile. Anyone who can read that profile can act as you on the portal until the token expires.
  Use it only in a profile you trust.
- **Signed-in portal tabs are seeded.** A new tab on `msrc.microsoft.com/report` gets that session
  copied in, so it doesn't bounce to the sign-in page.
- **Everything else stays local.** Cases, messages and settings live in the browser's own storage.
  There are no servers and no telemetry. The only host it contacts is Microsoft's: the portal, its
  API and its sign-in service.
- **The public CVE check sends nothing about you.** It reads the Security Update Guide without
  signing in, and matches your credit name on your machine.
- **Nothing is sent to MSRC without a click.** Saving a draft, attaching a file, submitting,
  sending a message and changing a planned disclosure are each an explicit action. Submitting,
  attaching, sending and cancelling a disclosure ask for confirmation, because none can be undone.
- **Exports contain your case data** (titles, report text, messages) but never login tokens.

Removing the extension deletes everything it stored.

## Development

```
npm ci
npm run build        # dist/, load it unpacked
npm run watch        # rebuild on change (restart for changes in static/)
npm test             # Vitest; no network
npm run typecheck
```

- `src/background/`: the service worker (session, sync, notifications).
- `src/content/`: the content script on portal pages (session hand-off, background sign-in).
- `src/dashboard/`: the Preact UI.
- `src/core/`: pure logic, most of it unit-tested.
- `tests/`: synthetic data only.

The portal's GraphQL gateway accepts only its own query texts, so the queries in
`src/background/queries.ts` are verbatim copies and must not be reformatted.

## Thanks

Thanks to [TinySec](https://x.com/TinySecEx) for the inspiration. His
[msrc-ext](https://github.com/tinysec/msrc-ext), an extension for the MSRC Researcher Portal,
showed how much a browser extension can add to it.
