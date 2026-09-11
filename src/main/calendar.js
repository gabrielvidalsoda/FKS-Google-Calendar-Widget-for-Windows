'use strict';

// Fetches events from every calendar on the account and merges them into
// one list, per REQUIREMENTS.md F3/F9. Phase 1 simplification: each refresh
// re-fetches the full time window instead of using nextSyncToken
// incremental sync (see SETUP.md "Known Phase 1 simplifications").

const { google } = require('googleapis');
const { scoped } = require('./logger');

const log = scoped('calendar');

const WINDOW_DAYS = 14;

async function fetchAllEvents(oAuth2Client) {
  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

  let calendars;
  try {
    const calListRes = await calendar.calendarList.list();
    calendars = calListRes.data.items || [];
  } catch (err) {
    // Auth failures (revoked/expired refresh token, wrong client) surface
    // here on the very first call — log the real reason before rethrowing.
    log.error('calendarList.list failed', err);
    throw err;
  }
  log.info(`fetching events from ${calendars.length} calendar(s)`);

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      try {
        const res = await calendar.events.list({
          calendarId: cal.id,
          timeMin,
          timeMax,
          singleEvents: true, // expands recurring events into instances
          orderBy: 'startTime',
          maxResults: 250,
          // Intentionally no `status` filter — F9 requires accepted,
          // tentative and declined events all shown (declined struck-through
          // in the UI), matching Google Calendar's own default view.
        });

        const items = res.data.items || [];
        return items.map((ev) => ({
          id: `${cal.id}::${ev.id}`,
          calendarId: cal.id,
          calendarSummary: cal.summaryOverride || cal.summary,
          calendarColor: cal.backgroundColor || '#4285f4',
          title: ev.summary || '(no title)',
          location: ev.location || null,
          start: ev.start, // { dateTime, timeZone } or { date } for all-day
          end: ev.end,
          allDay: Boolean(ev.start && ev.start.date && !ev.start.dateTime),
          status: selfResponseStatus(ev),
          htmlLink: ev.htmlLink,
        }));
      } catch (err) {
        // One misbehaving/shared calendar shouldn't take down the whole
        // fetch — surface it in a per-calendar error list instead.
        log.warn(`events.list failed for calendar ${cal.id}`, err);
        return { _calendarError: { calendarId: cal.id, message: err.message } };
      }
    })
  );

  const events = [];
  const calendarErrors = [];
  for (const result of perCalendar) {
    if (Array.isArray(result)) {
      events.push(...result);
    } else if (result && result._calendarError) {
      calendarErrors.push(result._calendarError);
    }
  }

  events.sort((a, b) => eventStartMillis(a) - eventStartMillis(b));

  log.info(
    `fetched ${events.length} event(s)` +
      (calendarErrors.length ? `, ${calendarErrors.length} calendar(s) errored` : '')
  );
  return { events, calendarErrors };
}

function selfResponseStatus(ev) {
  if (!ev.attendees) return 'accepted'; // events with no attendee list (most of your own) count as accepted
  const self = ev.attendees.find((a) => a.self);
  return self ? self.responseStatus : 'accepted';
}

function eventStartMillis(ev) {
  const raw = ev.allDay ? ev.start.date : ev.start.dateTime;
  return new Date(raw).getTime();
}

module.exports = { fetchAllEvents };
