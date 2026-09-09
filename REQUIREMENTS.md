# Google Calendar Desktop Widget — Requirements Document

Author: Gabriel Vidal (with Claude)
Status: Draft v2 — open questions resolved, ready to build
Date: 2026-09-09

## 1. Problem / Vision

Gabriel wants a lightweight Windows desktop widget that shows his Google Calendar
events without having to switch to a browser tab. The end-state widget should:

1. **Have a UI** — a small, always-visible calendar/agenda view.
2. **Float over other apps** — behave like the "Picture-in-Picture" video windows
   shown in the reference screenshot: a compact, draggable, always-on-top panel
   that sits on top of whatever else is open, not a normal window you have to
   alt-tab to.
3. **Notify** — surface upcoming events (native Windows notifications) without
   the user needing the widget in focus.

This document defines the full vision and a phased scope. **Phase 1 — the only
thing we're building right now** — is deliberately narrower: get the app running
locally on Windows and pulling real events from Google Calendar into a basic
UI. Overlay polish and notifications come in later phases, once the foundation
is solid.

## 2. Reference App Review

Gabriel pointed at an existing open-source project
(`p32929/google-calender-widget`, Electron-based) as a starting point. Reviewed
its source (`index.js`, `package.json`, `stateKeeper.js`) directly. Findings:

**What it does:** Opens a normal (non-overlay) Electron `BrowserWindow` that
loads the *real* `calendar.google.com` web app, logs in through Google's actual
sign-in pages, then injects custom CSS and JS into the live page to restyle it
("Agenda view + dark mode") and scrapes the rendered DOM (selectors like
`.gb_Cd`, `.E9bth-BIzmGd`, `[data-gcw-year-month]`) to detect the current view
and clean up the layout.

**Why we are not copying this approach:**

- It's screen-scraping Google's obfuscated, frequently-changing internal CSS
  class names. Every Google Calendar frontend release is a risk of silent
  breakage — there's no API contract, just DOM structure that can shift at any
  time.
- Logging in through an embedded Chromium `BrowserWindow` against Google's real
  sign-in flow is exactly the pattern Google's current policy targets with
  `disallowed_useragent` errors for embedded/automated browsers. It may work
  today and stop working without warning.
- It explicitly disables `alwaysOnTop` ("Never set the window to always be on
  top" — comment in the code) and ships a normal resizable/maximizable window
  with a taskbar-hideable tray icon. It does **not** actually implement the
  overlay/PiP behavior Gabriel wants — it's a mini browser, not a widget.
- No use of the official Google Calendar API at all, so there's no structured
  event data to build real features (notifications, filtering, custom
  rendering) on top of — everything would have to come from scraping.

**What's worth keeping as inspiration:**
- The overall shape (Electron, system tray, remembers window position/size via
  a small `windowStateKeeper` helper, `electron-builder` for packaging).
- The idea of an Agenda view + dark mode as the default look.

**Decision:** build on the same general tech family (Electron) since it's a
good fit for this feature set, but talk to Google Calendar through the
**official REST API** with normal OAuth, and build our **own UI** from
structured event data instead of restyling Google's live site. Full rationale
in the companion tech draft.

## 3. Scope

### Phase 1 (this build) — "See my events, running locally"
- Sign in with Google (OAuth) from the desktop app.
- Read **every calendar on the account** (not just primary — includes
  secondary and shared calendars the account has access to) and fetch
  upcoming events (read-only).
- Display **all events regardless of response status** (accepted, tentative,
  declined) — matching what Google Calendar's own homepage shows by default,
  with declined events rendered struck-through rather than hidden.
- Display events in a UI visually modeled on the **macOS Calendar / Notification
  Center widget** look Gabriel shared (compact card, per-day header, rounded
  corners, colored event chips) — the visual style lands in Phase 1 even
  though the true always-on-top/overlay window *mechanics* are still Phase 2.
- Manual refresh, plus auto-refresh every 5 minutes.
- Runs entirely on Gabriel's machine — no backend server, no data leaving his
  computer except direct calls to Google's API.
- Basic system tray icon (quit, refresh, sign out).

### Phase 2 — Overlay / "Picture-in-Picture" behavior
- Frameless, draggable, resizable, always-on-top window.
- Remembers position and size across restarts.
- Optional click-through / transparency mode.
- Compact "mini" view vs expanded agenda view.

### Phase 3 — Notifications
- Native Windows toast notifications for upcoming events.
- Configurable lead time (e.g., 10 min before).
- No duplicate notifications for the same event.

### Phase 4 — Settings & polish
- Choose which calendars to show, colors, refresh interval, notification
  lead time, launch-at-login, light/dark theme.
- Installer/packaging polish, auto-update (maybe).

### Explicitly out of scope for now
- Creating, editing, or deleting events (read-only widget for now).
- Multi-account support.
- Mac/Linux builds (Electron keeps this possible later, but Windows is the
  only target we're validating against right now).
- Any cloud component, sync service, or account system of our own.

## 4. Functional Requirements (Phase 1)

| # | Requirement |
|---|---|
| F1 | User can sign in with their Google account via a standard, trustworthy OAuth flow (system browser, not an embedded login page). |
| F2 | App requests only calendar **read** access (`calendar.readonly` scope). |
| F3 | App lists **all** of the user's calendars and shows events from all of them, not just primary. |
| F4 | App displays upcoming events (title, start/end time, location if present) grouped by day, styled like the macOS Calendar widget (card layout, colored chips per calendar). |
| F5 | App correctly handles all-day events and the user's local timezone. |
| F6 | User can manually refresh; app also auto-refreshes every 5 minutes. |
| F7 | Sign-out clears stored credentials locally. |
| F8 | App persists sign-in across restarts (no need to log in every launch). |
| F9 | Events show regardless of RSVP status (accepted/tentative/declined), declined events struck-through — same as Google Calendar's own default view. |

## 5. Non-Functional Requirements

- **Security/privacy:** OAuth tokens stored using OS-level encrypted storage
  (not plain JSON). Read-only scope only. No telemetry/analytics by default.
- **Resilience:** graceful handling of no network / expired token / revoked
  access — app shouldn't crash, should show a clear "reconnect" state.
- **Performance:** idle resource usage should be modest — this is meant to sit
  open constantly in the background.
- **Portability of intent:** avoid Windows-only APIs at the architecture level
  where it costs nothing, since Electron makes Mac/Linux a plausible future
  target, but Windows is the only platform we test/build for in Phase 1.

## 6. Assumptions

- Gabriel has (or will create) a Google Cloud project to register an OAuth
  "Desktop app" client for this project — required to call the Calendar API.
- A single Google account/calendar set is enough for Phase 1.
- "Local only" means no self-hosted backend and no third-party server between
  the app and Google's API — direct calls from the desktop app.

## 7. Decisions (previously open questions — now resolved)

1. **Calendars:** all calendars on the account, not just primary.
2. **Look:** macOS Calendar / Notification Center widget style (screenshot
   provided) — compact card, day header, rounded corners, colored chips.
3. **Refresh interval:** every 5 minutes, confirmed.
4. **Event visibility:** all statuses shown (accepted/tentative/declined),
   same as Google Calendar's own homepage default.
5. **Google Cloud project:** confirmed OK, and already created by Gabriel.
   No cost involved (see chat) — free tier quota is far more than a
   single-user widget will ever use.

## 8. Roadmap Summary

Phase 1 (now) → Phase 2 (overlay/PiP behavior) → Phase 3 (notifications) →
Phase 4 (settings & packaging polish), each phase reviewed with Gabriel before
moving to the next, per his preferred way of working through multi-step builds.
