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

  // Move focus to a form's error summary so screen reader users hear it first.
  const summary = document.querySelector('[data-focus-on-load]');
  if (summary) summary.focus();

  // Disable submit buttons after the first click to avoid double submissions.
  document.querySelectorAll('form[data-once]').forEach((form) => {
    form.addEventListener('submit', () => {
      form.querySelectorAll('button[type="submit"]').forEach((b) => {
        b.disabled = true;
        b.dataset.label = b.textContent;
        b.textContent = 'Sending…';
      });
    });
  });
});
