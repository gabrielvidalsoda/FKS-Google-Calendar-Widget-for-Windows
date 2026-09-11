'use strict';

// Tiny structured logger for the main process. Everything here goes to the
// terminal that ran `npm start` (Electron pipes main-process stdout/stderr
// there) so sign-in / Calendar API failures are visible without opening
// DevTools. Renderer errors still show in the window UI as before.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.FKS_LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function emit(level, scope, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  let line = `${ts()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (extra !== undefined) line += ` ${format(extra)}`;
  stream.write(line + '\n');
}

// Google API / OAuth errors bury the useful part (the server's error code and
// description) a few levels deep. Pull it up so a single log line explains
// what actually went wrong.
function format(extra) {
  if (extra instanceof Error) {
    const parts = [extra.message];
    const data = extra.response && extra.response.data;
    if (data) {
      const detail = data.error_description || data.error || data;
      parts.push(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    if (extra.code && !parts[0].includes(String(extra.code))) parts.push(`code=${extra.code}`);
    if (process.env.FKS_LOG_LEVEL === 'debug' && extra.stack) parts.push('\n' + extra.stack);
    return parts.join(' | ');
  }
  return typeof extra === 'string' ? extra : JSON.stringify(extra);
}

// One logger per module: log.info('did a thing', maybeErrorOrObject)
function scoped(scope) {
  return {
    debug: (msg, extra) => emit('debug', scope, msg, extra),
    info: (msg, extra) => emit('info', scope, msg, extra),
    warn: (msg, extra) => emit('warn', scope, msg, extra),
    error: (msg, extra) => emit('error', scope, msg, extra),
  };
}

module.exports = { scoped };
