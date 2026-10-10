/*
 * In-page editor. Loaded only when staff open a page with ?cms=edit (inside
 * the portal's page editor). Every change is saved straight away to a draft;
 * visitors see nothing until someone presses Publish in the editor toolbar.
 *
 *   Text ............ click and type (Enter or click away to save, Esc to undo)
 *   Long text ....... click to edit in a box ("- " lines become bullet points)
 *   Image ........... click to choose from the library or upload a new one
 *   Link ............ use the "Link" button that appears on hover
 *   Cards / items ... hover for move, copy and delete
 *   Sections ........ hover for move up / down and hide / show
 */
(() => {
  'use strict';

  const registryEl = document.getElementById('cms-registry');
  if (!registryEl) return;
  let registry = {};
  try { registry = JSON.parse(registryEl.textContent) || {}; } catch { registry = {}; }

  const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  const pageKey = new URLSearchParams(location.search).get('cms_page') || 'home';
  const api = (path) => `/portal/content/pages/${encodeURIComponent(pageKey)}${path}`;
  const parentWin = window.parent !== window ? window.parent : null;
  const tell = (msg) => { if (parentWin) parentWin.postMessage({ source: 'cms-frame', ...msg }, location.origin); };

  // ── Small helpers ──────────────────────────────────────────────────────────
  const ICONS = {
    up: 'M4.5 15.75l7.5-7.5 7.5 7.5',
    down: 'M19.5 8.25l-7.5 7.5-7.5-7.5',
    left: 'M15.75 19.5L8.25 12l7.5-7.5',
    right: 'M8.25 4.5l7.5 7.5-7.5 7.5',
    copy: 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75m8.25-3h3.375c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V4.875c0-.621.504-1.125 1.125-1.125H15z',
    trash: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0',
    eye: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
    eyeOff: 'M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88',
    link: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244',
  };
  function svg(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name]);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }
  function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) n.append(c);
    return n;
  }
  const clone = (v) => JSON.parse(JSON.stringify(v));

  let toastTimer = 0;
  function toast(message, kind = 'ok') {
    document.querySelectorAll('.cms-toast').forEach((t) => t.remove());
    const t = el('div', { class: 'cms-toast', role: 'status', 'data-kind': kind, text: message });
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), kind === 'error' ? 6000 : 1800);
  }

  // ── Saving ──────────────────────────────────────────────────────────────────
  // Saves still in flight, so "Save draft" and "Cancel" can wait for them.
  let inFlight = 0;

  async function save(changes, { reload = false } = {}) {
    tell({ type: 'saving' });
    inFlight += 1;
    try {
      const res = await fetch(api('/draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(changes),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (res.status === 401 || res.status === 403 ? 'You’ve been signed out. Please reload the editor.' : 'That change couldn’t be saved.'));
      tell({ type: 'saved' });
      if (reload) {
        sessionStorage.setItem('cms-scroll', String(window.scrollY));
        location.reload();
      } else {
        toast('Saved to draft');
      }
      return true;
    } catch (err) {
      toast(err.message, 'error');
      tell({ type: 'error', message: err.message });
      return false;
    } finally {
      inFlight -= 1;
    }
  }

  const listOf = (key) => clone((registry[key] && registry[key].value) || []);
  function saveList(key, items, opts) {
    registry[key] = { ...(registry[key] || { type: 'list' }), value: items };
    return save({ lists: [{ key, items }] }, opts);
  }

  // Values can live directly under a key, or inside a list item.
  function readValue(node) {
    const key = node.dataset.cms;
    if (node.dataset.cmsIndex == null) return registry[key] ? registry[key].value : '';
    const item = listOf(key)[Number(node.dataset.cmsIndex)] || {};
    const v = item[node.dataset.cmsField];
    return node.dataset.cmsPart ? (v && v[node.dataset.cmsPart]) || '' : v;
  }
  function writeValue(node, value, type, opts) {
    const key = node.dataset.cms;
    if (node.dataset.cmsIndex == null) {
      registry[key] = { ...(registry[key] || {}), type, value };
      return save({ values: [{ key, type, value }] }, opts);
    }
    const items = listOf(key);
    const item = items[Number(node.dataset.cmsIndex)];
    if (!item) return Promise.resolve(false);
    const f = node.dataset.cmsField;
    if (node.dataset.cmsPart) item[f] = { ...(item[f] || {}), [node.dataset.cmsPart]: value };
    else item[f] = value;
    return saveList(key, items, opts);
  }

  // ── Keep the page still: no navigation or form posts while editing ───────────
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && !a.closest('.cms-tool, .cms-dialog')) e.preventDefault();
  }, true);
  document.addEventListener('submit', (e) => { e.preventDefault(); toast('Forms are switched off while editing.'); }, true);

  // ── Inline text ───────────────────────────────────────────────────────────────
  const plainOnly = (() => { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; })();

  function startText(node) {
    if (node.isContentEditable) return;
    const before = node.textContent;
    node.contentEditable = plainOnly ? 'plaintext-only' : 'true';
    node.spellcheck = true;
    node.focus();
    const finish = async (keep) => {
      node.removeEventListener('keydown', onKey);
      node.removeEventListener('blur', onBlur);
      node.removeAttribute('contenteditable');
      const after = node.textContent.replace(/\s+/g, ' ').trim();
      if (!keep || after === before.trim()) { node.textContent = before; return; }
      if (!after) { node.textContent = before; toast('Text can’t be empty. Hide the section or delete the item instead.', 'error'); return; }
      node.textContent = after;
      if (!(await writeValue(node, after, 'text'))) node.textContent = before;
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); node.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    const onBlur = () => finish(true);
    node.addEventListener('keydown', onKey);
    node.addEventListener('blur', onBlur);
  }

  document.addEventListener('click', (e) => {
    const node = e.target.closest('[data-cms][data-cms-type="text"]');
    if (node) { e.preventDefault(); e.stopPropagation(); startText(node); return; }
    const rich = e.target.closest('[data-cms][data-cms-type="rich"]');
    if (rich) { e.preventDefault(); editRich(rich); return; }
    const img = e.target.closest('img[data-cms]');
    if (img) { e.preventDefault(); pickImage(img); }
  });

  // ── Dialog (shared by long text, links and images) ───────────────────────────
  function dialog(title, body, actions) {
    const d = el('dialog', { class: 'cms-dialog', 'aria-label': title });
    const foot = el('div', { class: 'cms-dialog-foot' });
    const close = () => { d.close(); d.remove(); };
    for (const a of actions) {
      foot.append(el('button', { type: 'button', class: a.primary ? 'btn-primary !py-2.5' : 'btn-secondary !py-2.5', text: a.label, onclick: () => a.run(close) }));
    }
    d.append(el('div', { class: 'cms-dialog-body' }, [el('h2', { class: 'font-display text-xl font-bold', text: title }), body]), foot);
    d.addEventListener('cancel', () => d.remove());
    document.body.append(d);
    d.showModal();
    return { d, close };
  }

  function editRich(node) {
    const ta = el('textarea', { class: 'form-control mt-4', rows: '12' });
    ta.value = readValue(node) || '';
    const help = el('p', { class: 'form-hint', text: 'Leave a blank line between paragraphs. Start a line with “- ” for a bullet point.' });
    const { close } = dialog('Edit text', el('div', {}, [ta, help]), [
      { label: 'Cancel', run: (c) => c() },
      { label: 'Save', primary: true, run: async (c) => { if (await writeValue(node, ta.value, 'rich', { reload: true })) c(); } },
    ]);
    ta.focus();
    return close;
  }

  // ── Links ─────────────────────────────────────────────────────────────────────
  let linkBtn = null;
  let linkTarget = null;
  function hrefOf(a) {
    if (a.dataset.cmsHrefList) {
      const item = listOf(a.dataset.cmsHrefList)[Number(a.dataset.cmsIndex)] || {};
      return item.href || '';
    }
    if (a.dataset.cmsField) {
      const item = listOf(a.dataset.cms)[Number(a.dataset.cmsIndex)] || {};
      return (item[a.dataset.cmsField] || {}).href || '';
    }
    const key = a.dataset.cmsHref;
    return registry[key] ? registry[key].value : a.getAttribute('href');
  }
  function saveHref(a, href) {
    if (a.dataset.cmsHrefList) {
      const key = a.dataset.cmsHrefList;
      const items = listOf(key);
      items[Number(a.dataset.cmsIndex)].href = href;
      return saveList(key, items);
    }
    if (a.dataset.cmsField) {
      const items = listOf(a.dataset.cms);
      const f = a.dataset.cmsField;
      items[Number(a.dataset.cmsIndex)][f] = { ...(items[Number(a.dataset.cmsIndex)][f] || {}), href };
      return saveList(a.dataset.cms, items);
    }
    registry[a.dataset.cmsHref] = { type: 'href', value: href };
    return save({ values: [{ key: a.dataset.cmsHref, type: 'href', value: href }] });
  }
  function editLink(a) {
    const input = el('input', { class: 'form-control mt-4', type: 'text', inputmode: 'url', autocomplete: 'off' });
    input.value = hrefOf(a);
    const help = el('p', { class: 'form-hint', text: 'A page on this site like /contact or /services, a section like #compare, a full https:// address, mailto:name@example.com or tel:410-555-0100.' });
    dialog('Where should this link go?', el('div', {}, [input, help]), [
      { label: 'Cancel', run: (c) => c() },
      { label: 'Save link', primary: true, run: async (c) => {
        const href = input.value.trim();
        if (await saveHref(a, href)) { a.setAttribute('href', href || '#'); c(); }
      } },
    ]);
    input.focus();
    input.select();
  }
  function showLinkButton(a) {
    if (!linkBtn) {
      linkBtn = el('div', { class: 'cms-tool' }, [el('button', { type: 'button', onclick: () => linkTarget && editLink(linkTarget) }, [svg('link'), 'Link'])]);
      linkBtn.addEventListener('mouseleave', () => hideLater());
      document.body.append(linkBtn);
    }
    linkTarget = a;
    const r = a.getBoundingClientRect();
    linkBtn.style.left = `${Math.max(4, r.right + window.scrollX - 64)}px`;
    linkBtn.style.top = `${Math.max(4, r.top + window.scrollY - 34)}px`;
    linkBtn.hidden = false;
  }
  let hideTimer = 0;
  function hideLater() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (linkBtn && !linkBtn.matches(':hover')) linkBtn.hidden = true; }, 400); }
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest('[data-cms-href]');
    if (a) { clearTimeout(hideTimer); showLinkButton(a); }
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-cms-href]')) hideLater(); });
  document.addEventListener('focusin', (e) => { const a = e.target.closest('[data-cms-href]'); if (a) showLinkButton(a); });

  // ── Images ────────────────────────────────────────────────────────────────────
  async function pickImage(img) {
    const current = readValue(img) || {};
    let chosen = null;
    const grid = el('div', { class: 'cms-media-grid mt-4', role: 'list' });
    const alt = el('input', { class: 'form-control', type: 'text', maxlength: '300', id: 'cms-alt' });
    alt.value = (current && current.alt) || img.getAttribute('alt') || '';
    const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'block w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:font-semibold file:text-brand-800 hover:file:bg-brand-100', id: 'cms-file' });
    const status = el('p', { class: 'form-hint', 'aria-live': 'polite' });

    function render(items) {
      grid.replaceChildren();
      for (const it of items) {
        const b = el('button', { type: 'button', 'aria-pressed': 'false', title: it.name, 'aria-label': it.name }, [el('img', { src: it.image.srcSm || it.image.src, alt: '', loading: 'lazy' })]);
        b.addEventListener('click', () => {
          grid.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          chosen = it.image;
        });
        if (current && current.src === it.image.src) { b.setAttribute('aria-pressed', 'true'); chosen = it.image; }
        grid.append(el('div', { role: 'listitem' }, [b]));
      }
    }

    file.addEventListener('change', async () => {
      if (!file.files[0]) return;
      status.textContent = 'Uploading…';
      const form = new FormData();
      form.append('file', file.files[0]);
      form.append('alt', alt.value);
      try {
        const res = await fetch('/portal/content/media', { method: 'POST', headers: { Accept: 'application/json', 'x-csrf-token': csrf }, body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'The upload didn’t work.');
        status.textContent = 'Uploaded. It’s selected below.';
        chosen = data.item.image;
        const list = await loadLibrary();
        render(list);
      } catch (err) {
        status.textContent = err.message;
      }
      file.value = '';
    });

    async function loadLibrary() {
      const res = await fetch('/portal/content/media', { headers: { Accept: 'application/json' } });
      return res.ok ? (await res.json()).items : [];
    }

    const body = el('div', {}, [
      el('div', { class: 'mt-4 grid gap-4 sm:grid-cols-2' }, [
        el('div', {}, [el('label', { for: 'cms-file', class: 'form-label', text: 'Upload a new photo' }), file, el('p', { class: 'form-hint', text: 'JPG, PNG or WebP, up to 10 MB. We resize it and remove hidden location data.' })]),
        el('div', {}, [el('label', { for: 'cms-alt', class: 'form-label', text: 'Describe the photo (alt text)' }), alt, el('p', { class: 'form-hint', text: 'For people using screen readers, e.g. “A support worker and a client cooking together”.' })]),
      ]),
      status,
      el('p', { class: 'mt-5 text-sm font-semibold text-ink', text: 'Or choose from the library' }),
      grid,
    ]);
    dialog('Change image', body, [
      { label: 'Cancel', run: (c) => c() },
      { label: 'Use this image', primary: true, run: async (c) => {
        const pick = { ...(chosen || current), alt: alt.value.trim() };
        if (!pick.src) { status.textContent = 'Choose or upload an image first.'; return; }
        if (await writeValue(img, pick, 'image')) {
          img.src = pick.srcSm && img.src.includes('-sm.') ? pick.srcSm : pick.src;
          img.srcset = pick.srcSm ? `${pick.srcSm} 560w, ${pick.src} ${pick.w || 960}w` : '';
          img.alt = pick.alt;
          c();
        }
      } },
    ]);
    render(await loadLibrary());
  }

  // ── Floating toolbars for items and sections ───────────────────────────────────
  function toolbar(target, buttons, label) {
    const bar = el('div', { class: 'cms-tool', role: 'toolbar', 'aria-label': label || 'Item tools' });
    if (label) bar.append(el('span', { class: 'cms-tool-label', text: label }));
    for (const b of buttons) {
      const btn = el('button', { type: 'button', title: b.title, 'aria-label': b.title }, [svg(b.icon), b.text || '']);
      if (b.disabled) btn.disabled = true;
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); b.run(); });
      bar.append(btn);
    }
    return bar;
  }

  let itemBar = null;
  function showItemBar(node) {
    const key = node.dataset.cmsList;
    const i = Number(node.dataset.cmsIndex);
    const items = listOf(key);
    if (itemBar && itemBar.dataset.for === `${key}#${i}`) return;
    if (itemBar) itemBar.remove();
    const move = (to) => { const it = items.splice(i, 1)[0]; items.splice(to, 0, it); saveList(key, items, { reload: true }); };
    itemBar = toolbar(node, [
      { icon: 'left', title: 'Move earlier', disabled: i === 0, run: () => move(i - 1) },
      { icon: 'right', title: 'Move later', disabled: i === items.length - 1, run: () => move(i + 1) },
      { icon: 'copy', title: 'Duplicate', run: () => {
        const copy = clone(items[i]);
        if (copy.id) copy.id = `${String(copy.id).replace(/-copy-[a-z0-9]+$/, '')}-copy-${Math.random().toString(36).slice(2, 7)}`;
        items.splice(i + 1, 0, copy);
        saveList(key, items, { reload: true });
      } },
      { icon: 'trash', title: 'Delete', disabled: items.length <= 1, run: async () => {
        const ask = window.hloConfirm || ((o) => Promise.resolve(window.confirm(o.message)));
        if (!(await ask({ title: 'Delete this item?', message: 'You can undo by discarding the draft or restoring an earlier version.', confirmLabel: 'Delete', tone: 'danger' }))) return;
        items.splice(i, 1);
        saveList(key, items, { reload: true });
      } },
    ]);
    itemBar.dataset.for = `${key}#${i}`;
    document.body.append(itemBar);
    const r = node.getBoundingClientRect();
    itemBar.style.left = `${r.left + window.scrollX}px`;
    itemBar.style.top = `${Math.max(0, r.top + window.scrollY - 38)}px`;
  }

  let sectionBar = null;
  function showSectionBar(node) {
    const docKey = node.dataset.cmsDoc;
    const reg = registry[`${docKey}.__sections`];
    if (!reg) return;
    const k = node.dataset.cmsSection;
    if (sectionBar && sectionBar.dataset.for === k) return;
    if (sectionBar) sectionBar.remove();
    const order = [...reg.value.order];
    const hidden = new Set(reg.value.hidden);
    const i = order.indexOf(k);
    const commit = () => save({ sections: [{ doc: docKey, order, hidden: [...hidden] }] }, { reload: true });
    sectionBar = toolbar(node, [
      { icon: 'up', title: 'Move section up', disabled: i <= 0, run: () => { order.splice(i, 1); order.splice(i - 1, 0, k); commit(); } },
      { icon: 'down', title: 'Move section down', disabled: i >= order.length - 1, run: () => { order.splice(i, 1); order.splice(i + 1, 0, k); commit(); } },
      hidden.has(k)
        ? { icon: 'eye', title: 'Show this section', text: 'Show', run: () => { hidden.delete(k); commit(); } }
        : { icon: 'eyeOff', title: 'Hide this section', text: 'Hide', run: () => { hidden.add(k); commit(); } },
    ], `${node.dataset.cmsLabel}${hidden.has(k) ? ' (hidden)' : ''}`);
    sectionBar.dataset.for = k;
    document.body.append(sectionBar);
    const r = node.getBoundingClientRect();
    sectionBar.style.left = `${r.left + window.scrollX + 8}px`;
    sectionBar.style.top = `${r.top + window.scrollY + 8}px`;
  }

  document.addEventListener('mouseover', (e) => {
    if (e.target.closest('.cms-tool, .cms-dialog')) return;
    const item = e.target.closest('[data-cms-list]');
    if (item) showItemBar(item);
    const section = e.target.closest('[data-cms-section]');
    if (section) showSectionBar(section);
  });

  // ── Start ─────────────────────────────────────────────────────────────────────
  const scroll = sessionStorage.getItem('cms-scroll');
  if (scroll) { sessionStorage.removeItem('cms-scroll'); window.scrollTo(0, Number(scroll)); }

  // Tell the editor which documents this page uses, and the page settings fields.
  const docs = [...new Set(Object.keys(registry).filter((k) => registry[k].editable).map((k) => k.split('.')[0]))];
  const settings = Object.entries(registry).filter(([, v]) => v.type === 'plain' && v.editable).map(([key, v]) => ({ key, label: v.label || key, value: v.value }));
  tell({ type: 'ready', docs, settings, path: location.pathname });
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.source !== 'cms-editor') return;
    // "Save draft" / "Cancel" in the toolbar: finish the text being typed (which saves it), then report back.
    if (e.data.type === 'flush') {
      const active = document.activeElement;
      if (active && active.isContentEditable) active.blur();
      const started = Date.now();
      const wait = () => {
        if (inFlight > 0 && Date.now() - started < 8000) return setTimeout(wait, 100);
        tell({ type: 'flushed', ok: inFlight === 0 });
      };
      setTimeout(wait, 50);
      return;
    }
    if (e.data.type === 'settings') {
      const values = e.data.values.map((v) => ({ key: v.key, type: 'plain', value: v.value }));
      save({ values }, { reload: true });
    }
  });
})();
