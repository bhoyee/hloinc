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

  // Publish / discard.
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      publishBtn.disabled = true;
      setStatus('Publishing…', 'draft');
      try {
        const { published } = await post('/publish', { docs });
        setStatus(published.length ? 'Published · live on the website now' : 'Nothing to publish', 'live');
        if (discardBtn) discardBtn.disabled = true;
      } catch (err) {
        setStatus(err.message, 'error');
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
      } catch (err) {
        setStatus(err.message, 'error');
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
