'use strict';

// Compact "what's happening right now" summary for the tray tooltip/icon
// (Phase 2, Part B). Works on the mapped event objects produced by
// calendar.js (`{ title, start, end, allDay, status }`), so the main
// process can build the tray summary without going through the renderer.

function timedBounds(ev) {
  return {
    start: new Date(ev.start.dateTime).getTime(),
    end: new Date(ev.end.dateTime).getTime(),
  };
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function clampTitle(s) {
  const t = (s || '(sem título)').trim();
  return t.length > 40 ? t.slice(0, 39) + '…' : t;
}

function relative(minutes) {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}

// Returns { state, minutesUntilNext, tooltip }.
//   state: 'now' | 'imminent' | 'soon' | 'clear' | 'signedOut'
function summarizeNow(events, now = new Date(), signedIn = true) {
  if (!signedIn) {
    return { state: 'signedOut', minutesUntilNext: null, tooltip: 'FKS Calendar Widget — clique para entrar' };
  }

  const nowMs = now.getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 24 * 3600 * 1000;

  const timed = [];
  let anyToday = false;
  for (const ev of events || []) {
    if (!ev.start || !ev.end) continue;
    const isTimed = Boolean(ev.start.dateTime);
    if (!isTimed) {
      // all-day: still counts as "something today" for the empty-state wording
      const s = new Date(ev.start.date + 'T00:00:00').getTime();
      const e = new Date(ev.end.date + 'T00:00:00').getTime();
      if (s < dayEnd && e > dayStart) anyToday = true;
      continue;
    }
    const { start, end } = timedBounds(ev);
    if (start >= dayEnd || end <= dayStart) continue;
    anyToday = true;
    if (ev.status === 'declined') continue;
    timed.push({ title: clampTitle(ev.title), start, end });
  }

  timed.sort((a, b) => a.start - b.start || a.end - b.end);
  const ongoing = timed.filter((t) => t.start <= nowMs && t.end > nowMs).sort((a, b) => a.end - b.end);
  const upcoming = timed.filter((t) => t.start > nowMs).sort((a, b) => a.start - b.start);

  if (ongoing.length) {
    const e = ongoing[0];
    const extra = ongoing.length > 1 ? ` (+${ongoing.length - 1})` : '';
    let tooltip = `Agora: ${e.title}${extra} · até ${fmtTime(e.end)}`;
    if (upcoming.length) {
      const n = upcoming[0];
      const m = Math.max(0, Math.round((n.start - nowMs) / 60000));
      tooltip += `\nDepois: ${n.title} (${m < 60 ? `em ${m} min` : fmtTime(n.start)})`;
    }
    return { state: 'now', minutesUntilNext: 0, tooltip };
  }

  if (upcoming.length) {
    const e = upcoming[0];
    const m = Math.max(0, Math.round((e.start - nowMs) / 60000));
    return {
      state: m <= 5 ? 'imminent' : 'soon',
      minutesUntilNext: m,
      tooltip: `Em ${relative(m)}: ${e.title} · ${fmtTime(e.start)}`,
    };
  }

  return {
    state: 'clear',
    minutesUntilNext: null,
    tooltip: anyToday ? 'Sem mais eventos hoje' : 'Sem eventos hoje',
  };
}

module.exports = { summarizeNow };
