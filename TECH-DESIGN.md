# Google Calendar Desktop Widget — Solution / Tech Draft

Status: Draft v2 — open questions resolved, ready to build
Date: 2026-09-09
Companion doc: REQUIREMENTS.md

## 1. Recommended Stack

**Electron + Node.js**, using the official `googleapis` npm package for
Calendar API access, and a plain HTML/CSS/vanilla-JS (or lightweight
Preact) renderer for the UI.

### Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Electron** (recommended) | Mature `alwaysOnTop`/frameless/transparent window APIs, native `Notification` → Windows Action Center toasts out of the box, huge ecosystem, same family as the reference project so tooling/packaging knowledge transfers, fast to iterate. | Heavier memory footprint than native; ships a Chromium runtime. | **Use for Phase 1.** Memory overhead is a non-issue for a background widget on a modern machine, and dev speed matters more right now. |
| **Tauri** (Rust + WebView2) | Much smaller binary/RAM footprint, same web-UI development model. | Smaller ecosystem for the OAuth loopback + always-on-top + tray + toast combo; more plumbing to hand-roll on Windows via WebView2. | Worth revisiting in a later phase once the UI is stable, if resource usage becomes a real concern. Not a Phase 1 blocker either way. |
| **Native WinUI 3 / WPF (C#)** | Best-in-class Windows overlay/notification integration, smallest footprint. | Windows-only by construction, steeper setup, no reuse of the JS ecosystem, slower iteration for a fast-moving personal project. | Not recommended — loses cross-platform optionality for no benefit at this stage. |

## 2. High-Level Architecture

```
┌─────────────────────────────┐
│         Electron App         │
│                               │
│  ┌────────────┐   IPC   ┌───────────────┐ │
│  │ Main process│◄───────►│ Renderer (UI) │ │
│  │  (Node.js)  │         │ HTML/CSS/JS   │ │
│  └─────┬───────┘         └───────────────┘ │
│        │                                    │
│  ┌─────▼───────────────────────────────┐    │
│  │  Auth module   (OAuth + token store) │    │
│  │  Calendar module (googleapis client) │    │
│  │  Scheduler (poll / sync token)       │    │
│  │  Window/tray manager                 │    │
│  └───────────────────────────────────────┘   │
└─────────────────┬─────────────────────────┘
                   │ HTTPS
                   ▼
         Google Calendar API v3
```

- **Main process** owns everything privileged: OAuth flow, token storage,
  calling Google's API, scheduling refresh. The renderer never talks to
  Google directly — it only receives already-fetched event data over IPC.
  This keeps the OAuth client credentials and tokens out of the
  renderer/DevTools entirely.
- **Renderer** is a simple UI layer: agenda list, loading/error states, sign-in
  button. Keep it framework-light for Phase 1 — plain JS is enough for a list
  view; revisit if the settings UI (Phase 4) gets complex.

## 3. Google Calendar Integration

### 3.1 OAuth setup
- Register an OAuth client in Google Cloud Console as application type
  **"Desktop app"** (not "Web application"). This is Google's currently
  recommended client type for exactly this scenario, and — unlike Chrome/iOS/
  Android client types — it still fully supports the loopback redirect flow.
- Client secret is technically optional for this client type but Google still
  issues one for Desktop clients; treat it as non-secret-but-not-published
  (standard guidance for public/native clients) rather than a true server
  secret.
- Request scope `https://www.googleapis.com/auth/calendar.readonly` only —
  least privilege for a read-only widget (see REQUIREMENTS.md F2).

### 3.2 Sign-in flow (do **not** copy the reference app's embedded-webview login)
1. App starts a temporary local HTTP server on `127.0.0.1` (random free port).
2. App builds the Google auth URL with PKCE (code verifier/challenge, S256)
   and `redirect_uri=http://127.0.0.1:<port>`.
3. App opens the URL in the **system's default browser** (`shell.openExternal`
   in Electron) — never an embedded `BrowserWindow`. This matches Google's
   current policy and avoids `disallowed_useragent` failures, and is generally
   more trustworthy for the user (they see their own real, already-logged-in
   Chrome/Edge, not an app-controlled window asking for a Google password).
4. User approves in the browser; Google redirects to the loopback server with
   the auth code.
5. App's local server catches the redirect, closes itself, and the main
   process exchanges the code (+ PKCE verifier) for access/refresh tokens.
6. Bring the Electron window back to focus to confirm sign-in succeeded.

### 3.3 Token storage
- Use Electron's `safeStorage` module (backed by Windows DPAPI) to encrypt the
  refresh token before writing it to disk in the app's userData directory.
  **Do not** reuse the reference app's pattern of storing things as plain JSON
  via `electron-settings` for anything sensitive — that's fine for non-secret
  UI state (window position/size) but not for tokens.
