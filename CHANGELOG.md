# Changelog

## 0.3.0 (2026-11-13)

### Added

- Case pages show the recorded cross-tenant impact and Windows Insider Canary reproduction answers.
- The report editor includes the portal's active-exploit discovery and scale fields, optional AI conversation ID, and link and CVSS limits.
- A report-wide Markdown preview is available from the new report's side panel, alongside the per-field Write/Preview tabs.
- The call stack field has its own Markdown preview, and the report-wide preview renders it the same way.
- The new-report form follows the portal's section order, puts attachments with the proof of concept, and uses the portal's 200-character title limit. Section headings and spacing have been refined.
- Before final submission, the dashboard can run MSRC's own AI case assessment and quality gates. It saves the report as a draft, shows the advice, then still requires typed confirmation to submit. A failed check can be bypassed explicitly.

## 0.2.2 (2026-11-12)

### Added

- **Time with MSRC.** Each open case counts its days against the 90-day mark common in
  coordinated disclosure (MSRC itself sets no fixed deadline). Board cards are tagged from 14 days
  before the mark ("Day 83 of 90") and after it ("Day 141, past 90"). They are also tagged when
  MSRC has been silent for 30 days ("MSRC silent since submission", "MSRC silent for 45 days"), or
  hasn't answered your message for 14 days ("No reply for 15 days"). The case page shows the day
  count with a bar to the mark, and when MSRC last wrote or changed the status. The clock stops
  once the case is complete or its CVE is public.
- **Screenshots** in the README: real cases, with identifying details scrambled and blurred.

### Fixed

- The header fit only from about 1360 px wide: the rules that hide the points and bounty chips on
  narrower windows never applied. It now fits at any desktop width; the search box gives way
  first, and below about 1120 px the header wraps onto two rows.
- The board's stage columns wrap onto a second row instead of widening the page.

## 0.2.1 (2026-11-12)

### Added

- **Action required.** When MSRC puts a case on hold until you reply, the board card gets a red
  badge, the case page shows what MSRC needs with a "Reply to MSRC" button, and the notification
  says "Action required: MSRC needs more information from you".
- **MSRC's word on each case.** The case page shows MSRC's banner for the case, read live as the
  portal does, and the portal's explanation of the status and the next step.
- **Planned disclosures.** Add, change or cancel a planned talk or blog post on a submitted case,
  as on the portal's Disclosure tab. Each change goes through a dialog; cancelling asks first,
  because a cancelled disclosure can't be reopened. This replaces the read-only Disclosure field.
- **MSRC announcements.** The portal's site-wide alert and banners appear at the top of the
  dashboard. Each can be dismissed; a changed text shows again.
- **Portal internals.** A page linked from Profile that shows what the portal publishes about
  itself: its AI pre-screening setup and categories, the environments and API hosts compiled into
  its script, its feature flags with MSRC's descriptions, its server switches, and the CVEs marked
  as actively exploited. Read without your session.

### Changed

- Clicking "MSRC Dashboard" in the header opens the Cases board and clears the search.
- A status-reason change is notified in plain words ("MSRC no longer needs information from you").

### Fixed

- The header no longer scrolls sideways in windows narrower than about 1600 px. As the window
  narrows, the search box shrinks, then the sync status, the awarded total and the points total
  hide. A sync error still shows.

## 0.2.0 (2026-11-12)

First release.

- Board of your cases by MSRC stage, with what changed since your last visit.
- Case page with every portal field and one timeline of messages, status changes and uploads.
- Desktop notifications for replies, status and bounty changes, and new CVEs.
- Public CVEs from the Security Update Guide that credit you, matched to the likely case.
- Recognition points, leaderboards and bounty totals.
- Report form with drafts on MSRC, local autosave, encrypted attachments and a confirmed submit.
- Messages to MSRC from each case, with a preview before sending.
- JSON export of all your cases, with a field guide for an LLM.
- Session kept alive in the background, so there's no daily sign-in.
