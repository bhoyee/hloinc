/*
 * Staff portal dashboard: live clock, charts and silent auto-refresh.
 *
 * The page embeds its data as JSON (#dashboard-data). Charts are drawn here as
 * SVG at the container's real size, so text stays crisp on phones. Every value
 * is also in the "Show as table" view, so nothing depends on hovering.
 * Every 30 seconds (only while the tab is visible) the dashboard fetches fresh
 * numbers from /portal/dashboard/data and updates in place. These background
 * requests don't count as activity, so an unattended tab still signs out.
 */
(() => {
  'use strict';

  const dataEl = document.getElementById('dashboard-data');
  if (!dataEl) return;

  const TZ = 'America/New_York';
  const REFRESH_MS = 30000;
  const SVG = 'http://www.w3.org/2000/svg';
  const INK = { grid: '#e6ece9', axis: '#c9d4ce', label: '#5b6b63', surface: '#ffffff', band: '#f3f7f5' };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let data;
  try { data = JSON.parse(dataEl.textContent); } catch { return; }

  // ── Clock ────────────────────────────────────────────────────────────────
  const fmtDate = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const fmtParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  const fmtShort = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const clockDate = document.querySelector('[data-clock-date]');
  const clockTime = document.querySelector('[data-clock-time]');
  const hands = {
    hour: document.querySelector('[data-hand="hour"]'),
    minute: document.querySelector('[data-hand="minute"]'),
    second: document.querySelector('[data-hand="second"]'),
  };

  function tick() {
    const now = new Date();
    if (clockDate) clockDate.textContent = fmtDate.format(now);
    if (clockTime) clockTime.textContent = fmtTime.format(now);
    const p = Object.fromEntries(fmtParts.formatToParts(now).map((x) => [x.type, Number(x.value)]));
    const h = p.hour % 12;
    if (hands.hour) hands.hour.setAttribute('transform', `rotate(${(h + p.minute / 60) * 30} 24 24)`);
    if (hands.minute) hands.minute.setAttribute('transform', `rotate(${(p.minute + p.second / 60) * 6} 24 24)`);
    if (hands.second) hands.second.setAttribute('transform', `rotate(${p.second * 6} 24 24)`);
  }
  tick();
  // Line the ticks up with the start of each second.
  setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));

  // ── SVG helpers ──────────────────────────────────────────────────────────
  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }
  function text(parent, x, y, value, attrs) {
    const t = el('text', { x, y, fill: INK.label, 'font-size': 12, ...attrs }, parent);
    t.textContent = value;
    return t;
  }
  /** Rectangle with only its far end rounded (4px), square on the baseline. */
  function barPath(x, y, w, h, horizontal) {
    const r = Math.min(4, horizontal ? w / 2 : h / 2, horizontal ? h / 2 : w / 2);
    if (h <= 0 || w <= 0) return '';
    if (horizontal) {
      return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    }
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  /** A clean axis maximum and step: 0, 2, 4… or 0, 5, 10… */
  function niceScale(max) {
    if (max <= 4) return { max: 4, step: 1 };
    const rough = max / 4;
    const mag = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough);
    return { max: Math.ceil(max / step) * step, step };
  }
  const plural = (n, unit) => `${n.toLocaleString('en-US')} ${n === 1 ? unit.replace(/s$/, '') : unit}`;

  // ── Tooltip (one per chart; text only via textContent) ───────────────────
  function tooltipFor(box) {
    let tip = box.querySelector('[data-tip]');
    if (!tip) {
      tip = document.createElement('div');
      tip.setAttribute('data-tip', '');
      tip.className = 'pointer-events-none absolute top-0 left-0 z-10 hidden min-w-36 rounded-xl border border-line bg-white px-3 py-2 text-sm shadow-lift';
      box.appendChild(tip);
      const live = document.createElement('p');
      live.className = 'sr-only';
      live.setAttribute('aria-live', 'polite');
      live.setAttribute('data-tip-live', '');
      box.appendChild(live);
    }
    return tip;
  }
  function showTip(box, chart, i, anchorX, anchorY) {
    const tip = tooltipFor(box);
    tip.replaceChildren();
    const title = document.createElement('p');
    title.className = 'mb-1 text-xs font-medium text-muted';
    title.textContent = (chart.categoryTitles || chart.categories)[i];
    tip.appendChild(title);
    const rows = chart.series.length > 1 ? [...chart.series].reverse() : chart.series;
    for (const s of rows) {
      const row = document.createElement('p');
      row.className = 'flex items-center gap-2 leading-6';
      const key = document.createElement('span');
      key.className = 'h-0.5 w-3 shrink-0 rounded-full';
      key.style.backgroundColor = s.color;
      const value = document.createElement('strong');
      value.className = 'font-semibold text-ink tabular-nums';
      value.textContent = s.values[i].toLocaleString('en-US');
      const name = document.createElement('span');
      name.className = 'text-muted';
      name.textContent = s.name;
      row.append(key, value, name);
      tip.appendChild(row);
    }
    if (chart.series.length > 1) {
      const total = document.createElement('p');
      total.className = 'mt-1 border-t border-line pt-1 text-xs text-muted';
      total.textContent = `Total ${plural(chart.totals[i], chart.unit)}`;
      tip.appendChild(total);
    }
    tip.classList.remove('hidden');
    const bw = box.clientWidth;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = anchorX + 12;
    if (x + tw > bw) x = anchorX - tw - 12;
    tip.style.left = `${Math.max(0, x)}px`;
    tip.style.top = `${Math.max(0, Math.min(anchorY - th / 2, box.clientHeight - th))}px`;

    const live = box.querySelector('[data-tip-live]');
    if (live && box.contains(document.activeElement)) {
      live.textContent = `${title.textContent}: ${chart.series.map((s) => `${s.name} ${s.values[i]}`).join(', ')}`;
    }
  }
  function hideTip(box) {
    const tip = box.querySelector('[data-tip]');
    if (tip) tip.classList.add('hidden');
  }

  // ── Charts ───────────────────────────────────────────────────────────────

  /** Vertical columns, stacked when there are several series. */
  function drawColumns(box, chart, svg, W, H) {
    const m = { top: 20, right: 4, bottom: 26, left: 30 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;
    const n = chart.categories.length;
    const { max, step } = niceScale(Math.max(1, ...chart.totals));
    const y = (v) => m.top + ph - (v / max) * ph;
    const band = pw / n;
    const bw = Math.min(24, band * 0.62);

    for (let v = 0; v <= max; v += step) {
      el('line', { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v), stroke: v === 0 ? INK.axis : INK.grid, 'shape-rendering': 'crispEdges' }, svg);
      text(svg, m.left - 8, y(v) + 4, v.toLocaleString('en-US'), { 'text-anchor': 'end', 'font-variant-numeric': 'tabular-nums' });
    }
    if (chart.highlight != null && chart.highlight >= 0) {
      svg.insertBefore(el('rect', { x: m.left + band * chart.highlight + 1, y: m.top - 14, width: band - 2, height: ph + 14, rx: 8, fill: INK.band }), svg.firstChild);
    }

    // Label every column if there's room, otherwise every other one (always the highlighted one).
    const every = band < 44 ? (band < 24 ? 3 : 2) : 1;
    // Skip a neighbour of the highlighted (bold) label if they'd collide.
    const crowded = (i) => band < 70 && chart.highlight != null && Math.abs(i - chart.highlight) === 1;
    const groups = [];
    for (let i = 0; i < n; i++) {
      const g = el('g', { 'data-i': i }, svg);
      groups.push(g);
      const cx = m.left + band * i + band / 2;
      let base = y(0);
      const stacked = chart.series.filter((s) => s.values[i] > 0);
      stacked.forEach((s, k) => {
        const h = (s.values[i] / max) * ph;
        const gap = k < stacked.length - 1 ? 2 : 0; // 2px surface gap between segments
        const top = base - h;
        if (k === stacked.length - 1) el('path', { d: barPath(cx - bw / 2, top, bw, h), fill: s.color }, g);
        else el('rect', { x: cx - bw / 2, y: top + gap, width: bw, height: Math.max(0, h - gap), fill: s.color }, g);
        base = top;
      });
      if (chart.totals[i] > 0 && band >= 26) {
        text(g, cx, y(chart.totals[i]) - 6, chart.totals[i], { 'text-anchor': 'middle', fill: '#0f1c16', 'font-weight': 600 });
      }
      const isHi = i === chart.highlight;
      if (isHi || ((n - 1 - i) % every === 0 && !crowded(i))) {
        text(svg, cx, H - 8, chart.categories[i], { 'text-anchor': 'middle', 'font-weight': isHi ? 700 : 400, fill: isHi ? '#0f1c16' : INK.label });
      }
    }

    // Hit targets: the whole column band, taller than the marks.
    const focus = (i) => {
      groups.forEach((g, k) => g.setAttribute('opacity', k === i ? 1 : 0.45));
      showTip(box, chart, i, m.left + band * i + band / 2 + bw / 2, y(chart.totals[i]) + 10);
    };
    return { count: n, focus, indexAt: (px) => Math.max(0, Math.min(n - 1, Math.floor((px - m.left) / band))), reset: () => groups.forEach((g) => g.removeAttribute('opacity')) };
  }

  /** Horizontal bars, one series, value at the tip. */
  function drawBars(box, chart, svg, W, H) {
    const s = chart.series[0];
    const n = chart.categories.length;
    const labelW = Math.min(130, W * 0.38);
    const m = { top: 4, right: 40, bottom: 4, left: labelW };
    const pw = W - m.left - m.right;
    const row = (H - m.top - m.bottom) / n;
    const bh = Math.min(24, row * 0.6);
    const max = Math.max(1, ...s.values);
    el('line', { x1: m.left, x2: m.left, y1: m.top, y2: H - m.bottom, stroke: INK.axis, 'shape-rendering': 'crispEdges' }, svg);
    const groups = [];
    for (let i = 0; i < n; i++) {
      const g = el('g', {}, svg);
      groups.push(g);
      const cy = m.top + row * i + row / 2;
      const w = (s.values[i] / max) * pw;
      text(g, m.left - 12, cy + 4, chart.categories[i], { 'text-anchor': 'end', fill: '#0f1c16' });
      if (w > 0) el('path', { d: barPath(m.left + 1, cy - bh / 2, w, bh, true), fill: s.color }, g);
      text(g, m.left + w + 8, cy + 4, s.values[i].toLocaleString('en-US'), { fill: '#0f1c16', 'font-weight': 600 });
    }
    const focus = (i) => {
      groups.forEach((g, k) => g.setAttribute('opacity', k === i ? 1 : 0.45));
      showTip(box, chart, i, m.left + (s.values[i] / max) * pw + 30, m.top + row * i + row / 2);
    };
    return { count: n, focus, indexAt: (px, py) => Math.max(0, Math.min(n - 1, Math.floor((py - m.top) / row))), reset: () => groups.forEach((g) => g.removeAttribute('opacity')) };
  }

  /** Lines over time with a crosshair that snaps to the nearest week. */
  function drawLines(box, chart, svg, W, H) {
    const m = { top: 12, right: 12, bottom: 26, left: 30 };
    const pw = W - m.left - m.right;
    const ph = H - m.top - m.bottom;
    const n = chart.categories.length;
    const { max, step } = niceScale(Math.max(1, ...chart.series.flatMap((s) => s.values)));
    const x = (i) => m.left + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
    const y = (v) => m.top + ph - (v / max) * ph;

    for (let v = 0; v <= max; v += step) {
      el('line', { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v), stroke: v === 0 ? INK.axis : INK.grid, 'shape-rendering': 'crispEdges' }, svg);
      text(svg, m.left - 8, y(v) + 4, v.toLocaleString('en-US'), { 'text-anchor': 'end', 'font-variant-numeric': 'tabular-nums' });
    }
    const gap = (pw / Math.max(1, n - 1));
    // Leave room for the bold "This week" label at the right edge.
    const every = gap < 30 ? 4 : gap < 60 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      if ((n - 1 - i) % every !== 0) continue;
      const last = i === n - 1;
      text(svg, x(i), H - 8, chart.categories[i], { 'text-anchor': last ? 'end' : i === 0 ? 'start' : 'middle', 'font-weight': last ? 700 : 400, fill: last ? '#0f1c16' : INK.label });
    }
    const cross = el('line', { y1: m.top, y2: m.top + ph, stroke: INK.axis, 'stroke-width': 1, visibility: 'hidden', 'shape-rendering': 'crispEdges' }, svg);
    if (chart.series.length === 1) {
      const s = chart.series[0];
      el('path', { d: `M${x(0)},${y(0)}${s.values.map((v, i) => `L${x(i)},${y(v)}`).join('')}L${x(n - 1)},${y(0)}Z`, fill: s.color, 'fill-opacity': 0.1 }, svg);
    }
    for (const s of chart.series) {
      el('polyline', { points: s.values.map((v, i) => `${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    }
    // End markers (latest week), ringed in the surface colour.
    for (const s of chart.series) {
      el('circle', { cx: x(n - 1), cy: y(s.values[n - 1]), r: 4, fill: s.color, stroke: INK.surface, 'stroke-width': 2 }, svg);
    }
    const dots = chart.series.map((s) => el('circle', { r: 4, fill: s.color, stroke: INK.surface, 'stroke-width': 2, visibility: 'hidden' }, svg));

    const focus = (i) => {
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      chart.series.forEach((s, k) => {
        dots[k].setAttribute('cx', x(i));
        dots[k].setAttribute('cy', y(s.values[i]));
        dots[k].setAttribute('visibility', 'visible');
      });
      showTip(box, chart, i, x(i), m.top + ph / 3);
    };
    const reset = () => {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    };
    return { count: n, focus, reset, indexAt: (px) => Math.max(0, Math.min(n - 1, Math.round(((px - m.left) / pw) * (n - 1)))) };
  }

  const DRAW = { columns: drawColumns, bars: drawBars, line: drawLines };
  const state = new Map(); // chart key → { api, index }

  function render(box, chart) {
    const W = box.clientWidth;
    const H = box.clientHeight;
    if (!W || !H) return;
    box.querySelectorAll('svg, noscript').forEach((n) => n.remove());
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', class: 'block overflow-visible font-sans' });
    box.prepend(svg);
    const api = DRAW[chart.type](box, chart, svg, W, H);
    const prev = state.get(chart.key);
    state.set(chart.key, { api, index: prev ? prev.index : null, chart });
    if (prev && prev.index != null && box.contains(document.activeElement)) api.focus(Math.min(prev.index, api.count - 1));
  }

  function wire(box, key) {
    const current = () => state.get(key);
    const point = (e) => {
      const r = box.getBoundingClientRect();
      const st = current();
      if (!st) return;
      st.index = st.api.indexAt(e.clientX - r.left, e.clientY - r.top);
      st.api.focus(st.index);
    };
    box.addEventListener('pointermove', point);
    box.addEventListener('pointerdown', point);
    box.addEventListener('pointerleave', () => {
      if (box.contains(document.activeElement)) return;
      const st = current();
      if (st) { st.api.reset(); st.index = null; }
      hideTip(box);
    });
    box.addEventListener('focus', () => {
      const st = current();
      if (st) { st.index = st.index ?? st.api.count - 1; st.api.focus(st.index); }
    });
    box.addEventListener('blur', () => {
      const st = current();
      if (st) { st.api.reset(); st.index = null; }
      hideTip(box);
    });
    box.addEventListener('keydown', (e) => {
      const st = current();
      if (!st) return;
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity };
      if (e.key === 'Escape') { st.api.reset(); hideTip(box); return; }
      if (!(e.key in keys)) return;
      e.preventDefault();
      const next = (st.index ?? 0) + keys[e.key];
      st.index = Math.max(0, Math.min(st.api.count - 1, Number.isFinite(next) ? next : next > 0 ? Infinity : 0));
      if (!Number.isFinite(st.index)) st.index = st.api.count - 1;
      st.api.focus(st.index);
    });
  }

  function chartBox(key) {
    return document.querySelector(`[data-chart="${CSS.escape(key)}"]`);
  }

  for (const chart of data.charts) {
    const box = chartBox(chart.key);
    if (!box) continue;
    render(box, chart);
    wire(box, chart.key);
  }

  // Redraw on resize (charts are drawn at their real pixel size).
  if ('ResizeObserver' in window) {
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => data.charts.forEach((c) => { const b = chartBox(c.key); if (b) render(b, c); }));
    });
    data.charts.forEach((c) => { const b = chartBox(c.key); if (b) ro.observe(b); });
  }

  // ── Table view (rebuilt on refresh; values via textContent) ──────────────
  function renderTable(chart) {
    const card = document.querySelector(`[data-chart-card="${CSS.escape(chart.key)}"]`);
    const tbody = card && card.querySelector('[data-chart-table] tbody');
    if (!tbody) return;
    const multi = chart.series.length > 1;
    const rows = chart.categories.map((cat, i) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.className = 'py-2 pr-4 font-medium text-ink';
      th.textContent = (chart.categoryTitles || chart.categories)[i];
      tr.appendChild(th);
      for (const s of chart.series) {
        const td = document.createElement('td');
        td.className = 'py-2 pr-4 text-right';
        td.textContent = s.values[i];
        tr.appendChild(td);
      }
      if (multi) {
        const td = document.createElement('td');
        td.className = 'py-2 text-right font-semibold';
        td.textContent = chart.totals[i];
        tr.appendChild(td);
      }
      return tr;
    });
    tbody.replaceChildren(...rows);
  }

  // ── Silent auto-refresh ──────────────────────────────────────────────────
  const liveText = document.querySelector('[data-live-text]');
  const liveDot = document.querySelector('[data-live-dot]');
  const livePing = document.querySelector('[data-live-ping]');
  let failures = 0;
  let timer = 0;
  let busy = false;

  function setLive(ok, when) {
    if (liveText) liveText.textContent = ok ? `Live · updated ${fmtShort.format(when)}` : 'Reconnecting…';
    if (liveDot) liveDot.classList.toggle('bg-amber-500', !ok);
    if (livePing) livePing.classList.toggle('hidden', !ok);
  }

  function applyTiles(tiles) {
    for (const t of tiles) {
      const valueEl = document.querySelector(`[data-tile="${CSS.escape(t.key)}"] [data-tile-value]`);
      if (!valueEl || valueEl.textContent.trim() === String(t.value)) continue;
      valueEl.textContent = t.value;
      if (!reduceMotion) {
        valueEl.classList.remove('tile-bump');
        void valueEl.offsetWidth; // restart the animation
        valueEl.classList.add('tile-bump');
      }
    }
  }

  function applyOffice(office) {
    const label = document.querySelector('[data-office]');
    const dot = document.querySelector('[data-office-dot]');
    if (!office || !label) return;
    label.textContent = office.label;
    if (dot) {
      dot.classList.toggle('bg-brand-500', office.open);
      dot.classList.toggle('bg-[#93a49b]', !office.open);
    }
  }

  async function refresh() {
    clearTimeout(timer);
    if (busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      const res = await fetch('/portal/dashboard/data', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      // Signed out (idle timeout or revoked): reload so the sign-in page explains why.
      if (res.redirected || res.status === 401) { window.location.reload(); return; }
      if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) throw new Error(String(res.status));
      const next = await res.json();
      applyTiles(next.tiles);
      applyOffice(next.office);
      for (const chart of next.charts) {
        const box = chartBox(chart.key);
        if (!box) continue;
        const card = document.querySelector(`[data-chart-card="${CSS.escape(chart.key)}"]`);
        const fv = card.querySelector('[data-figure-value]');
        const fl = card.querySelector('[data-figure-label]');
        if (fv && chart.figure) fv.textContent = chart.figure.value;
        if (fl && chart.figure) fl.textContent = chart.figure.label;
        if (JSON.stringify(chart) !== JSON.stringify(data.charts.find((c) => c.key === chart.key))) {
          render(box, chart);
          renderTable(chart);
        }
      }
      data = next;
      failures = 0;
      setLive(true, new Date(next.updatedAt));
    } catch {
      failures += 1;
      setLive(false);
    } finally {
      busy = false;
    }
    // Back off gently if the server can't be reached.
    timer = setTimeout(refresh, failures ? Math.min(REFRESH_MS * 2 ** failures, 5 * 60000) : REFRESH_MS);
  }

  setLive(true, new Date(data.updatedAt));
  timer = setTimeout(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    // Coming back to the tab: catch up straight away.
    if (document.visibilityState === 'visible') refresh();
  });
})();
