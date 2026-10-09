// Lets CSS hide not-yet-revealed elements only when this script is running.
document.documentElement.classList.add('js');

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
  const revealables = document.querySelectorAll('.reveal');
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
    setInterval(() => { if (document.visibilityState === 'visible') loadNotifications(); }, 30000);
    // Coming back to a tab: check straight away (the session may have ended while it was hidden).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadNotifications(); });
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
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
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
});
