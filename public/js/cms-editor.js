/*
 * Page editor toolbar (portal). The page itself is edited inside the frame by
 * cms-frame.js; this file handles the page picker, preview sizes, draft
 * status, page settings, history, discard and publish.
 */
(() => {
  'use strict';

  const root = document.querySelector('[data-cms-editor]');
  if (!root) return;
  const page = root.dataset.page;
  const editable = root.dataset.editable === 'yes';
  const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  const frame = document.querySelector('[data-frame]');
  const wrap = document.querySelector('[data-frame-wrap]');
  const statusText = document.querySelector('[data-status]');
  const statusDot = document.querySelector('[data-status-dot]');
  const publishBtn = document.querySelector('[data-publish]');
  const discardBtn = document.querySelector('[data-discard]');
  const api = (path) => `/portal/content/pages/${encodeURIComponent(page)}${path}`;

  let docs = [page];
  let settings = [];

  async function post(path, body) {
    const res = await fetch(api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  function setStatus(text, kind) {
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.classList.toggle('bg-amber-500', kind === 'draft');
      statusDot.classList.toggle('bg-brand-500', kind === 'live');
      statusDot.classList.toggle('bg-accent-600', kind === 'error');
    }
  }

  /*
   * A clear pop-up after Publish, Save draft and Discard (the status pill is small, and
   * hidden on narrow screens). Success closes by itself after a few seconds; errors stay
   * until closed. tone: 'live' | 'draft' | 'info' | 'error'.
   */
  const TONES = {
    live: { ring: 'ring-brand-200', icon: 'bg-brand-600', mark: 'M5 12.5l4.5 4.5L19 7.5' },
    draft: { ring: 'ring-amber-200', icon: 'bg-amber-500', mark: 'M6 4h9l3 3v13H6zM9 4v5h6V4' },
    info: { ring: 'ring-line', icon: 'bg-[#93a49b]', mark: 'M12 8v.5M12 11v6' },
    error: { ring: 'ring-accent-200', icon: 'bg-accent-600', mark: 'M12 7v6M12 16.5v.5' },
  };
  let toastEl = null;
  let toastTimer = null;
  function toast({ tone = 'live', title, text = '', link = null }) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    const t = TONES[tone] || TONES.info;
    const el = document.createElement('div');
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    el.className = `fixed right-4 bottom-4 left-4 z-[200] mx-auto flex max-w-md items-start gap-3 rounded-2xl bg-white p-4 shadow-lift ring-2 ${t.ring} transition duration-300 sm:left-auto sm:right-6 sm:bottom-6 translate-y-3 opacity-0`;
    const icon = document.createElement('span');
    icon.className = `grid size-9 shrink-0 place-items-center rounded-full text-white ${t.icon}`;
    icon.innerHTML = `<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${t.mark}"/></svg>`;
    const body = document.createElement('div');
    body.className = 'min-w-0 flex-1';
    const h = document.createElement('p');
    h.className = 'font-bold text-ink';
    h.textContent = title;
    body.append(h);
    if (text) {
      const p = document.createElement('p');
      p.className = 'mt-0.5 text-sm text-muted';
      p.textContent = text;
      body.append(p);
    }
    if (link) {
      const a = document.createElement('a');
      a.href = link.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'mt-2 inline-block text-sm font-semibold text-brand-700 underline underline-offset-2';
      a.textContent = link.label;
      body.append(a);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink';
    close.setAttribute('aria-label', 'Close message');
    close.innerHTML = '<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const hide = () => {
      el.classList.add('opacity-0', 'translate-y-3');
      setTimeout(() => el.remove(), 300);
    };
    close.addEventListener('click', hide);
    el.append(icon, body, close);
    document.body.append(el);
    toastEl = el;
    requestAnimationFrame(() => el.classList.remove('opacity-0', 'translate-y-3'));
    if (tone !== 'error') {
      const start = () => { toastTimer = setTimeout(hide, 7000); };
      el.addEventListener('mouseenter', () => clearTimeout(toastTimer));
      el.addEventListener('mouseleave', start);
      el.addEventListener('focusin', () => clearTimeout(toastTimer));
      start();
    }
  }
  const liveLink = root.dataset.live ? { href: root.dataset.live, label: 'View the live page' } : null;

  async function refreshStatus() {
    try {
      const res = await fetch(`${api('/status')}?docs=${encodeURIComponent(docs.join(','))}`, { headers: { Accept: 'application/json' } });
      if (res.redirected) { window.location.reload(); return; }
      const { pending } = await res.json();
      const has = pending.length > 0;
      setStatus(has ? 'Unpublished changes (draft)' : 'Published · no changes', has ? 'draft' : 'live');
      if (publishBtn) publishBtn.disabled = !has;
      if (discardBtn) discardBtn.disabled = !has;
    } catch {
      setStatus('Couldn’t check status', 'error');
    }
  }

  // Messages from the page in the frame.
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.source !== 'cms-frame') return;
    const m = e.data;
    if (m.type === 'ready') {
      docs = m.docs.length ? [...new Set([page, ...m.docs])] : [page];
      settings = m.settings || [];
      refreshStatus();
    } else if (m.type === 'saving') {
      setStatus('Saving…', 'draft');
    } else if (m.type === 'saved') {
      refreshStatus();
    } else if (m.type === 'error') {
      setStatus('Not saved', 'error');
    }
  });

  // Switching page.
  const picker = document.querySelector('[data-page-picker]');
  if (picker) picker.addEventListener('change', () => { window.location.href = `/portal/content/pages/${encodeURIComponent(picker.value)}`; });

  // Preview sizes.
  const WIDTHS = { desktop: '', tablet: '834px', phone: '390px' };
  document.querySelectorAll('[data-device]').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-device]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      wrap.style.maxWidth = WIDTHS[b.dataset.device];
    });
  });

  // Ask the page to finish the edit in progress (it saves it), then wait for it.
  function flush() {
    return new Promise((resolve) => {
      const done = (e) => {
        if (e.origin !== location.origin || !e.data || e.data.source !== 'cms-frame' || e.data.type !== 'flushed') return;
        window.removeEventListener('message', done);
        clearTimeout(timer);
        resolve(e.data.ok !== false);
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', done);
        resolve(true);
      }, 9000);
      window.addEventListener('message', done);
      try {
        frame.contentWindow.postMessage({ source: 'cms-editor', type: 'flush' }, location.origin);
      } catch {
        clearTimeout(timer);
        resolve(true);
      }
    });
  }

  // Save draft: everything is kept as a draft to continue later.
  const saveDraftBtn = document.querySelector('[data-save-draft]');
  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', async () => {
      saveDraftBtn.disabled = true;
      setStatus('Saving draft…', 'draft');
      const ok = await flush();
      await refreshStatus();
      const hasDraft = publishBtn && !publishBtn.disabled;
      if (ok) {
        setStatus(hasDraft ? 'Draft saved · continue any time, then Publish' : 'Saved · nothing new to publish', hasDraft ? 'draft' : 'live');
        toast(hasDraft
          ? { tone: 'draft', title: 'Draft saved', text: 'Visitors don’t see these changes yet. Click Publish when you’re ready.' }
          : { tone: 'info', title: 'Nothing new to save', text: 'There are no changes waiting to be published.' });
      } else {
        setStatus('Not saved. Please try again.', 'error');
        toast({ tone: 'error', title: 'Not saved', text: 'Your changes couldn’t be saved. Please try again.' });
      }
      saveDraftBtn.disabled = false;
    });
  }

  // Cancel: keep the draft and go back to where you came from (or Site content).
  const cancelBtn = document.querySelector('[data-cancel]');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      await flush();
      let back = '/portal/content';
      try {
        const ref = new URL(document.referrer);
        if (ref.origin === location.origin && ref.pathname.startsWith('/portal') && !ref.pathname.startsWith('/portal/content/pages/')) back = ref.pathname + ref.search;
      } catch {
        // no usable previous page
      }
      window.location.href = back;
    });
  }

  // Publish / discard.
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      publishBtn.disabled = true;
      setStatus('Publishing…', 'draft');
      try {
        const { published } = await post('/publish', { docs });
        setStatus(published.length ? 'Published · live on the website now' : 'Nothing to publish', 'live');
        if (discardBtn) discardBtn.disabled = true;
        toast(published.length
          ? { tone: 'live', title: 'Published', text: 'Your changes are live on the website now.', link: liveLink }
          : { tone: 'info', title: 'Nothing to publish', text: 'There were no unpublished changes on this page.' });
      } catch (err) {
        setStatus('Not published', 'error');
        toast({ tone: 'error', title: 'Not published', text: `${err.message} Your changes are still saved as a draft.` });
        publishBtn.disabled = false;
      }
    });
  }
  if (discardBtn) {
    discardBtn.addEventListener('click', async () => {
      if (!(await window.hloConfirm({ title: 'Discard all changes?', message: 'Throw away all unpublished changes on this page? The live website isn’t affected.', confirmLabel: 'Discard changes', tone: 'danger' }))) return;
      try {
        await post('/discard', { docs });
        frame.contentWindow.location.reload();
        toast({ tone: 'info', title: 'Changes discarded', text: 'The page is back to what’s live on the website.' });
      } catch (err) {
        setStatus(err.message, 'error');
        toast({ tone: 'error', title: 'Not discarded', text: err.message });
      }
    });
  }

  // Page settings (title and description for browser tabs and search results).
  const settingsDialog = document.querySelector('[data-settings-dialog]');
  const settingsFields = document.querySelector('[data-settings-fields]');
  const openSettings = document.querySelector('[data-open-settings]');
  if (openSettings && settingsDialog) {
    openSettings.addEventListener('click', () => {
      settingsFields.replaceChildren();
      if (!settings.length) {
        const p = document.createElement('p');
        p.className = 'text-sm text-muted';
        p.textContent = 'This page has no settings to change.';
        settingsFields.append(p);
      }
      settings.forEach((s, i) => {
        const div = document.createElement('div');
        const label = document.createElement('label');
        label.className = 'form-label';
        label.htmlFor = `cms-setting-${i}`;
        label.textContent = s.label;
        const long = /description/i.test(s.key);
        const input = document.createElement(long ? 'textarea' : 'input');
        input.id = `cms-setting-${i}`;
        input.className = 'form-control';
        input.maxLength = long ? 300 : 70;
        if (long) input.rows = 3;
        input.value = s.value;
        input.dataset.key = s.key;
        const hint = document.createElement('p');
        hint.className = 'form-hint';
        hint.textContent = long ? 'One or two sentences, up to about 160 characters for Google.' : 'Short and specific, up to about 60 characters. “| Healthy Living Option Inc.” is added after it.';
        div.append(label, input, hint);
        settingsFields.append(div);
      });
      settingsDialog.showModal();
    });
    settingsDialog.addEventListener('close', () => {
      if (settingsDialog.returnValue !== 'save') return;
      const values = [...settingsFields.querySelectorAll('[data-key]')].map((f) => ({ key: f.dataset.key, value: f.value.trim() }));
      const changed = values.filter((v) => v.value && v.value !== (settings.find((s) => s.key === v.key) || {}).value);
      if (changed.length) frame.contentWindow.postMessage({ source: 'cms-editor', type: 'settings', values: changed }, location.origin);
    });
  }

  // History and restore.
  const historyDialog = document.querySelector('[data-history-dialog]');
  const historyList = document.querySelector('[data-history-list]');
  const openHistory = document.querySelector('[data-open-history]');
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (openHistory && historyDialog) {
    openHistory.addEventListener('click', async () => {
      historyList.replaceChildren();
      historyDialog.showModal();
      try {
        const res = await fetch(api('/history'), { headers: { Accept: 'application/json' } });
        const { versions } = await res.json();
        if (!versions.length) {
          const li = document.createElement('li');
          li.className = 'py-3 text-sm text-muted';
          li.textContent = 'This page hasn’t been published from the editor yet. It shows the original design.';
          historyList.append(li);
        }
        versions.forEach((v, i) => {
          const li = document.createElement('li');
          li.className = 'flex items-center justify-between gap-4 py-3';
          const text = document.createElement('p');
          text.className = 'text-[15px] text-ink';
          text.textContent = `${fmt.format(new Date(v.created_at))}${v.published_by_name ? ` · ${v.published_by_name}` : ''}${i === 0 ? ' (current)' : ''}`;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-secondary !px-4 !py-2';
          btn.textContent = 'Restore';
          btn.addEventListener('click', async () => {
            try {
              await post('/restore', { revision: v.id });
              historyDialog.close();
              frame.contentWindow.location.reload();
            } catch (err) {
              btn.textContent = err.message;
            }
          });
          li.append(text, btn);
          historyList.append(li);
        });
      } catch {
        historyList.textContent = 'The history couldn’t be loaded.';
      }
    });
    document.querySelector('[data-close-history]').addEventListener('click', () => historyDialog.close());
    document.querySelector('[data-reset]').addEventListener('click', async () => {
      if (!(await window.hloConfirm({ title: 'Reset to the original design?', message: 'Replace this page’s draft with the original design and text? You can still discard the draft afterwards.', confirmLabel: 'Reset draft' }))) return;
      try {
        await post('/reset');
        historyDialog.close();
        frame.contentWindow.location.reload();
      } catch (err) {
        setStatus(err.message, 'error');
      }
    });
  }

  if (!editable) setStatus('View only', 'live');
})();
