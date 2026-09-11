'use strict';

require('dotenv').config();

const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const auth = require('./auth');
const { fetchAllEvents } = require('./calendar');
const { loadWindowState, trackWindowState } = require('./windowState');
const { summarizeNow } = require('./agendaStatus');
const { iconForState } = require('./trayIcon');
const { scoped } = require('./logger');

const log = scoped('main');

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // F6: auto-refresh every 5 minutes
const TRAY_TICK_MS = 60 * 1000; // recompute the "now" summary once a minute

// Last-resort catch-all so nothing fails silently in the terminal.
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));
process.on('uncaughtException', (err) => log.error('uncaughtException', err));

let mainWindow = null;
let tray = null;
let refreshTimer = null;
let trayTickTimer = null;
let latestEvents = []; // last successful fetch, for the tray summary
let appQuitting = false; // true once the user really wants to exit (tray → Sair)

app.setAppUserModelId('com.gabrielvidal.fkscalendarwidget');

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 300,
    minHeight: 400,
    title: 'FKS Calendar Widget',
    // Phase 1 is a normal framed window on purpose — see TECH-DESIGN.md §4.
    // Phase 2 turns this into the frameless/always-on-top overlay.
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  trackWindowState(mainWindow);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Part B: the widget lives in the tray. Closing the window just hides it
  // (so the tray summary keeps updating); real exit goes through tray → Sair.
  mainWindow.on('close', (event) => {
    if (!appQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(iconForState('signedOut'));
  tray.setToolTip('FKS Calendar Widget');
  // Windows fires 'click' for a single left-click on the tray icon.
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir widget', click: () => showWindow() },
      { label: 'Atualizar agora', click: () => pushEvents() },
      { type: 'separator' },
      { label: 'Sair da conta', click: () => handleSignOut() },
      { label: 'Sair', click: () => { appQuitting = true; app.quit(); } },
    ])
  );
}

// Refresh the tray tooltip + status-dot icon from the last known events.
// Cheap and idempotent — safe to call on every fetch and on the 1-min tick.
function refreshTraySummary() {
  if (!tray) return;
  const summary = summarizeNow(latestEvents, new Date(), auth.isSignedIn());
  tray.setToolTip(summary.tooltip);
  tray.setImage(iconForState(summary.state));

  // Gentle nudge for an imminent event when the widget isn't already in front.
  if (mainWindow) {
    const nudge = summary.state === 'imminent' && !mainWindow.isFocused();
    mainWindow.flashFrame(nudge);
  }
}

function startTrayTick() {
  clearInterval(trayTickTimer);
  trayTickTimer = setInterval(refreshTraySummary, TRAY_TICK_MS);
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function pushEvents() {
  const client = auth.getAuthorizedClient();
  if (!client) {
    latestEvents = [];
    refreshTraySummary();
    sendToRenderer('auth:state', { signedIn: false });
    return;
  }
  try {
    const { events, calendarErrors } = await fetchAllEvents(client);
    latestEvents = events;
    refreshTraySummary();
    sendToRenderer('auth:state', { signedIn: true });
    sendToRenderer('calendar:events', { events, calendarErrors });
  } catch (err) {
    log.error('refresh failed', err);
    sendToRenderer('calendar:error', { message: err.message });
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(pushEvents, REFRESH_INTERVAL_MS);
}

async function handleSignOut() {
  auth.signOut();
  latestEvents = [];
  refreshTraySummary();
  sendToRenderer('auth:state', { signedIn: false });
}

ipcMain.handle('auth:signIn', async () => {
  log.info('sign-in requested');
  try {
    await auth.signIn();
  } catch (err) {
    log.error('sign-in request failed', err);
    throw err; // renderer shows err.message on the sign-in screen
  }
  await pushEvents();
  return { signedIn: true };
});

ipcMain.handle('auth:signOut', async () => {
  await handleSignOut();
  return { signedIn: false };
});

ipcMain.handle('auth:status', async () => ({ signedIn: auth.isSignedIn() }));

ipcMain.handle('calendar:refresh', async () => {
  await pushEvents();
  return {};
});

// Tray app: a second launch should just surface the existing instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    log.info(`FKS Calendar Widget starting (electron ${process.versions.electron})`);
    createWindow();
    createTray();
    startAutoRefresh();
    startTrayTick();
    refreshTraySummary();
    if (auth.isSignedIn()) {
      log.info('existing session found — refreshing on startup');
      pushEvents();
    } else {
      log.info('no stored session — waiting for sign-in');
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  appQuitting = true;
});

app.on('window-all-closed', () => {
  // Part B: the widget keeps running in the tray with no window open.
  // Real exit happens via the tray menu ("Sair"), which sets appQuitting.
  if (appQuitting && process.platform !== 'darwin') app.quit();
});
