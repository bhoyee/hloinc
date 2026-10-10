'use strict';

/**
 * DEMO announcements so the Staff board (and the website banner) can be tried:
 * three staff-only posts and one for the website and staff together.
 * Development, or a server with DEMO_DATA=true (src/db/demo.js). Adds any demo
 * post that is missing; `npm run demo:remove` deletes exactly these (by title).
 */
const demo = require('../demo');

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;
  const staff = Object.fromEntries((await knex('users').where('email', 'like', `%${demo.STAFF_DOMAIN}`).select('role', 'id')).map((u) => [u.role, u.id]));
  const author = staff.admin || staff.program_director;
  if (!author) return;

  const day = 86400000;
  const now = Date.now();
  // Thanksgiving: the fourth Thursday of November this year (or next, once it has passed).
  const thanksgiving = (year) => {
    const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
    return new Date(Date.UTC(year, 10, 1 + ((4 - first + 7) % 7) + 21, 12));
  };
  let holiday = thanksgiving(new Date().getUTCFullYear());
  if (holiday.getTime() + day < now) holiday = thanksgiving(new Date().getUTCFullYear() + 1);
  const holidayText = holiday.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  const posts = [
    { title: 'Staff meeting moved to Thursday 10am', body: 'This week’s all-staff meeting is on Thursday at 10am in the Catonsville office conference room. Please bring your caseload updates.',
      audience: 'internal', starts_at: new Date(now - 1 * day), ends_at: new Date(now + 6 * day), created_by: author },
    { title: 'New intake checklist', body: 'The updated intake checklist is in the shared drive. Please use it for every new referral from Monday.',
      audience: 'internal', starts_at: new Date(now - 3 * day), ends_at: new Date(now + 14 * day), created_by: staff.program_director || author },
    { title: 'CPR & First Aid renewal', body: 'If your certification expires this quarter, book a renewal session with HR. Sessions run every second Wednesday.',
      audience: 'internal', starts_at: new Date(now - 5 * day), ends_at: new Date(now + 21 * day), created_by: author },
    // For the website and staff together.
    { title: 'Office closed for Thanksgiving', body: `Our office will be closed on ${holidayText} for Thanksgiving and will reopen the next morning. For a life-threatening emergency, call 911.`,
      audience: 'both', starts_at: new Date(now - 2 * day), ends_at: new Date(holiday.getTime() + day), created_by: author },
  ];
  const have = new Set(await knex('announcements').whereIn('title', demo.ANNOUNCEMENT_TITLES).pluck('title'));
  const missing = posts.filter((p) => !have.has(p.title));
  if (missing.length) await knex('announcements').insert(missing);
};
