'use strict';

const screens = {
  signin: document.getElementById('signin-screen'),
  loading: document.getElementById('loading-screen'),
  agenda: document.getElementById('agenda-screen'),
};

// Time-grid geometry for the "Hoje" view.
const PX_PER_HOUR = 56;
const GRID_HEIGHT = PX_PER_HOUR * 24;

let latestPayload = { events: [], calendarErrors: [] };
let currentView = 'today';
let todayNeedsScroll = true;
let renderedDayKey = null;
let nowTimer = null;

try {
  const saved = localStorage.getItem('fks.view');
  if (saved === 'today' || saved === 'agenda') currentView = saved;
} catch {
  /* localStorage unavailable — fall back to default view */
}

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('hidden', key !== name);
  }
}

/* ---- shared helpers ------------------------------------------------- */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function eventStartDate(ev) {
  return new Date(ev.allDay ? ev.start.date + 'T00:00:00' : ev.start.dateTime);
}

function eventEndDate(ev) {
  return new Date(ev.allDay ? ev.end.date + 'T00:00:00' : ev.end.dateTime);
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtRange(a, b) {
  return `${fmtTime(a)} – ${fmtTime(b)}`;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hexToRgba(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return `rgba(10, 132, 255, ${a})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

/* ---- agenda (multi-day list) view --------------------------------- */

function formatDayHeader(dateKey) {
  const date = new Date(dateKey + 'T00:00:00');
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function dayKeyFor(event) {
  const raw = event.allDay ? event.start.date : event.start.dateTime;
  const d = new Date(raw);
  // Local-timezone day key (F5: handle the user's local timezone correctly).
  return localDayKey(d);
}

function formatEventTime(event) {
  if (event.allDay) return 'All day';
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const opts = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString(undefined, opts)} – ${end.toLocaleTimeString(undefined, opts)}`;
}

function renderAgenda({ events, calendarErrors }) {
  const list = document.getElementById('agenda-list');
  list.innerHTML = '';

  if (!events.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No events in the next two weeks.';
    empty.style.color = 'var(--muted)';
    list.appendChild(empty);
  }

  const groups = new Map();
  for (const ev of events) {
    const key = dayKeyFor(ev);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }

  for (const [dayKey, dayEvents] of groups) {
    const group = document.createElement('div');
    group.className = 'day-group';

    const header = document.createElement('div');
    header.className = 'day-header';
    header.textContent = formatDayHeader(dayKey);
    group.appendChild(header);

    for (const ev of dayEvents) {
      const card = document.createElement('div');
      card.className = 'event-card' + (ev.status === 'declined' ? ' event-declined' : '');

      const dot = document.createElement('span');
      dot.className = 'event-dot';
      dot.style.background = ev.calendarColor;
      card.appendChild(dot);

      const body = document.createElement('div');
      body.className = 'event-body';

      const title = document.createElement('div');
      title.className = 'event-title';
      title.textContent = ev.title;
      body.appendChild(title);

      const time = document.createElement('div');
      time.className = 'event-time';
      time.textContent = formatEventTime(ev);
      body.appendChild(time);

      if (ev.location) {
        const loc = document.createElement('div');
        loc.className = 'event-location';
        loc.textContent = ev.location;
        body.appendChild(loc);
      }

      card.appendChild(body);
      group.appendChild(card);
    }

    list.appendChild(group);
  }

  const errorEl = document.getElementById('agenda-error');
  if (calendarErrors && calendarErrors.length) {
    errorEl.textContent = `Couldn't load ${calendarErrors.length} calendar(s): ${calendarErrors
      .map((e) => e.calendarId)
      .join(', ')}`;
    errorEl.classList.remove('hidden');
  } else {
    errorEl.classList.add('hidden');
  }
}

/* ---- today (time-grid) view -------------------------------------- */

// Split today's events into timed vs all-day, keeping only what overlaps
// the current local day. Timed events get absolute ms bounds attached.
function collectToday() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 24 * 3600 * 1000;
  const timed = [];
  const allDay = [];

  for (const ev of latestPayload.events) {
    const s = eventStartDate(ev).getTime();
    const e = eventEndDate(ev).getTime();
    if (s >= dayEnd || e <= dayStart) continue; // not today
    if (ev.allDay) {
      allDay.push(ev);
    } else {
      timed.push({ ...ev, startMs: s, endMs: e });
    }
  }

  timed.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return { timed, allDay, dayStart, dayEnd };
}

// Greedy side-by-side column packing for overlapping events, à la the
// Google/Apple day view. Mutates each event with _col / _cols.
function assignColumns(events) {
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const colEnds = []; // last endMs currently occupying each column
    for (const ev of cluster) {
      let col = colEnds.findIndex((end) => ev.startMs >= end);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(ev.endMs);
      } else {
        colEnds[col] = ev.endMs;
      }
      ev._col = col;
    }
    for (const ev of cluster) ev._cols = colEnds.length;
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const ev of events) {
    if (cluster.length && ev.startMs >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.endMs);
  }
  if (cluster.length) flush();
  return events;
}

