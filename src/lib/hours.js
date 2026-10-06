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

module.exports = { officeStatus, formatHour };
