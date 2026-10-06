import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { officeStatus, formatHour } = require('../src/lib/hours');

const weekdays9to5 = { days: [1, 2, 3, 4, 5], open: 9, close: 17 };
// Times are UTC; Maryland is UTC-4 in October (EDT) and UTC-5 in January (EST).
const at = (iso) => officeStatus(weekdays9to5, new Date(iso));

describe('office open/closed status (Maryland time)', () => {
  it('is open during weekday hours', () => {
    expect(at('2026-10-06T14:00:00Z')).toEqual({ open: true, label: 'Open now · until 5 p.m.' });
  });
  it('says it opens later today before 9 a.m.', () => {
    expect(at('2026-10-06T12:30:00Z').label).toBe('Closed · opens today at 9 a.m.');
  });
  it('closes at exactly 5 p.m.', () => {
    expect(at('2026-10-06T21:00:00Z').open).toBe(false);
  });
  it('says tomorrow on a weekday evening', () => {
    expect(at('2026-10-06T23:00:00Z').label).toBe('Closed · opens tomorrow at 9 a.m.');
  });
  it('says Monday from Friday evening and Saturday', () => {
    expect(at('2026-10-09T22:00:00Z').label).toBe('Closed · opens Monday at 9 a.m.');
    expect(at('2026-10-10T15:00:00Z').label).toBe('Closed · opens Monday at 9 a.m.');
  });
  it('uses Maryland time, including winter (EST)', () => {
    // 13:30 UTC on a January Tuesday is 8:30 a.m. in Maryland.
    expect(at('2027-01-05T13:30:00Z').label).toBe('Closed · opens today at 9 a.m.');
  });
  it('formats hours the way the site writes them', () => {
    expect([formatHour(9), formatHour(12), formatHour(17)]).toEqual(['9 a.m.', 'noon', '5 p.m.']);
  });
});
