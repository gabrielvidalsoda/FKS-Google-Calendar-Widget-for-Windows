# Phase 1 setup — running the MVP locally

## 1. Google Cloud credentials

The OAuth **Desktop app** client ships with the app in
[`src/config/oauth.json`](src/config/oauth.json) — for an installed/desktop
client Google does not treat the secret as confidential (PKCE is the real
protection), so a fresh clone runs with **no setup here**.

To point the app at a *different* Google Cloud project while developing, copy
`.env.example` to `.env` and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
— those take precedence over the bundled file. `.env` is gitignored.

Publishing status: the app is in **Production** (unverified). Any Google
account can sign in after clicking through the "Google hasn't verified this
app" screen, up to Google's 100-user cap for unverified sensitive-scope apps.
See TECH-DESIGN.md §9 for what full verification would take.

No other Google-side info is needed — the app requests the
`calendar.readonly` scope itself and talks directly to the Calendar API.

## 2. Install & run

```
npm install
npm start
```

First run: a small window opens with a "Sign in with Google" button. Clicking
it opens your **default browser** (not a popup inside the app) to Google's
real sign-in page. Approve access, and the browser tab will say you can close
it — control returns to the app automatically. Your events should load within
a couple seconds.

Sign-in persists across restarts (the refresh token is encrypted on disk via
Windows DPAPI through Electron's `safeStorage`). Use the tray icon to
manually refresh or sign out.

## Troubleshooting sign-in

The main process logs to the terminal running `npm start`. Every sign-in and
Calendar API step prints a timestamped line; failures print the Google error
code and description. For the full auth URL and stack traces, run with
`FKS_LOG_LEVEL=debug` (PowerShell: `$env:FKS_LOG_LEVEL='debug'; npm start`).

**"Google hasn't verified this app" screen** — expected while the app is in
Production but unverified. Click **Advanced → Go to FKS Calendar Widget
(unsafe)** to continue. It disappears once the app passes OAuth verification.

**`Error 403: access_denied` in the browser** — Google denied the request on
its own consent screen (the app never sees a code, so sign-in times out after
3 minutes with a message). Possible causes:
- The publishing status is still **Testing** and the account isn't a test
  user — either publish to Production (Google Cloud Console → **Google Auth
  Platform → Audience → Publish app**) or add the account under **Test
  users → + Add users**.
- The account belongs to a Google Workspace org that blocks unverified
  third-party apps — an org admin has to allow it, or use a personal account.
- Consent screen user type is **Internal** (only same-org accounts) instead
  of **External**, or app name / support email / developer contact email are
  missing.

## Known Phase 1 simplifications (see judgment-call log in TECH-DESIGN.md §8)

- Each refresh re-fetches the full ±14-day window per calendar rather than
  using `nextSyncToken` incremental sync. At this scale (a handful of
  calendars, 5-minute polling) the cost difference is negligible, and it
  keeps the MVP simpler. Worth revisiting only if calendar count grows a lot.
- Window is a normal framed, resizable window — no overlay/always-on-top yet
  (that's Phase 2, per REQUIREMENTS.md).