function computeStatus(timed, nowMs) {
  const ongoing = timed
    .filter((e) => e.startMs <= nowMs && e.endMs > nowMs)
    .sort((a, b) => a.endMs - b.endMs);
  const upcoming = timed.filter((e) => e.startMs > nowMs).sort((a, b) => a.startMs - b.startMs);

  if (ongoing.length) {
    const e = ongoing[0];
    const more = ongoing.length > 1 ? ` · +${ongoing.length - 1} agora` : '';
    let sub = `termina ${fmtTime(e.endMs)}`;
    if (upcoming.length) {
      const nx = upcoming[0];
      const m = Math.round((nx.startMs - nowMs) / 60000);
      sub += ` · depois: ${nx.title} (${m < 60 ? `em ${m} min` : fmtTime(nx.startMs)})`;
    }
    return { cls: 'now', text: `Agora · ${e.title}${more}`, sub };
  }

  if (upcoming.length) {
    const e = upcoming[0];
    const m = Math.max(0, Math.round((e.startMs - nowMs) / 60000));
    const rel = m <= 0 ? 'agora' : m < 60 ? `em ${m} min` : `em ${Math.floor(m / 60)}h${pad2(m % 60)}`;
    return { cls: 'soon', text: `${cap(rel)} · ${e.title}`, sub: fmtRange(e.startMs, e.endMs) };
  }

  return { cls: 'clear', text: 'Sem mais eventos hoje', sub: '' };
}

