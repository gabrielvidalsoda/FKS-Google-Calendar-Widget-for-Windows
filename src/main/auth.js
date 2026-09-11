'use strict';

// OAuth sign-in for the widget: loopback-redirect + PKCE flow via the
// system's default browser (never an embedded webview) — per
// TECH-DESIGN.md §3.2, this is Google's current recommendation for
// "Desktop app" OAuth clients and avoids disallowed_useragent failures.

const http = require('http');
const { URL } = require('url');
const { app, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');
const { scoped } = require('./logger');
const { getCredentials } = require('./credentials');

const log = scoped('auth');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

// If Google shows an error on its own consent screen (e.g. 403 access_denied
// because the account isn't a test user), it never redirects back to the
// loopback server and the flow would otherwise hang forever. Give up after
// this long with an actionable message.
const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;

function tokenPath() {
  return path.join(app.getPath('userData'), 'refresh_token.enc');
}

function saveRefreshToken(refreshToken) {
  if (!safeStorage.isEncryptionAvailable()) {
    // Extremely unlikely on Windows, but fail loudly rather than silently
    // writing an unencrypted secret to disk.
    throw new Error('OS-level credential encryption is unavailable on this machine.');
  }
  const encrypted = safeStorage.encryptString(refreshToken);
  fs.writeFileSync(tokenPath(), encrypted);
}

function loadRefreshToken() {
  if (!fs.existsSync(tokenPath())) return null;
  const encrypted = fs.readFileSync(tokenPath());
  return safeStorage.decryptString(encrypted);
}

function clearRefreshToken() {
  if (fs.existsSync(tokenPath())) fs.unlinkSync(tokenPath());
}

function isSignedIn() {
  return fs.existsSync(tokenPath());
}

/**
 * Runs the full loopback OAuth flow: opens the system browser, listens on a
 * random localhost port for the redirect, exchanges the code for tokens,
 * and persists the refresh token (encrypted). Resolves when sign-in
 * completes.
 */
function signIn() {
  const { clientId, clientSecret } = getCredentials();

  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;

    // Wrap resolve/reject so we only ever act once and always tear down the
    // loopback server and the timeout.
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        server.close();
      } catch (_) {
        /* already closed */
      }
      if (err) {
        log.error('sign-in failed', err);
        reject(err);
      } else {
        log.info('sign-in complete — refresh token stored');
        resolve();
      }
    };

    const timer = setTimeout(() => {
      finish(
        new Error(
          `Sign-in timed out after ${SIGN_IN_TIMEOUT_MS / 1000}s. If the browser ` +
            'showed "Error 403: access_denied", the Google account is not listed ' +
            'as a test user on the OAuth consent screen (see SETUP.md step 5).'
        )
      );
    }, SIGN_IN_TIMEOUT_MS);

    server.on('error', finish);

    server.listen(0, '127.0.0.1', async () => {
      try {
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}`;
        const oAuth2Client = new OAuth2Client({ clientId, clientSecret, redirectUri });

        const { codeVerifier, codeChallenge } = await oAuth2Client.generateCodeVerifierAsync();

        const authUrl = oAuth2Client.generateAuthUrl({
          access_type: 'offline',
          scope: SCOPES,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          // Forces the consent screen every time, which guarantees Google
          // hands back a refresh_token even on a re-auth.
          prompt: 'consent',
        });

        log.info(`loopback listening on ${redirectUri} — opening browser for consent`);
        log.debug('auth URL', authUrl);

        server.on('request', async (req, res) => {
          try {
            const reqUrl = new URL(req.url, redirectUri);
            const code = reqUrl.searchParams.get('code');
            const errorParam = reqUrl.searchParams.get('error');

            if (errorParam) {
              const desc = reqUrl.searchParams.get('error_description');
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<html><body>Sign-in was cancelled. You can close this tab.</body></html>');
              finish(new Error(`OAuth error: ${errorParam}${desc ? ` (${desc})` : ''}`));
              return;
            }
            if (!code) return; // ignore favicon.ico etc. requests to the loopback server

            log.info('received authorization code — exchanging for tokens');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>Signed in — you can close this tab and return to the app.</body></html>');

            const { tokens } = await oAuth2Client.getToken({ code, codeVerifier });
            if (!tokens.refresh_token) {
              throw new Error(
                'Google did not return a refresh token. Try signing out and ' +
                  'signing in again (this can happen once per Google account per client).'
              );
            }
            saveRefreshToken(tokens.refresh_token);
            finish();
          } catch (err) {
            finish(err);
          }
        });

        await shell.openExternal(authUrl);
      } catch (err) {
        finish(err);
      }
    });
  });
}

function signOut() {
  clearRefreshToken();
  log.info('signed out — stored refresh token cleared');
}

/**
 * Returns an OAuth2Client hydrated with the stored refresh token, ready to
 * use with the googleapis Calendar client. google-auth-library refreshes
 * the short-lived access token automatically as needed.
 */
function getAuthorizedClient() {
  const refreshToken = loadRefreshToken();
  if (!refreshToken) return null;

  const { clientId, clientSecret } = getCredentials();
  const oAuth2Client = new OAuth2Client({ clientId, clientSecret });
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  return oAuth2Client;
}

module.exports = { signIn, signOut, isSignedIn, getAuthorizedClient };
