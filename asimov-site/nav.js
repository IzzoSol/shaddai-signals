/* Newsstand header behaviour: measured --stand-h, More menu, mobile drawer, current-section highlight.
   Plain script, no dependencies. Every control keeps working without it (links are real hrefs). */
(function () {
  var stand = document.querySelector('.stand');
  if (!stand) return;
  var root = document.documentElement;

  // ── --stand-h: anchor jumps land just below the sticky bar at every width ──
  function measure() { root.style.setProperty('--stand-h', Math.round(stand.getBoundingClientRect().height) + 'px'); }
  measure();
  if (window.ResizeObserver) new ResizeObserver(measure).observe(stand); else window.addEventListener('resize', measure);

  // ── More menu ──
  var moreBtn = stand.querySelector('.more-btn'), moreMenu = document.getElementById('more-menu');
  function setMore(on) { if (!moreBtn) return; moreMenu.hidden = !on; moreBtn.setAttribute('aria-expanded', on ? 'true' : 'false'); }
  if (moreBtn) {
    moreBtn.addEventListener('click', function (e) { e.stopPropagation(); setMore(moreMenu.hidden); if (!moreMenu.hidden) { var f = moreMenu.querySelector('a'); if (f) f.focus(); } });
    moreMenu.addEventListener('click', function (e) { if (e.target.closest('a')) setMore(false); });
    document.addEventListener('click', function (e) { if (!e.target.closest('.more')) setMore(false); });
  }

  // ── Drawer ──
  var burger = stand.querySelector('.burger'), drawer = document.getElementById('drawer');
  var lastFocus = null;
  function setDrawer(on) {
    if (!drawer || !burger) return;
    drawer.hidden = !on;
    burger.setAttribute('aria-expanded', on ? 'true' : 'false');
    burger.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('drawer-open', on);
    if (on) { lastFocus = document.activeElement; var f = drawer.querySelector('.drawer-x'); if (f) f.focus(); }
    else if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  if (burger && drawer) {
    // themes live in the drawer on the narrowest phones: a mirror that clicks the real buttons
    var ts = stand.querySelector('.theme-switch');
    if (ts) {
      var mirror = ts.cloneNode(true); mirror.removeAttribute('id');
      mirror.querySelectorAll('[data-theme-set]').forEach(function (b) {
        b.addEventListener('click', function () { var real = ts.querySelector('[data-theme-set="' + b.getAttribute('data-theme-set') + '"]'); if (real) real.click(); syncMirror(); });
      });
      drawer.querySelector('.drawer-panel').appendChild(mirror);
      var syncMirror = function () { var cur = root.dataset.theme; mirror.querySelectorAll('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-checked', b.getAttribute('data-theme-set') === cur ? 'true' : 'false'); }); };
      syncMirror();
    }
    burger.addEventListener('click', function () { setDrawer(drawer.hidden); });
    drawer.addEventListener('click', function (e) { if (e.target.closest('[data-close]') || e.target.closest('a[href]')) setDrawer(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { setDrawer(false); setMore(false); }
      if (e.key === 'Tab' && !drawer.hidden) {             // keep focus inside the open drawer
        var f = drawer.querySelectorAll('a[href],button'), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    window.matchMedia('(min-width: 901px)').addEventListener('change', function (m) { if (m.matches) setDrawer(false); });
  }

  // ── Current section: underline the matching top-level link ──
  var links = [].slice.call(stand.querySelectorAll('.stand-nav > a[href^="#"]'));
  var map = {}; links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var a = map[e.target.id]; if (!a) return;
        if (e.isIntersecting) { links.forEach(function (l) { l.removeAttribute('aria-current'); }); a.setAttribute('aria-current', 'true'); }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
  }
})();