- Access tokens are short-lived and kept in memory; refresh token is what
  persists sign-in across restarts.

### 3.4 Fetching events
- Use the `googleapis` npm package (`google-auth-library` + `calendar_v3`)
  rather than hand-rolled REST calls — handles token refresh automatically.
- `calendarList.list()` to get **every calendar the account has** (primary,
  secondary, and shared) — confirmed scope per REQUIREMENTS.md §7.1.
- `events.list()` per calendar ID, with a time range (e.g. now → +14 days) for
  the initial load. Do **not** pass any status filter — fetch accepted,
  tentative, and declined events alike (`declined` events aren't excluded by
  the API by default; we just need to *render* them struck-through rather
  than filtering them out, matching Google Calendar's own default view).
- Merge results from all calendars into one unified event list client-side,
  tagging each event with its source calendar's ID/color so the UI can render
  per-calendar color chips.
- For refreshes, use **incremental sync** (`nextSyncToken` returned by
  `events.list`) per calendar instead of always re-fetching a full window —
  cheaper and faster, and naturally handles changed/cancelled events.
- Poll every 5 minutes (confirmed default) plus a manual refresh button.
  **Not** using Google's push notification channels (webhooks) for Phase 1 —
  those require a publicly reachable HTTPS endpoint, which conflicts with the
  "runs entirely locally" requirement. Revisit only if a near-real-time
  requirement shows up later (would need something like a tunnel or a small
  relay, out of scope for now).
- With potentially several calendars × 5-minute polling, usage stays trivial
  against the free quota (10,000 req/min, 1M/day per project) — no cost
  concern at this scale.

## 4. UI / Window Design (Phase 1 slice; full overlay behavior is Phase 2)

- **Visual target (confirmed):** the macOS Calendar / Notification Center
  widget style Gabriel shared — a compact rounded card, bold day-number
  header ("MONDAY 5" style), a stacked list of time-stamped events below it,
  subtle translucency, and small colored chips/dots to distinguish which
  calendar each event belongs to. This visual direction ships in **Phase 1**
  — it's just CSS/layout, no extra risk — even though the window is still a
  normal framed window at this stage.
- Phase 1: a normal small `BrowserWindow` (resizable, has a frame) rendering
  that macOS-widget-style card/agenda layout — get the data pipeline and
  visual design correct before layering on overlay *mechanics*.
- Phase 2 will convert the window itself into the PiP-style overlay from the
  first screenshot: `frame: false`, `alwaysOnTop: true` (with the
  `'screen-saver'` level on Windows so it stays above fullscreen apps too),
  `transparent: true` optionally, `setIgnoreMouseEvents` for click-through
  mode, custom drag region via `-webkit-app-region: drag` on a title bar
  strip, and window state persistence (reuse the reference app's
  `windowStateKeeper` idea, just without the sensitive-data concerns since it
  only stores x/y/width/height). The card-style UI from Phase 1 carries over
  unchanged — Phase 2 only changes how the window behaves, not how it looks.
- Known Electron quirks to watch for when we get to Phase 2: click-through
  (`setIgnoreMouseEvents`) has had platform-specific bugs on Linux/X11
  (not a Windows concern for us); always-on-top rendering has historically had
  issues under OpenGL/Vulkan but is fine on Electron's default Direct3D
  backend on Windows.

## 5. Notifications (Phase 3, design sketch only)

- Use Electron's built-in `Notification` API — on Windows 10/11 this surfaces
  as a native Action Center toast automatically, no extra native module
  needed.
- Set `app.setAppUserModelId(...)` early in the main process so toasts show
  the widget's name/icon correctly instead of "Electron".
- Compute lead time against each event's start (`dateTime` + `timeZone`, or
  `date` for all-day events) and keep a small in-memory/disk set of
  "already notified" event IDs to avoid duplicates across refresh cycles.

## 6. Packaging

- `electron-builder`, Windows target `nsis`, same tool the reference project
  uses — no reason to deviate here, it's a solid default.
- Defer auto-update, code signing, and installer polish to Phase 4.

## 7. Project Structure (proposed)

```
google-calendar-widget/
├── package.json
├── src/
│   ├── main/
│   │   ├── index.js            # app entry, window/tray management
│   │   ├── auth.js              # OAuth + token storage
│   │   ├── calendar.js          # googleapis calls, sync-token cache
│   │   └── windowState.js       # position/size persistence
│   ├── preload/
│   │   └── preload.js           # contextBridge, minimal IPC surface
│   └── renderer/
│       ├── index.html
│       ├── styles.css
│       └── app.js               # agenda rendering, sign-in UI
├── resources/
│   └── icon.ico / icon.png
└── REQUIREMENTS.md / TECH-DESIGN.md   # this pair of docs
```

