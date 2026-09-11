'use strict';

// Resolves the OAuth "Desktop app" client credentials.
//
// Precedence:
//   1. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from the environment (a local
//      .env in dev) — lets a developer point at a different Cloud project
//      without touching committed files.
//   2. src/config/oauth.json — committed and bundled into the packaged app so
//      that every user's install can sign in. Safe for a desktop client: see
//      the note in that file.

const path = require('path');
const { scoped } = require('./logger');

const log = scoped('credentials');

function fromEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret, source: 'env' };
  return null;
}

function fromBundle() {
  try {
    const cfg = require(path.join(__dirname, '..', 'config', 'oauth.json'));
    if (cfg && cfg.clientId && cfg.clientSecret) {
      return { clientId: cfg.clientId, clientSecret: cfg.clientSecret, source: 'bundle' };
    }
    log.error('src/config/oauth.json is missing clientId/clientSecret');
  } catch (err) {
    log.error('could not load src/config/oauth.json', err);
  }
  return null;
}

let cached = null;

function getCredentials() {
  if (cached) return cached;
  const resolved = fromEnv() || fromBundle();
  if (!resolved) {
    throw new Error(
      'No OAuth credentials available. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ' +
        'in a .env file, or provide src/config/oauth.json (see SETUP.md).'
    );
  }
  log.info(`using OAuth client from ${resolved.source} (${resolved.clientId.slice(0, 24)}…)`);
  cached = { clientId: resolved.clientId, clientSecret: resolved.clientSecret };
  return cached;
}

module.exports = { getCredentials };
