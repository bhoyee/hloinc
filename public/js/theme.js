/*
 * Light or dark theme for the public website. Loaded in <head> (not deferred) so the
 * right theme is set before anything is drawn: no white flash on a dark device.
 * The visitor's choice from the sun/moon button wins; otherwise follow the device.
 */
(function () {
  var KEY = 'hlo-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) {
      return null;
    }
  }
  function apply(theme) {
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }
  apply(saved() || (media && media.matches ? 'dark' : 'light'));
  // Follow the device as it changes (e.g. automatic dark mode at sunset), unless the visitor chose.
  if (media && media.addEventListener) {
    media.addEventListener('change', function (e) {
      if (!saved()) apply(e.matches ? 'dark' : 'light');
    });
  }
  window.hloTheme = {
    toggle: function () {
      var next = root.classList.contains('dark') ? 'light' : 'dark';
      apply(next);
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        // Private browsing: the choice lasts for this page only.
      }
      return next;
    },
  };
})();
