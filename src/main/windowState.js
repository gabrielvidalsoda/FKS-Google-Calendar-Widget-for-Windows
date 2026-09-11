'use strict';

// Small, non-sensitive window position/size persistence. Deliberately not
// using the reference app's electron-settings dependency for this — a
// couple of JSON read/write calls is all Phase 1 needs, and it keeps this
// file obviously separate from auth.js's *sensitive* token storage.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

const DEFAULT_STATE = { width: 380, height: 640, x: undefined, y: undefined };

function loadWindowState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function trackWindowState(win) {
  const save = () => {
    try {
      const bounds = win.getBounds();
      fs.writeFileSync(statePath(), JSON.stringify(bounds));
    } catch {
      // best-effort only
    }
  };
  let timer = null;
  const debouncedSave = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 300);
  };
  win.on('resize', debouncedSave);
  win.on('move', debouncedSave);
  win.on('close', save);
}

module.exports = { loadWindowState, trackWindowState };
