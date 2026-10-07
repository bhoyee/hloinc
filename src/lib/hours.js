'use strict';

const TIMEZONE = 'America/New_York';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 9 -> "9 a.m.", 17 -> "5 p.m.", 12 -> "noon". */
function formatHour(h) {
  if (h === 12) return 'noon';
  const suffix = h < 12 ? 'a.m.' : 'p.m.';
  return `${h % 12 || 12} ${suffix}`;
}

/** Day of week and decimal hour in Maryland right now. */
function marylandNow(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, hour: Number(parts.hour) + Number(parts.minute) / 60 };
}

/**
 * Whether the office is open, with a short label, e.g.
 * { open: true, label: 'Open now · until 5 p.m.' } or
 * { open: false, label: 'Closed · opens Monday at 9 a.m.' }.
 * Public holidays aren't known here, so pages show a note alongside.
 */
function officeStatus(schedule, now = new Date()) {
  const { days, open, close } = schedule;
  const { day, hour } = marylandNow(now);

  if (days.includes(day) && hour >= open && hour < close) {
    return { open: true, label: `Open now · until ${formatHour(close)}` };
  }
  if (days.includes(day) && hour < open) {
    return { open: false, label: `Closed · opens today at ${formatHour(open)}` };
  }
  for (let i = 1; i <= 7; i++) {
    const next = (day + i) % 7;
    if (days.includes(next)) {
      const when = i === 1 ? 'tomorrow' : DAY_NAMES[next];
      return { open: false, label: `Closed · opens ${when} at ${formatHour(open)}` };
    }
  }
  return { open: false, label: 'Closed' };
}

/** Midnight at the start of a Maryland calendar day (YYYY-MM-DD) as a Date, allowing for EST/EDT. */
function marylandDayStart(isoDate) {
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${isoDate}T05:00:00Z`))
    .find((p) => p.type === 'timeZoneName').value; // e.g. "GMT-4"
  const hours = Number(offset.replace('GMT', '') || 0);
  const sign = hours <= 0 ? '-' : '+';
  return new Date(`${isoDate}T00:00:00${sign}${String(Math.abs(hours)).padStart(2, '0')}:00`);
}

/** A Maryland local date + "HH:MM" time as a Date (correct for EST and EDT). */
function marylandDateTime(isoDate, time) {
  const [h, m] = String(time).split(':').map(Number);
  return new Date(marylandDayStart(isoDate).getTime() + (h * 60 + m) * 60 * 1000);
}

/** Maryland calendar date, time and weekday of an instant. */
function marylandParts(when) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(new Date(when))
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour) + Number(parts.minute) / 60,
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

/** "2026-10-06" + n days. */
function addDaysIso(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing isoDate. */
function weekStartIso(isoDate) {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return addDaysIso(isoDate, dow === 0 ? -6 : 1 - dow);
}

/** A real calendar date in YYYY-MM-DD form (rejects e.g. 2026-02-30). */
const isIsoDate = (v) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

/** Is [start, end) entirely inside office hours on an office day? */
function withinOfficeHours(schedule, start, end) {
  const a = marylandParts(start);
  const b = marylandParts(new Date(new Date(end).getTime() - 1));
  return a.date === b.date && schedule.days.includes(a.dow) && a.hour >= schedule.open && b.hour < schedule.close;
}

module.exports = { officeStatus, formatHour, marylandDayStart, marylandDateTime, marylandParts, addDaysIso, weekStartIso, isIsoDate, withinOfficeHours };
