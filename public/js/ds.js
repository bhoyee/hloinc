/*
 * Public website behaviour (HLO's design, version 20): mobile menu and services
 * dropdown, the sticky "On this page" bar, the county checker, back to top, and
 * the three-step forms (Ask about services, Referral). Everything works without
 * JavaScript too: forms then show all their questions at once.
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var header = document.querySelector('.d-site-header');

  // --- Header: menu (phones and tablets) and the Services dropdown ------------------------------
  var nav = document.getElementById('site-nav');
  var menuBtn = document.querySelector('.d-menu-toggle');
  function setMenu(open) {
    if (!nav || !menuBtn) return;
    nav.classList.toggle('d-open', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenu(!nav.classList.contains('d-open'));
    });
  }
  var ddBtn = document.querySelector('.d-dd-toggle');
  if (ddBtn) {
    ddBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var li = ddBtn.closest('.d-has-dd');
      var open = !li.classList.contains('d-open');
      li.classList.toggle('d-open', open);
      ddBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  document.addEventListener('click', function (e) {
    if (nav && nav.classList.contains('d-open') && (!nav.contains(e.target) || e.target.closest('a'))) setMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (nav && nav.classList.contains('d-open')) {
      setMenu(false);
      menuBtn.focus();
    }
    var pn = document.querySelector('.d-pagenav.d-open');
    if (pn) closePagenav(pn, true);
  });

  // Theme button: show which theme it switches to (theme.js and site.js do the switching).
  var themeBtn = document.querySelector('.d-theme-toggle');
  if (themeBtn) {
    var pressed = function () { themeBtn.setAttribute('aria-pressed', root.classList.contains('dark') ? 'true' : 'false'); };
    pressed();
    themeBtn.addEventListener('click', function () { setTimeout(pressed, 0); });
  }

  // --- Sticky offsets: the header and the "On this page" bar --------------------------------------
  var pagenav = document.querySelector('[data-pagenav]');
  function setVars() {
    if (header) root.style.setProperty('--hdr', header.offsetHeight + 'px');
    root.style.setProperty('--pnh', (pagenav ? pagenav.offsetHeight : 0) + 'px');
  }

  // --- "On this page": highlight the section being read; a dropdown on phones ---------------------
  function closePagenav(pn, focus) {
    pn.classList.remove('d-open');
    var b = pn.querySelector('.d-pn-toggle');
    if (b) {
      b.setAttribute('aria-expanded', 'false');
      if (focus) b.focus();
    }
  }
  if (pagenav) {
    var pnBtn = pagenav.querySelector('.d-pn-toggle');
    pnBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !pagenav.classList.contains('d-open');
      pagenav.classList.toggle('d-open', open);
      pnBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!pagenav.classList.contains('d-open')) return;
      if (e.target.closest('.d-pagenav .d-wrap a') || !pagenav.contains(e.target)) closePagenav(pagenav);
    });
  }
  var toTop = document.querySelector('.d-to-top');
  var ticking = false;
  function spy() {
    ticking = false;
    if (toTop) toTop.classList.toggle('d-show', window.pageYOffset > 600);
    if (!pagenav) return;
    var links = [].slice.call(pagenav.querySelectorAll('.d-wrap a'));
    var line = (header ? header.offsetHeight : 0) + pagenav.offsetHeight + 40;
    var active = null;
    links.forEach(function (a) {
      var el = document.getElementById(a.getAttribute('data-t'));
      if (el && el.getBoundingClientRect().top <= line) active = a;
    });
    if (window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 6 && links.length) active = links[links.length - 1];
    var cur = pagenav.querySelector('.d-pn-cur');
    if (cur) cur.textContent = active ? active.textContent : 'On this page';
    links.forEach(function (a) {
      var on = a === active;
      a.classList.toggle('d-on', on);
      if (on) {
        a.setAttribute('aria-current', 'true');
        var wrap = a.parentNode;
        if (wrap.scrollWidth > wrap.clientWidth + 2) wrap.scrollTo({ left: a.offsetLeft - (wrap.clientWidth - a.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
      } else {
        a.removeAttribute('aria-current');
      }
    });
  }
  function requestSpy() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(spy);
    }
  }
  window.addEventListener('scroll', requestSpy, { passive: true });
  window.addEventListener('resize', function () { setVars(); requestSpy(); });
  window.addEventListener('load', function () { setVars(); spy(); });
  setVars();
  spy();
  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  // --- County checker (home page) ------------------------------------------------------------------
  var county = document.querySelector('[data-county-check]');
  var countyOut = document.getElementById('county-result');
  if (county && countyOut) {
    var served = ['Anne Arundel', 'Baltimore City', 'Baltimore', 'Calvert', 'Charles', 'Harford', 'Howard', 'Montgomery', 'Prince George’s', 'St. Mary’s'];
    var base = countyOut.innerHTML;
    var phone = county.getAttribute('data-phone');
    var tel = county.getAttribute('data-tel');
    var call = function () {
      var a = document.createElement('a');
      a.href = tel;
      a.textContent = phone;
      return a;
    };
    county.addEventListener('change', function () {
      var v = county.value;
      countyOut.className = 'd-county-result';
      if (!v) {
        countyOut.innerHTML = base;
        return;
      }
      countyOut.textContent = '';
      if (served.indexOf(v) > -1) {
        countyOut.className = 'd-county-result d-yes';
        var ask = document.createElement('a');
        ask.href = '/request-services';
        ask.textContent = 'Ask about services';
        countyOut.append('Yes, we serve ' + v + (v === 'Baltimore City' ? '' : ' County') + '. ', ask, ' or call ', call(), '.');
      } else {
        countyOut.className = 'd-county-result d-maybe';
        countyOut.append('That area is outside our listed service area. Call ', call(), ' and we will talk it through.');
      }
    });
  }

  // --- Three-step forms --------------------------------------------------------------------------
  document.querySelectorAll('form[data-wizard]').forEach(function (form) {
    var steps = [].slice.call(form.querySelectorAll('.d-step'));
    if (steps.length < 2) return;
    var dots = [].slice.call(form.querySelectorAll('.d-wiz-progress li'));
    var back = form.querySelector('.d-wiz-back');
    var next = form.querySelector('.d-wiz-next');
    var submit = form.querySelector('.d-wiz-submit');
    var last = steps.length - 1;
    var cur = 0;
    form.classList.add('d-js');

    function labelFor(field) {
      var group = field.closest('[role="group"]');
      if (group && (field.type === 'checkbox' || field.type === 'radio')) {
        var g = document.getElementById(group.getAttribute('aria-labelledby'));
        if (g) return g.textContent.trim();
      }
      var l = field.id && form.querySelector('label[for="' + field.id + '"]');
      return l ? l.textContent.replace('*', '').trim() : field.name;
    }
    function review() {
      var dl = form.querySelector('.d-review');
      if (!dl) return;
      var rows = {};
      var order = [];
      steps.slice(0, last).forEach(function (step) {
        step.querySelectorAll('input, select, textarea').forEach(function (f) {
          if (!f.name || f.type === 'hidden' || f.disabled || f.closest('[aria-hidden="true"]')) return;
          var value = '';
          if (f.type === 'checkbox' || f.type === 'radio') {
            if (!f.checked) return;
            var lab = f.closest('label');
            value = lab ? lab.textContent.trim() : f.value;
          } else if (f.tagName === 'SELECT') {
            value = f.value ? f.options[f.selectedIndex].text : '';
          } else {
            value = f.value.trim();
          }
          if (!value) return;
          var key = labelFor(f);
          if (!rows[key]) {
            rows[key] = [];
            order.push(key);
          }
          rows[key].push(value);
        });
      });
      dl.textContent = '';
      order.forEach(function (key) {
        var row = document.createElement('div');
        var dt = document.createElement('dt');
        var dd = document.createElement('dd');
        dt.textContent = key;
        dd.textContent = rows[key].join(', ');
        row.append(dt, dd);
        dl.appendChild(row);
      });
    }
    function show(n, focus) {
      cur = n;
      steps.forEach(function (s, i) {
        s.hidden = i !== n;
        s.classList.remove('d-enter');
        if (i === n) {
          void s.offsetWidth;
          s.classList.add('d-enter');
        }
      });
      dots.forEach(function (d, i) {
        d.classList.toggle('d-done', i < n);
        d.classList.toggle('d-active', i === n);
        if (i === n) d.setAttribute('aria-current', 'step');
        else d.removeAttribute('aria-current');
      });
      back.hidden = n === 0;
      next.hidden = n === last;
      submit.hidden = n !== last;
      if (n === last) review();
      if (focus) {
        form.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        var f = steps[n].querySelector('input:not([type=hidden]), select, textarea');
        if (f && n !== last) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }, 250);
      }
    }
    function stepValid() {
      var fields = steps[cur].querySelectorAll('input, select, textarea');
      for (var i = 0; i < fields.length; i++) {
        if (!fields[i].checkValidity()) {
          fields[i].reportValidity();
          return false;
        }
      }
      return true;
    }
    next.addEventListener('click', function () { if (stepValid()) show(cur + 1, true); });
    back.addEventListener('click', function () { show(cur - 1, true); });
    // Enter on an early step moves on instead of sending.
    form.addEventListener('submit', function (e) {
      if (cur < last) {
        e.preventDefault();
        if (stepValid()) show(cur + 1, true);
      } else if (!stepValid()) {
        e.preventDefault();
      }
    });
    // After the server found a problem, open the step with the first one.
    var start = 0;
    var firstError = form.querySelector('[aria-invalid="true"]');
    if (firstError) steps.forEach(function (s, i) { if (s.contains(firstError)) start = i; });
    show(start, false);
    if (firstError) setTimeout(function () { firstError.focus(); }, 50);
  });

  // Careers: an old job link (#job-…) opens that job's details; "Apply for this job" picks it in the form.
  var jobFromHash = location.hash.match(/^#job-([\w-]+)$/);
  if (jobFromHash) {
    var jobItem = document.getElementById('job-' + jobFromHash[1]);
    var jobDetails = jobItem && jobItem.querySelector('details');
    if (jobDetails) jobDetails.open = true;
  }
  var jobSelect = document.getElementById('jb-job');
  document.querySelectorAll('[data-apply-job]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (!jobSelect) return;
      e.preventDefault();
      jobSelect.value = a.getAttribute('data-apply-job');
      var form = document.getElementById('apply');
      form.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      var first = document.getElementById('jb-first_name');
      if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (err) { first.focus(); } }, 300);
    });
  });

  // Ask about services: "Best time to call" only when they prefer a call.
  document.querySelectorAll('[data-call-only]').forEach(function (box) {
    var form = box.closest('form');
    var radios = form ? [].slice.call(form.querySelectorAll('input[name="preferred_contact"]')) : [];
    function sync() {
      var email = radios.some(function (r) { return r.checked && r.value === 'email'; });
      box.hidden = email;
      box.querySelectorAll('select, input').forEach(function (f) { f.disabled = email; });
    }
    radios.forEach(function (r) { r.addEventListener('change', sync); });
    sync();
  });

  // The success panel's tick draws itself.
  var success = document.querySelector('.d-success:not([hidden])');
  if (success) requestAnimationFrame(function () { success.classList.add('d-play'); });
})();
