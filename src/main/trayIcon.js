'use strict';

// Tray icon variants for the "now" summary (Phase 2, Part B). The base
// 32×32 app icon is reused as-is; for an active state we composite a small
// status dot into the bottom-right corner so the tray gives a passive,
// glanceable signal without the user having to hover for the tooltip.

const path = require('path');
const { nativeImage } = require('electron');

const BASE_PATH = path.join(__dirname, '..', '..', 'resources', 'icon.png');

// [r, g, b] per state; `null` means "plain base icon, no dot".
const DOT_COLOR = {
  now: [48, 209, 88], // green  — an event is happening
  imminent: [255, 159, 10], // amber  — starts within 5 min
  soon: [10, 132, 255], // blue   — next event later today
  clear: null,
  signedOut: null,
};

const cache = new Map();
let base = null; // { data: Buffer (BGRA, premultiplied), width, height }

function loadBase() {
  if (base) return base;
  const img = nativeImage.createFromPath(BASE_PATH);
  const { width, height } = img.getSize();
  base = { data: img.toBitmap(), width, height };
  return base;
}

function iconForState(state) {
  if (cache.has(state)) return cache.get(state);

  const color = DOT_COLOR[state] || null;
  let img;

  if (!color) {
    img = nativeImage.createFromPath(BASE_PATH);
  } else {
    const { data, width: w, height: h } = loadBase();
    const buf = Buffer.from(data); // copy — never mutate the cached base
    const radius = Math.round(w * 0.32);
    const cx = w - radius - 1;
    const cy = h - radius - 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > radius + 0.5) continue;
        const ring = d > radius - 1.4; // thin dark outline for contrast
        const i = (y * w + x) * 4;
        buf[i] = ring ? 22 : color[2]; // B
        buf[i + 1] = ring ? 22 : color[1]; // G
        buf[i + 2] = ring ? 22 : color[0]; // R
        buf[i + 3] = 255; // A (opaque → premultiplied == straight)
      }
    }
    img = nativeImage.createFromBitmap(buf, { width: w, height: h });
  }

  cache.set(state, img);
  return img;
}

module.exports = { iconForState };
