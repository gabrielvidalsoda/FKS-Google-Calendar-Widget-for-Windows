'use strict';

// Minimal IPC surface exposed to the renderer. The renderer never talks to
// Google or handles tokens directly — it only receives already-fetched
// event data, per TECH-DESIGN.md §2.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fksCalendar', {
  signIn: () => ipcRenderer.invoke('auth:signIn'),
  signOut: () => ipcRenderer.invoke('auth:signOut'),
  refresh: () => ipcRenderer.invoke('calendar:refresh'),
  getStatus: () => ipcRenderer.invoke('auth:status'),

  onAuthState: (callback) => {
    ipcRenderer.on('auth:state', (_event, state) => callback(state));
  },
  onEvents: (callback) => {
    ipcRenderer.on('calendar:events', (_event, payload) => callback(payload));
  },
  onError: (callback) => {
    ipcRenderer.on('calendar:error', (_event, err) => callback(err));
  },
});
