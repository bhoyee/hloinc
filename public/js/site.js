// Lets CSS hide not-yet-revealed elements only when this script is running.
document.documentElement.classList.add('js');

/**
 * A modern confirmation dialog, used instead of the browser's confirm() box.
 * `hloConfirm({ title, message, confirmLabel, tone })` resolves true or false.
 * tone: 'danger' (deleting: red, focus starts on Cancel) or 'warning'.
 * Forms with data-confirm="message" use it automatically (see below); optional
 * data-confirm-title and data-confirm-button change the wording.
 */
window.hloConfirm = (() => {
  const ICONS = {
    danger: 'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
    warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  };
  let dialog;
  let parts;

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'm-auto w-[calc(100%-2rem)] max-w-md overflow-visible rounded-3xl bg-transparent p-0 backdrop:bg-[#052a1e]/55 backdrop:backdrop-blur-sm';
    dialog.setAttribute('aria-labelledby', 'hlo-confirm-title');
    dialog.setAttribute('aria-describedby', 'hlo-confirm-text');
    dialog.innerHTML = `
      <div class="animate-fade-up rounded-3xl bg-white p-6 shadow-lift ring-1 ring-line sm:p-7" data-panel>
        <div class="flex items-start gap-4">
          <span class="grid size-12 shrink-0 place-items-center rounded-2xl" data-icon-wrap>
            <svg class="size-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" data-icon></path></svg>
          </span>
          <div class="min-w-0 pt-0.5">
            <h2 id="hlo-confirm-title" class="font-display text-lg font-bold text-ink"></h2>
            <p id="hlo-confirm-text" class="mt-1.5 text-[15px] leading-relaxed text-muted"></p>
          </div>
        </div>
        <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" class="btn-secondary !py-2.5" data-cancel>Cancel</button>
          <button type="button" class="btn !py-2.5 text-white" data-ok></button>
        </div>
      </div>`;
    document.body.append(dialog);
    parts = {
      title: dialog.querySelector('#hlo-confirm-title'),
      text: dialog.querySelector('#hlo-confirm-text'),
      icon: dialog.querySelector('[data-icon]'),
      iconWrap: dialog.querySelector('[data-icon-wrap]'),
      ok: dialog.querySelector('[data-ok]'),
      cancel: dialog.querySelector('[data-cancel]'),
    };
    // A click on the dimmed area outside the card cancels.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close('cancel');
    });
  }

  return function hloConfirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', tone = 'warning' } = {}) {
    if (typeof HTMLDialogElement !== 'function') return Promise.resolve(window.confirm(message || title));
    if (!dialog) build();
    const danger = tone === 'danger';
    parts.title.textContent = title;
    parts.text.textContent = message;
    parts.text.hidden = !message;
    parts.icon.setAttribute('d', ICONS[danger ? 'danger' : 'warning']);
    parts.iconWrap.className = `grid size-12 shrink-0 place-items-center rounded-2xl ${danger ? 'bg-accent-50 text-accent-600 ring-1 ring-accent-100' : 'bg-amber-50 text-amber-600 ring-1 ring-amber-100'}`;
    parts.ok.textContent = confirmLabel;
    parts.ok.className = `btn !py-2.5 text-white ${danger ? 'bg-accent-600 hover:bg-accent-700' : 'bg-brand-700 hover:bg-brand-800'}`;
    return new Promise((resolve) => {
      const finish = (answer) => {
        parts.ok.removeEventListener('click', onOk);
        parts.cancel.removeEventListener('click', onCancel);
        dialog.removeEventListener('close', onClose);
        if (dialog.open) dialog.close();
        resolve(answer);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onClose = () => finish(false); // Esc or a click outside
      parts.ok.addEventListener('click', onOk);
      parts.cancel.addEventListener('click', onCancel);
      dialog.addEventListener('close', onClose);
      dialog.showModal();
      // Deleting: start on Cancel, so Enter by accident deletes nothing.
      (danger ? parts.cancel : parts.ok).focus();
    });
  };
})();

