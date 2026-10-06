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