## 8. Key Decisions & Rationale (judgment-call log)

1. **Official Calendar API instead of DOM-scraping `calendar.google.com`
   (what the reference repo does).** Scraping obfuscated, frequently-changing
   Google CSS classes is fragile and could break on any Google frontend
   release; the API gives structured, stable data to build real features on.
2. **Loopback-redirect OAuth via the system browser, not an embedded
   Electron webview for login.** This is Google's current documented
   recommendation for Desktop app clients, and embedded-webview Google
   sign-ins are increasingly blocked (`disallowed_useragent`). Confirmed via
   Google's own OAuth-for-native-apps and loopback-migration docs (Sept 2026).
3. **`calendar.readonly` scope only for Phase 1.** Least privilege for a
   "see my events" goal; broaden only if/when event creation becomes a
   real feature.
4. **Electron over native WinUI/WPF, with Tauri flagged as a later option.**
   Electron gets us to a working overlay+tray+notification widget fastest and
   reuses lessons from the reference project; Tauri is worth a second look
   once the UI has stabilized if memory footprint matters.
5. **Polling with incremental sync tokens instead of Calendar API push
   webhooks.** Webhooks need a public HTTPS endpoint, which conflicts with
   "runs entirely locally" for Phase 1.
6. **Don't reuse the reference app's plain-JSON `electron-settings` storage
   for tokens.** Fine for non-sensitive window-state prefs; OAuth tokens go
   through Electron `safeStorage` (Windows DPAPI-backed encryption) instead.
7. **Phase 1 ships a normal window, not the full PiP overlay, on purpose.**
   Get auth + data fetching + basic rendering solid first, then layer on
   `alwaysOnTop`/frameless/click-through behavior in Phase 2 — smaller,
   reviewable steps rather than one big first commit.

## 9. Google Cloud Setup Checklist (project already created)

Three things needed in the existing Google Cloud project, all free, no
billing account required:

1. **Enable the API** — APIs & Services → Library → search "Google Calendar
   API" → Enable.
2. **Configure the OAuth consent screen** — APIs & Services → OAuth consent
   screen (may show as "Branding" / "Audience" in the current console):
   - User type: **External** (personal Gmail account, not Workspace).
   - App name, support email, developer contact email — anything reasonable,
     only Gabriel will ever see this screen.
   - Scope: add `.../auth/calendar.readonly`.
   - Publishing status: **Production, unverified** (changed from the original
     single-user "keep in Testing" plan — the app is now meant for any Google
     user). Consequences: users see a one-time "Google hasn't verified this
     app" screen they click through, and Google caps unverified
     sensitive-scope apps at 100 authorized users. Removing both requires
     OAuth verification: a domain verified in Search Console, a public
     homepage + privacy policy on that domain, a 120×120 app logo, a written
     scope justification, and a demo video. No paid CASA security assessment
     — that is only for *restricted* scopes, and `calendar.readonly` is
     *sensitive*. Not yet done.
   - Test users: only relevant if the status is ever moved back to Testing.
3. **Create the OAuth client ID** — APIs & Services → Credentials → Create
   Credentials → OAuth client ID → Application type: **Desktop app** → name
   it (e.g. "Calendar Widget Desktop") → Create. The Client ID and Client
   secret live in `src/config/oauth.json`, committed and bundled into the
   build. For an installed/desktop client Google does not treat the secret as
   confidential (the secret is extractable from any distributed binary
   anyway) — PKCE in `auth.js` is the real protection. A local `.env`
   (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) overrides the bundled file
   for pointing at a different project in dev.

Caveat worth knowing: in Testing mode refresh tokens can expire after 7 days
of inactivity; in Production (even unverified) they persist normally, so this
no longer applies.

## Sources consulted

- [OAuth 2.0 for iOS & Desktop Apps — Google for Developers](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Loopback IP Address Flow Migration Guide — Google for Developers](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration)
- [Using OAuth 2.0 to Access Google APIs — Google for Developers](https://developers.google.com/identity/protocols/oauth2)
- [electron/electron issue #3888 — transparent always-on-top windows](https://github.com/electron/electron/issues/3888)
- [electron/electron issue #1335 — click-through transparency](https://github.com/electron/electron/issues/1335)
- [electron/electron issue #8530 — alwaysOnTop with OpenGL/Vulkan](https://github.com/electron/electron/issues/8530)
- Reference repo reviewed directly: `p32929/google-calender-widget` (local copy at
  `C:\Users\Usuario\Documents\Open source apps\google-calender-widget`)
