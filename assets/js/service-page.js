/* ==============================================================
   AFRA DIGITAL — service page script (Phase 05)
   Header and mobile menu behaviour for /services/* pages, matching the
   homepage (assets/js/site.js) without any of the homepage-only effects
   (loader, hero canvas, product dashboards). Every element is optional.
   The enquiry form is handled by assets/js/contact-form.js.
   ============================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('js');

  /* ---------- NAV SCROLL ---------- */
  var nav = doc.getElementById('nav');
  var ngc = doc.getElementById('nav-ghost-cta');
  function onScroll() {
    if (!nav) return;
    var s = window.scrollY > 50;
    nav.classList.toggle('scrolled', s);
    if (ngc) ngc.style.display = (s && window.innerWidth > 1180) ? 'inline-flex' : 'none';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- MOBILE NAV (accessible: focus trap, Escape, focus return) ---------- */
  var hb = doc.getElementById('hamburger');
  var mn = doc.getElementById('mob-nav');
  var menuOpen = false;
  function visibleFocusables() {
    var list = [].slice.call(nav.querySelectorAll('a[href],button')).concat([].slice.call(mn.querySelectorAll('a[href]')));
    return list.filter(function (el) { return el.offsetWidth > 0 || el.offsetHeight > 0; });
  }
  function setMenu(open, returnFocus) {
    menuOpen = open;
    mn.classList.toggle('open', open);
    hb.setAttribute('aria-expanded', open ? 'true' : 'false');
    hb.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    mn.setAttribute('aria-hidden', open ? 'false' : 'true');
    doc.body.classList.toggle('menu-open', open);
    if (open) { var first = mn.querySelector('a'); if (first) requestAnimationFrame(function () { first.focus(); }); }
    else if (returnFocus) hb.focus();
  }
  if (nav && hb && mn) {
    hb.addEventListener('click', function () { setMenu(!menuOpen, true); });
    mn.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false, false); });
    doc.addEventListener('keydown', function (e) {
      if (!menuOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); setMenu(false, true); return; }
      if (e.key === 'Tab') {
        var f = visibleFocusables(); if (!f.length) return;
        var i = f.indexOf(doc.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    window.addEventListener('resize', function () { if (menuOpen && window.innerWidth > 1024) setMenu(false, false); });
  }

  /* ---------- SMOOTH IN-PAGE SCROLL (same-page anchors only; moves focus) ---------- */
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    var t = doc.getElementById(id);
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    // No history.replaceState: changing the URL on in-page jumps could count as extra page views.
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true });
  });
})();
