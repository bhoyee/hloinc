'use strict';

/*
 * Initials and a colour for people without a profile photo. Lives in src/lib so
 * Tailwind sees the colour classes below and includes them in the stylesheet.
 */

/** "Avery Admin" -> "AA"; "Prince" -> "P"; first letters of the first and last names. */
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Each person keeps the same colour (from their name). White text on each passes WCAG AA.
const COLORS = ['bg-brand-700', 'bg-accent-600', 'bg-[#1e293b]', 'bg-[#2a78d6]', 'bg-[#b45309]', 'bg-[#7c3aed]', 'bg-[#0e7490]', 'bg-brand-900'];

function color(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

module.exports = { initials, color, COLORS };