// Forms with data-confirm ask first. Delegated, so it also works on parts of a
// page that refresh live (e.g. the dashboard's staff board).
document.addEventListener(
  'submit',
  (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || !form.dataset.confirm) return;
    if (form.dataset.confirmed === '1') {
      delete form.dataset.confirmed;
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    const action = form.getAttribute('action') || '';
    const danger = /\/(delete|archive)(\?|$)/.test(action) || /delete/i.test(form.dataset.confirm);
    const ending = /\/end(\?|$)/.test(action);
    const submitter = e.submitter;
    window
      .hloConfirm({
        title: form.dataset.confirmTitle || (danger ? 'Delete this?' : ending ? 'End this now?' : 'Are you sure?'),
        message: form.dataset.confirm,
        confirmLabel: form.dataset.confirmButton || (danger ? 'Delete' : ending ? 'End now' : 'Confirm'),
        tone: danger ? 'danger' : 'warning',
      })
      .then((ok) => {
        if (!ok) return;
        form.dataset.confirmed = '1';
        if (form.requestSubmit) form.requestSubmit(submitter && form.contains(submitter) ? submitter : undefined);
        else form.submit();
      });
  },
  true
);

document.addEventListener('DOMContentLoaded', () => {
  // Mobile navigation toggle.
  const toggle = document.querySelector('[data-menu-toggle]');
  if (toggle) {
    const menu = document.getElementById(toggle.getAttribute('aria-controls'));
    const label = toggle.querySelector('[data-menu-label]');
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('hidden', !open);
      toggle.querySelector('[data-menu-open]').classList.toggle('hidden', open);
      toggle.querySelector('[data-menu-close]').classList.toggle('hidden', !open);
      label.textContent = open ? 'Close menu' : 'Open menu';
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  // Cookie notice: informational, remembered per browser once dismissed.
  const notice = document.getElementById('cookie-notice');
  if (notice) {
    let seen = false;
    try { seen = localStorage.getItem('hlo-cookie-notice') === '1'; } catch { /* storage blocked */ }
    if (!seen) notice.hidden = false;
    notice.querySelector('[data-cookie-dismiss]').addEventListener('click', () => {
      notice.hidden = true;
      try { localStorage.setItem('hlo-cookie-notice', '1'); } catch { /* storage blocked */ }
    });
  }

  // Reveal elements as they scroll into view.
  const revealables = document.querySelectorAll('.reveal, .line-grow');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add('is-visible'));
  }

  // Filter buttons: show only items whose data-where includes the chosen value.
  document.querySelectorAll('[data-filter-scope]').forEach((scope) => {
    const controls = scope.querySelector('[data-filter-controls]');
    if (!controls) return;
    controls.hidden = false;
    const buttons = controls.querySelectorAll('[data-filter]');
    const status = scope.querySelector('[data-filter-status]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.filter;
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        let shown = 0;
        // Table rows (tablet/desktop) and cards (phone) list the same services;
        // count the rows so the announced number is per service.
        scope.querySelectorAll('[data-where]').forEach((item) => {
          const match = value === 'all' || item.dataset.where.split(' ').includes(value);
          item.hidden = !match;
          if (match && item.tagName === 'TR') shown++;
        });
        if (status) {
          status.textContent = value === 'all'
            ? 'Showing all services'
            : `Showing ${shown} service${shown === 1 ? '' : 's'} ${btn.textContent.trim().toLowerCase()}`;
        }
      });
    });
  });

  // Live search: results update while the visitor types, changes a filter or
  // changes page, without reloading. The server returns just the results
  // block (?partial=1). Without JS the form submits normally.
  document.querySelectorAll('form[data-live-search]').forEach((form) => {
    const target = document.querySelector(form.dataset.liveSearch);
    const status = document.querySelector('[data-results-status]');
    if (!target) return;
    const base = form.getAttribute('action').split('#')[0];
    let timer;
    let controller;

    // Current form values -> clean URL (empty fields left out).
    const urlFromForm = () => {
      const params = new URLSearchParams();
      new FormData(form).forEach((v, k) => {
        if (String(v).trim()) params.set(k, String(v).trim());
      });
      const qs = params.toString();
      return base + (qs ? `?${qs}` : '');
    };

    // Put a URL's search values back into the form (for links and Back/Forward).
    const syncForm = (url) => {
      const params = new URL(url, location.origin).searchParams;
      form.querySelectorAll('[name]').forEach((field) => {
        field.value = params.get(field.name) || '';
      });
    };

    const load = async (url, { push = false, scroll = false } = {}) => {
      if (controller) controller.abort();
      controller = new AbortController();
      target.setAttribute('aria-busy', 'true');
      try {
        const sep = url.includes('?') ? '&' : '?';
        const res = await fetch(`${url}${sep}partial=1`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        target.innerHTML = await res.text();
        history[push ? 'pushState' : 'replaceState'](null, '', `${url}#positions`);
        const count = target.querySelector('[data-results-count] p');
        if (status) status.textContent = count ? count.textContent.replace(/\s+/g, ' ').trim() : '';
        if (scroll) document.getElementById('positions').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        if (err.name !== 'AbortError') window.location.href = `${url}#positions`; // fall back to a full page load
      } finally {
        target.removeAttribute('aria-busy');
      }
    };

    form.addEventListener('input', (e) => {
      if (e.target.tagName !== 'INPUT') return;
      clearTimeout(timer);
      timer = setTimeout(() => load(urlFromForm()), 300);
    });
    form.addEventListener('change', (e) => {
      if (e.target.tagName === 'SELECT') load(urlFromForm());
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(timer);
      load(urlFromForm());
    });

    // Pagination and "Clear search" links (not links to individual jobs).
    target.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      const href = link.getAttribute('href').split('#')[0];
      if (!(href === base || href.startsWith(`${base}?`))) return;
      e.preventDefault();
      syncForm(href);
      load(href, { push: true, scroll: true });
    });

    window.addEventListener('popstate', () => {
      syncForm(location.href);
      load(location.pathname + location.search);
    });
  });

  // Contact page: load Google Maps only when the visitor asks for it, so no
  // Google cookies are set otherwise.
  document.querySelectorAll('[data-map-src]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.src = btn.dataset.mapSrc;
      iframe.title = btn.dataset.mapTitle;
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.className = 'absolute inset-0 h-full w-full border-0';
      iframe.tabIndex = 0;
      btn.closest('[data-map]').replaceChildren(iframe);
      iframe.focus();
    });
  });

  // Contact page: "Who should I contact?" shortcuts pick the recipient in the form.
  const recipientSelect = document.getElementById('f-recipient');
  document.querySelectorAll('[data-set-recipient]').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (!recipientSelect) return;
      e.preventDefault();
      recipientSelect.value = link.dataset.setRecipient;
      document.getElementById('contact-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      recipientSelect.classList.add('ring-4', 'ring-accent-200');
      setTimeout(() => {
        recipientSelect.focus({ preventScroll: true });
        recipientSelect.classList.remove('ring-4', 'ring-accent-200');
      }, 900);
    });
  });

  // Portal: sidebar drawer on small screens.
  const portalNav = document.querySelector('[data-portal-nav]');
  if (portalNav) {
    const openBtn = document.querySelector('[data-portal-nav-open]');
    const backdrop = document.querySelector('[data-portal-nav-backdrop]');
    const setOpen = (open) => {
      portalNav.classList.toggle('hidden', !open);
      portalNav.classList.toggle('flex', open);
      backdrop.classList.toggle('hidden', !open);
      openBtn.setAttribute('aria-expanded', String(open));
      if (open) portalNav.querySelector('a, button').focus();
      else openBtn.focus();
    };
    openBtn.addEventListener('click', () => setOpen(true));
    document.querySelector('[data-portal-nav-close]').addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openBtn.getAttribute('aria-expanded') === 'true') setOpen(false);
    });
  }

  // Role editor: giving an action ticks View; removing View clears the row.
  const roleEditor = document.querySelector('form[data-role-editor]');
  if (roleEditor) {
    const boxes = (module) => roleEditor.querySelectorAll(`input[name="permissions"]${module ? `[data-module="${module}"]` : ''}`);
    roleEditor.addEventListener('change', (e) => {
      const box = e.target;
      if (box.name !== 'permissions') return;
      const view = roleEditor.querySelector(`input[data-module="${box.dataset.module}"][data-action="view"]`);
      if (box.checked && box.dataset.action !== 'view' && view && box.value !== 'messages.view_intake') view.checked = true;
      if (!box.checked && box.dataset.action === 'view') {
        boxes(box.dataset.module).forEach((b) => {
          if (b.dataset.action !== 'extra' || b.value.endsWith('.log') || b.value.endsWith('.edit_limited')) b.checked = false;
        });
      }
      // "View all messages" and "intake only" are alternatives.
      if (box.checked && box.value === 'messages.view') roleEditor.querySelector('input[value="messages.view_intake"]').checked = false;
      if (box.checked && box.value === 'messages.view_intake' && view) view.checked = false;
    });
    roleEditor.querySelectorAll('[data-row-all]').forEach((btn) => btn.addEventListener('click', () => {
      boxes(btn.dataset.rowAll).forEach((b) => { b.checked = b.value !== 'messages.view_intake'; });
    }));
    const all = roleEditor.querySelector('[data-perm-all]');
    if (all) all.addEventListener('click', () => boxes().forEach((b) => { b.checked = b.value !== 'messages.view_intake'; }));
    const none = roleEditor.querySelector('[data-perm-none]');
    if (none) none.addEventListener('click', () => boxes().forEach((b) => { b.checked = false; }));
  }

  // ── Portal header ────────────────────────────────────────────────────

  const csrf = document.querySelector('meta[name="csrf-token"]');
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text; // textContent: never parsed as HTML
    return node;
  };

  // Dropdowns (notifications, profile): one open at a time; Escape / outside click closes.
  const dropdowns = [...document.querySelectorAll('[data-dropdown]')];
  const closeAll = (except) => dropdowns.forEach((d) => {
    if (d === except) return;
    d.querySelector('[data-dropdown-panel]').classList.add('hidden');
    d.querySelector('[data-dropdown-button]').setAttribute('aria-expanded', 'false');
  });
  dropdowns.forEach((d) => {
    const btn = d.querySelector('[data-dropdown-button]');
    const panel = d.querySelector('[data-dropdown-panel]');
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      closeAll(d);
      panel.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
      if (open && btn.hasAttribute('data-notif-button')) loadNotifications();
    });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('[data-dropdown]')) closeAll(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = dropdowns.find((d) => d.querySelector('[data-dropdown-button]').getAttribute('aria-expanded') === 'true');
    if (open) { closeAll(); open.querySelector('[data-dropdown-button]').focus(); }
  });

  // Phones: search bar under the header.
  const mobileToggle = document.querySelector('[data-mobile-search-toggle]');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      const bar = document.getElementById('mobile-search');
      const open = bar.classList.toggle('hidden') === false;
      mobileToggle.setAttribute('aria-expanded', String(open));
      if (open) bar.querySelector('input').focus();
    });
  }

  // Global search: live results as you type; Enter still opens the full results page.
  document.querySelectorAll('form[data-global-search]').forEach((form) => {
    const input = form.querySelector('[data-search-input]');
    const panel = form.querySelector('[data-search-results]');
    const status = form.querySelector('[data-search-status]');
    let timer;
    let controller;

    const hide = () => panel.classList.add('hidden');
    const render = (data) => {
      panel.replaceChildren();
      const total = data.groups.reduce((n, g) => n + g.items.length, 0);
      if (!total) {
        panel.append(el('p', 'px-3 py-4 text-sm text-muted', `No results for “${data.q}”.`));
      }
      data.groups.forEach((g) => {
        panel.append(el('p', 'px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase', g.label));
        g.items.forEach((it) => {
          const row = el(it.href ? 'a' : 'div', 'flex flex-col rounded-xl px-3 py-2 hover:bg-surface focus:bg-surface focus:outline-none');
          if (it.href) row.href = it.href;
          row.append(el('span', 'truncate font-semibold text-ink', it.title), el('span', 'truncate text-sm text-muted', it.subtitle || ''));
          panel.append(row);
        });
      });
      const all = el('a', 'mt-1 block rounded-xl border-t border-line px-3 py-2.5 text-sm font-semibold text-brand-700 hover:bg-surface', 'See all results');
      all.href = `/portal/search?q=${encodeURIComponent(data.q)}`;
      panel.append(all);
      panel.classList.remove('hidden');
      // Results count is announced through the live region.
      status.textContent = total ? `${total} result${total === 1 ? '' : 's'}` : 'No results';
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { hide(); return; }
      timer = setTimeout(async () => {
        if (controller) controller.abort();
        controller = new AbortController();
        try {
          const res = await fetch(`/portal/search?format=json&q=${encodeURIComponent(q)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
          if (res.ok) render(await res.json());
        } catch { /* aborted or offline: the form still works on Enter */ }
      }, 250);
    });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2 && panel.childElementCount) panel.classList.remove('hidden'); });
    form.addEventListener('focusout', () => setTimeout(() => { if (!form.contains(document.activeElement)) hide(); }, 0));

    // Arrow keys move through results; Escape closes.
    form.addEventListener('keydown', (e) => {
      const links = [...panel.querySelectorAll('a')];
      const i = links.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && links.length) { e.preventDefault(); links[Math.min(i + 1, links.length - 1)].focus(); }
      if (e.key === 'ArrowUp' && links.length) { e.preventDefault(); if (i <= 0) input.focus(); else links[i - 1].focus(); }
      if (e.key === 'Escape') { hide(); input.focus(); }
    });
  });

  // Ctrl+K / Cmd+K jumps to search.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      const desktop = document.getElementById('portal-search');
      if (!desktop) return;
      e.preventDefault();
      if (desktop.offsetParent) desktop.focus();
      else if (mobileToggle) mobileToggle.click();
    }
  });

  // Notifications bell: refreshes every minute while the tab is visible.
  const notifBtn = document.querySelector('[data-notif-button]');
  async function loadNotifications() {
    if (!notifBtn) return;
    try {
      const res = await fetch('/portal/notifications/summary', { headers: { Accept: 'application/json' } });
      // Signed out (idle timeout): reload so the sign-in page explains, instead of letting forms fail later.
      if (res.redirected) { window.location.reload(); return; }
      if (!res.ok) return;
      const data = await res.json();
      const count = document.querySelector('[data-notif-count]');
      // Red counters on the menu (Messages, Appointments).
      for (const [key, n] of Object.entries(data.badges || {})) {
        const value = Number(n) || 0;
        document.querySelectorAll(`[data-nav-badge="${key}"]`).forEach((b) => {
          b.textContent = value > 99 ? '99+' : String(value);
          b.classList.toggle('hidden', !value);
        });
        document.querySelectorAll(`[data-nav-badge-label="${key}"]`).forEach((l) => {
          l.textContent = value ? `, ${value} ${l.dataset.label}` : '';
        });
      }
      const anyBadge = Object.values(data.badges || {}).some((n) => Number(n) > 0);
      document.querySelectorAll('[data-nav-badge-any]').forEach((d) => d.classList.toggle('hidden', !anyBadge));
      count.textContent = data.unread > 99 ? '99+' : String(data.unread);
      count.classList.toggle('hidden', !data.unread);
      document.querySelector('[data-notif-label]').textContent = `Notifications${data.unread ? `, ${data.unread} unread` : ''}`;

      const list = document.querySelector('[data-notif-list]');
      list.replaceChildren();
      if (!data.items.length) list.append(el('li', 'px-4 py-6 text-center text-sm text-muted', 'You’re all caught up.'));
      data.items.forEach((n) => {
        const li = el('li', n.read ? '' : 'bg-brand-50/50');
        const btn = el('button', 'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface');
        btn.type = 'button';
        btn.append(el('span', `mt-1.5 size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-accent-500'}`));
        const text = el('span', 'min-w-0 flex-1');
        text.append(el('span', 'block text-sm font-semibold text-ink', n.title));
        if (n.body) text.append(el('span', 'block text-sm text-muted', n.body));
        text.append(el('span', 'mt-0.5 block text-xs text-muted', new Date(n.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
        btn.append(text);
        btn.addEventListener('click', async () => {
          await fetch(`/portal/notifications/${n.id}/read`, { method: 'POST', headers: { Accept: 'application/json', 'x-csrf-token': csrf ? csrf.content : '' } });
          window.location.href = n.link || '/portal/notifications';
        });
        li.append(btn);
        list.append(li);
      });
    } catch { /* offline: try again next time */ }
  }
  if (notifBtn) {
    setInterval(() => { if (document.visibilityState === 'visible') loadNotifications(); }, 15000);
    // Coming back to a tab: check straight away (the session may have ended while it was hidden).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadNotifications(); });
    // Saved something in another tab: update the menu counters now.
    try { new BroadcastChannel('hlo-portal').addEventListener('message', (e) => { if (e.data === 'changed') loadNotifications(); }); } catch { /* older browsers */ }
    const readAll = document.querySelector('[data-notif-read-all]');
    readAll.addEventListener('click', async () => {
      await fetch('/portal/notifications/read-all', { method: 'POST', headers: { Accept: 'application/json', 'x-csrf-token': csrf ? csrf.content : '' } });
      loadNotifications();
    });
  }

  // Log appointment: picking a type fills in its usual length.
  const typeSelect = document.querySelector('select[name="type_id"] option[data-duration]') && document.querySelector('select[name="type_id"]');
  const durationInput = document.querySelector('input[name="duration_minutes"]');
  if (typeSelect && durationInput) {
    typeSelect.addEventListener('change', () => {
      const opt = typeSelect.selectedOptions[0];
      if (opt && opt.dataset.duration) durationInput.value = opt.dataset.duration;
    });
  }

  // Schedule form: "All day" hides the start/end times.
  const allDay = document.querySelector('[data-all-day]');
  if (allDay) {
    const toggle = () => document.querySelectorAll('[data-time-field]').forEach((f) => {
      f.closest('div').classList.toggle('opacity-40', allDay.checked);
      f.disabled = allDay.checked;
    });
    allDay.addEventListener('change', toggle);
    toggle();
  }

  // "Print" buttons (e.g. recovery codes).
  document.querySelectorAll('[data-print]').forEach((btn) => btn.addEventListener('click', () => window.print()));

  // Move focus to a form's error summary so screen reader users hear it first.
  const summary = document.querySelector('[data-focus-on-load]');
  if (summary) summary.focus();

  // Announcement form: live banner preview.
  document.querySelectorAll('[data-preview-out]').forEach((out) => {
    const field = document.getElementById(`f-${out.dataset.previewOut}`);
    if (!field) return;
    const fallback = out.textContent;
    const update = () => { out.textContent = field.value.trim() || fallback; };
    field.addEventListener('input', update);
    update();
  });

  // Role editor: the role checklist only matters for "their own and chosen roles".
  const scheduleRoles = document.querySelector('[data-schedule-roles]');
  document.querySelectorAll('[data-schedule-mode]').forEach((r) => {
    r.addEventListener('change', () => { if (scheduleRoles && r.checked) scheduleRoles.hidden = r.value !== 'roles'; });
  });

  // Security settings: show the warning while "Off" is chosen.
  const offWarning = document.querySelector('[data-off-warning]');
  document.querySelectorAll('[data-two-step-choice]').forEach((r) => {
    r.addEventListener('change', () => { if (offWarning) offWarning.hidden = !(r.checked && r.value === 'off'); });
  });

  // Ask before permanent, can't-undo actions.
  // Confirmations (form[data-confirm]) are handled by hloConfirm at the top of this file.

  // A tick box that shows one part of a form and hides another
  // (e.g. "Whole days" shows the last day and hides the times).
  document.querySelectorAll('input[type="checkbox"][data-toggle-on], input[type="checkbox"][data-toggle-off]').forEach((box) => {
    const apply = () => {
      document.querySelectorAll(box.dataset.toggleOn || '').forEach((el) => { el.hidden = !box.checked; });
      document.querySelectorAll(box.dataset.toggleOff || '').forEach((el) => { el.hidden = box.checked; });
    };
    box.addEventListener('change', apply);
    apply();
  });

  document.addEventListener('change', (e) => {
    const perPage = e.target.closest('form[data-per-page]');
    if (perPage && e.target.matches('select') && !perPage.closest('[data-live-results]')) perPage.submit();
  });

  // Live filters: forms with data-live-filter="#results" update that part of the
  // page as you type (after a short pause) or change a choice, and page links
  // inside it (data-page-link) work without reloading. The address keeps the
  // search, so refreshing or sharing the link shows the same list.
  document.querySelectorAll('form[data-live-filter]').forEach((form) => {
    const selector = form.dataset.liveFilter;
    const results = document.querySelector(selector);
    if (!results) return;
    form.querySelectorAll('[data-live-hide]').forEach((el) => el.classList.add('hidden'));
    let timer = 0;
    let controller = null;

    const urlFor = () => {
      const params = new URLSearchParams();
      for (const [k, v] of new FormData(form)) if (String(v).trim() !== '') params.append(k, v);
      return `${form.getAttribute('action') || location.pathname}?${params}`;
    };
    const load = async (url) => {
      if (controller) controller.abort();
      controller = new AbortController();
      results.setAttribute('aria-busy', 'true');
      results.classList.add('opacity-60', 'transition-opacity');
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/html' } });
        if (!res.ok || res.redirected) throw new Error(String(res.status));
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const fresh = doc.querySelector(selector);
        if (!fresh) throw new Error('missing');
        results.innerHTML = fresh.innerHTML;
        for (const extra of (form.dataset.liveAlso || '').split(',').map((x) => x.trim()).filter(Boolean)) {
          const here = document.querySelector(extra);
          const there = doc.querySelector(extra);
          if (here && there) here.innerHTML = there.innerHTML;
        }
        const tabNow = doc.querySelector('[data-live-tab]');
        const tabHere = form.querySelector('[data-live-tab]');
        if (tabNow && tabHere) tabHere.value = tabNow.value;
        history.replaceState(null, '', url);
      } catch (err) {
        if (err.name !== 'AbortError') location.href = url; // fall back to a normal page load
      } finally {
        results.removeAttribute('aria-busy');
        results.classList.remove('opacity-60');
      }
    };

    form.addEventListener('input', (e) => {
      if (!e.target.matches('input[type="search"], input[type="text"]')) return;
      clearTimeout(timer);
      timer = setTimeout(() => load(urlFor()), 300);
    });
    form.addEventListener('change', (e) => {
      if (e.target.matches('select, input[type="date"], input[type="checkbox"], input[type="radio"]')) load(urlFor());
    });
    form.liveLoad = load; // used by the rows-per-page choice below the list
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(timer);
      load(urlFor());
    });
    results.addEventListener('change', (e) => {
      const perPage = e.target.closest('form[data-per-page]');
      if (!perPage || !e.target.matches('select')) return;
      const params = new URLSearchParams(new FormData(perPage));
      load(`${perPage.getAttribute('action')}?${params}`);
    });
    results.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-page-link]');
      if (!link) return;
      e.preventDefault();
      // Keep hidden fields (e.g. the calendar's view and date) in step with where the link goes.
      const target = new URL(link.href, location.href);
      form.querySelectorAll('input[type="hidden"]').forEach((input) => {
        if (target.searchParams.has(input.name)) input.value = target.searchParams.get(input.name);
      });
      if (link.hasAttribute('data-clear-filters')) {
        form.querySelectorAll('input[type="search"], input[type="text"]').forEach((input) => { input.value = ''; });
        form.querySelectorAll('select').forEach((select) => { select.selectedIndex = 0; });
      }
      load(link.href).then(() => form.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    });
  });

  // Password boxes: an eye button to show or hide what was typed.
  const EYE = 'M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z';
  const EYE_OFF = 'M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88';
  document.querySelectorAll('input[type="password"]:not([data-no-reveal])').forEach((input) => {
    const wrap = document.createElement('div');
    wrap.className = 'relative';
    input.parentNode.insertBefore(wrap, input);
    wrap.append(input);
    input.classList.add('!pr-12');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-muted hover:text-ink focus-visible:text-ink';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-controls', input.id || '');
    btn.title = 'Show password';
    btn.innerHTML = `<svg class="size-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="${EYE}"/></svg>`;
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.title = show ? 'Hide password' : 'Show password';
      btn.querySelector('path').setAttribute('d', show ? EYE_OFF : EYE);
      // Keep typing where you were.
      const at = input.selectionStart;
      input.focus();
      try { input.setSelectionRange(at, at); } catch { /* some types don't support it */ }
    });
    wrap.append(btn);
    // Never submit a visible password box: hide it again on submit.
    if (input.form) input.form.addEventListener('submit', () => { input.type = 'password'; });
  });

  // Disable submit buttons after the first click to avoid double submissions.
  document.querySelectorAll('form[data-once]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      // Disabled buttons aren't sent, so keep the clicked button's name/value (e.g. "Save" vs "Publish").
      if (e.submitter && e.submitter.name) {
        const keep = document.createElement('input');
        keep.type = 'hidden';
        keep.name = e.submitter.name;
        keep.value = e.submitter.value;
        form.appendChild(keep);
      }
      form.querySelectorAll('button[type="submit"]').forEach((b) => {
        b.disabled = true;
        b.dataset.label = b.textContent;
        b.textContent = 'Sending…';
      });
    });
  });

  // Photos marked data-tilt lean gently towards the mouse. Mouse only, never while editing, and off for reduced motion.
  const canTilt = matchMedia('(hover: hover) and (pointer: fine)').matches
    && !matchMedia('(prefers-reduced-motion: reduce)').matches
    && !new URLSearchParams(location.search).has('cms');
  if (canTilt) {
    document.querySelectorAll('[data-tilt]').forEach((card) => {
      let frame = 0;
      card.style.transition = 'transform 0.5s cubic-bezier(0.2, 0.7, 0.2, 1)';
      card.addEventListener('pointermove', (e) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          card.style.transform = `perspective(1100px) rotateX(${((0.5 - y) * 6).toFixed(2)}deg) rotateY(${((x - 0.5) * 8).toFixed(2)}deg)`;
          card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
          card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
        });
      });
      card.addEventListener('pointerleave', () => {
        cancelAnimationFrame(frame);
        card.style.transform = '';
      });
    });
  }

  // Phone fields: only phone characters can be typed, and a complete US number
  // is tidied to 410-555-0123 when the field is left. The server checks it again.
  document.querySelectorAll('input[data-phone]').forEach((input) => {
    input.addEventListener('input', () => {
      const cleaned = input.value.replace(/[^\d\s().+-]/g, '');
      if (cleaned !== input.value) input.value = cleaned;
    });
    input.addEventListener('blur', () => {
      let digits = input.value.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
      if (digits.length === 10) input.value = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    });
  });

  // Live dashboard: when something is saved in the portal (a shift, an appointment,
  // a note…), tell any open dashboard tab to refresh now instead of at its next tick.
  if (location.pathname.startsWith('/portal')) {
    const SAVED = 'hlo-portal-saved';
    document.addEventListener('submit', (e) => {
      if (e.target instanceof HTMLFormElement && e.target.method.toLowerCase() === 'post') {
        try { sessionStorage.setItem(SAVED, '1'); } catch { /* private mode */ }
      }
    });
    try {
      if (sessionStorage.getItem(SAVED)) {
        sessionStorage.removeItem(SAVED);
        new BroadcastChannel('hlo-portal').postMessage('changed');
      }
    } catch { /* older browsers: dashboards still refresh every few seconds */ }
  }
});