function renderToday() {
  const now = new Date();
  renderedDayKey = localDayKey(now);

  document.getElementById('today-title').textContent = now.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const { timed, allDay, dayStart, dayEnd } = collectToday();

  // All-day strip
  const alldayEl = document.getElementById('today-allday');
  alldayEl.innerHTML = '';
  alldayEl.classList.toggle('hidden', allDay.length === 0);
  for (const ev of allDay) {
    const chip = document.createElement('div');
    chip.className = 'allday-chip' + (ev.status === 'declined' ? ' is-declined' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = ev.calendarColor;
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = ev.title;
    chip.append(dot, lbl);
    alldayEl.appendChild(chip);
  }

  // Hour lines + labels
  const inner = document.getElementById('today-grid-inner');
  inner.style.height = GRID_HEIGHT + 'px';
  const hours = document.getElementById('tg-hours');
  hours.innerHTML = '';
  for (let h = 0; h <= 24; h++) {
    const line = document.createElement('div');
    line.className = 'tg-hourline';
    line.style.top = h * PX_PER_HOUR + 'px';
    if (h < 24) {
      const lab = document.createElement('span');
      lab.className = 'tg-hourlabel';
      lab.textContent = h === 0 ? '' : `${h}:00`;
      line.appendChild(lab);
    }
    hours.appendChild(line);
  }

  // Event blocks
  const layer = document.getElementById('tg-events');
  layer.innerHTML = '';
  const nowMs = Date.now();

  for (const ev of assignColumns(timed)) {
    const clampStart = Math.max(ev.startMs, dayStart);
    const clampEnd = Math.min(ev.endMs, dayEnd);
    const top = ((clampStart - dayStart) / 3600000) * PX_PER_HOUR;
    const height = Math.max(((clampEnd - clampStart) / 3600000) * PX_PER_HOUR, 18);

    const el = document.createElement('div');
    el.className = 'tg-event';
    if (ev.status === 'declined') el.classList.add('is-declined');
    if (height < 34) el.classList.add('is-compact');
    el.dataset.s = String(ev.startMs);
    el.dataset.e = String(ev.endMs);
    el.style.top = top + 'px';
    el.style.height = height + 'px';
    el.style.left = `${(ev._col / ev._cols) * 100}%`;
    el.style.width = `calc(${100 / ev._cols}% - 3px)`;
    el.style.setProperty('--evc', ev.calendarColor);
    el.style.setProperty('--evbg', hexToRgba(ev.calendarColor, 0.22));
    el.title = `${ev.title}\n${fmtRange(ev.startMs, ev.endMs)}${ev.location ? '\n' + ev.location : ''}`;

    const t = document.createElement('div');
    t.className = 'te-title';
    t.textContent = ev.title;
    el.appendChild(t);

    const tm = document.createElement('div');
    tm.className = 'te-time';
    tm.textContent = fmtRange(ev.startMs, ev.endMs) + (ev.location ? ` · ${ev.location}` : '');
    el.appendChild(tm);

    layer.appendChild(el);
  }

  // Empty-day note
  let note = document.getElementById('tg-empty');
  if (!timed.length && !allDay.length) {
    if (!note) {
      note = document.createElement('div');
      note.id = 'tg-empty';
      note.textContent = 'Nada agendado hoje.';
      inner.appendChild(note);
    }
  } else if (note) {
    note.remove();
  }

  updateNow();

  if (todayNeedsScroll) {
    const grid = document.getElementById('today-grid');
    const nowTop = ((nowMs - dayStart) / 3600000) * PX_PER_HOUR;
    grid.scrollTop = Math.max(0, nowTop - PX_PER_HOUR * 0.75);
    todayNeedsScroll = false;
  }
}

// Cheap tick: reposition the "now" line + past shade, refresh the status
// banner and per-event now/past state, without rebuilding the grid.
function updateNow() {
  if (renderedDayKey === null) return;

  const now = new Date();
  if (localDayKey(now) !== renderedDayKey) {
    todayNeedsScroll = true;
    renderToday();
    return;
  }

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const nowMs = now.getTime();
  const nowTop = ((nowMs - dayStart) / 3600000) * PX_PER_HOUR;

  const line = document.getElementById('tg-nowline');
  line.classList.remove('hidden');
  line.style.top = nowTop + 'px';
  document.getElementById('tg-past').style.height = Math.max(0, nowTop) + 'px';

  for (const el of document.querySelectorAll('#tg-events .tg-event')) {
    const s = Number(el.dataset.s);
    const e = Number(el.dataset.e);
    el.classList.toggle('is-past', e <= nowMs);
    el.classList.toggle('is-now', s <= nowMs && e > nowMs);
  }

  const { timed } = collectToday();
  const status = computeStatus(timed, nowMs);
  const box = document.getElementById('today-status');
  box.className = 'today-status ' + status.cls;
  box.innerHTML = '';
  const main = document.createElement('div');
  main.className = 'ts-main';
  main.textContent = status.text;
  box.appendChild(main);
  if (status.sub) {
    const sub = document.createElement('div');
    sub.className = 'ts-sub';
    sub.textContent = status.sub;
    box.appendChild(sub);
  }
}

/* ---- view switching + wiring ------------------------------------- */

function applyViewVisibility() {
  document.getElementById('tab-today').classList.toggle('active', currentView === 'today');
  document.getElementById('tab-agenda').classList.toggle('active', currentView === 'agenda');
  document.getElementById('today-view').classList.toggle('hidden', currentView !== 'today');
  document.getElementById('agenda-view').classList.toggle('hidden', currentView !== 'agenda');
}

function setView(view) {
  if (view !== currentView) {
    currentView = view;
    try {
      localStorage.setItem('fks.view', view);
    } catch {
      /* ignore */
    }
  }
  applyViewVisibility();
  if (currentView === 'today') {
    todayNeedsScroll = true;
    renderToday();
  }
}

function renderAll() {
  renderAgenda(latestPayload);
  if (currentView === 'today') renderToday();
}

function ensureNowTimer() {
  if (nowTimer) return;
  nowTimer = setInterval(() => {
    if (currentView === 'today' && !screens.agenda.classList.contains('hidden')) {
      updateNow();
    }
  }, 30000);
}

async function init() {
  applyViewVisibility();

  const { signedIn } = await window.fksCalendar.getStatus();
  showScreen(signedIn ? 'loading' : 'signin');

  window.fksCalendar.onAuthState(({ signedIn }) => {
    if (!signedIn) showScreen('signin');
  });

  window.fksCalendar.onEvents((payload) => {
    latestPayload = payload && Array.isArray(payload.events) ? payload : { events: [], calendarErrors: [] };
    // Only auto-scroll to "now" on first load / view switch (todayNeedsScroll
    // starts true and is set by setView) — a background 5-min refresh should
    // not yank the grid away from wherever the user scrolled.
    showScreen('agenda');
    applyViewVisibility();
    renderAll();
    ensureNowTimer();
  });

  window.fksCalendar.onError((err) => {
    showScreen('agenda');
    applyViewVisibility();
    if (currentView === 'today') renderToday();
    const errorEl = document.getElementById('agenda-error');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  });

  document.getElementById('tab-today').addEventListener('click', () => setView('today'));
  document.getElementById('tab-agenda').addEventListener('click', () => setView('agenda'));

  document.getElementById('signin-btn').addEventListener('click', async () => {
    const errorEl = document.getElementById('signin-error');
    errorEl.classList.add('hidden');
    showScreen('loading');
    try {
      await window.fksCalendar.signIn();
    } catch (err) {
      showScreen('signin');
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await window.fksCalendar.signOut();
    showScreen('signin');
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    await window.fksCalendar.refresh();
  });
}

init();
