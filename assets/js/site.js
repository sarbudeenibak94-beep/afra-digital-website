/* ==============================================================
   AFRA DIGITAL — site script
   Consolidated from the previous inline <script> blocks (Phase 02) so the
   page can run under a strict Content-Security-Policy (script-src 'self').
   ============================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  root.classList.add('js');
  if (finePointer) root.classList.add('fine-pointer');

  /* Analytics: events go through assets/js/analytics.js (consent-aware, allow-listed,
     PII-filtered). Link/CTA clicks are tracked there for every page; this file only
     reports contact-form events. Never pass personal data as parameters. */
  function track(event, params) {
    if (typeof window.afraTrack === 'function') window.afraTrack(event, params);
  }

  /* ---------- PREMIUM CURSOR (decorative, fine pointers only; native cursor stays visible) ---------- */
  (function () {
    var cur = doc.getElementById('cursor');
    var ring = doc.getElementById('cursor-ring');
    if (!cur || !ring) return;
    if (!finePointer || reduceMotion) { cur.remove(); ring.remove(); return; }
    var mouseX = 0, mouseY = 0, ringX = 0, ringY = 0, running = false, shown = false;
    function loop() {
      ringX += (mouseX - ringX) * 0.45;
      ringY += (mouseY - ringY) * 0.45;
      ring.style.transform = 'translate(' + ringX + 'px,' + ringY + 'px) translate(-50%,-50%)';
      if (Math.abs(mouseX - ringX) > 0.3 || Math.abs(mouseY - ringY) > 0.3) requestAnimationFrame(loop);
      else running = false;
    }
    doc.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      mouseX = e.clientX; mouseY = e.clientY;
      if (!shown) { shown = true; ringX = mouseX; ringY = mouseY; root.classList.add('cursor-on'); }
      cur.style.transform = 'translate(' + mouseX + 'px,' + mouseY + 'px) translate(-50%,-50%)';
      if (!running) { running = true; requestAnimationFrame(loop); }
    }, { passive: true });
    doc.addEventListener('mouseleave', function () { root.classList.remove('cursor-on'); shown = false; });
  })();

  /* ---------- LOADER — brief brand intro that never waits for images ---------- */
  (function () {
    var loader = doc.getElementById('loader');
    if (!loader) return;
    function hide() {
      if (!loader.parentNode) return;
      loader.classList.add('hidden');
      setTimeout(function () { if (loader.parentNode) loader.parentNode.removeChild(loader); }, 700);
    }
    // This script is deferred, so the DOM is already parsed here. The loader has already shown the
    // brand while CSS/fonts loaded; hide it straight away (it fades out) instead of waiting for images.
    hide();
  })();

  /* ---------- HERO CANVAS — interactive constellation ---------- */
  (function () {
    var cv = doc.getElementById('hero-canvas');
    var hero = doc.getElementById('hero');
    if (!cv || !hero || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    var W, H, nodes = [], mouse = { x: -999, y: -999 }, visible = true, rafId = 0;
    var LINK = 160, MOUSE_R = 180;
    function count() { return Math.round(Math.min(60, Math.max(24, (W * H) / 22000))); }
    function resize() { W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight; }
    function makeNode() { return { x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, r: Math.random() * 1.6 + 0.5 }; }
    function init() { nodes = []; for (var i = 0, n = count(); i < n; i++) nodes.push(makeNode()); }
    function frame(move) {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (move) {
          n.x += n.vx; n.y += n.vy;
          if (n.x < 0 || n.x > W) n.vx *= -1;
          if (n.y < 0 || n.y > H) n.vy *= -1;
          var dx = mouse.x - n.x, dy = mouse.y - n.y;
          if (dx * dx + dy * dy < MOUSE_R * MOUSE_R) { n.x += dx * 0.003; n.y += dy * 0.003; }
        }
      }
      for (var a = 0; a < nodes.length; a++) {
        for (var b = a + 1; b < nodes.length; b++) {
          var ex = nodes[a].x - nodes[b].x, ey = nodes[a].y - nodes[b].y, d2 = ex * ex + ey * ey;
          if (d2 < LINK * LINK) {
            var d = Math.sqrt(d2);
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(212,175,55,' + ((1 - d / LINK) * 0.2) + ')';
            ctx.lineWidth = 0.7;
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);
            ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(nodes[a].x, nodes[a].y, nodes[a].r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(212,175,55,0.5)';
        ctx.fill();
      }
    }
    function loop() { if (!visible) { rafId = 0; return; } frame(true); rafId = requestAnimationFrame(loop); }
    function start() { if (!rafId && !reduceMotion) rafId = requestAnimationFrame(loop); }
    resize(); init();
    if (reduceMotion) frame(false); else start();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); }, { threshold: 0 }).observe(hero);
    }
    if (finePointer) {
      hero.addEventListener('mousemove', function (e) { var r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
      hero.addEventListener('mouseleave', function () { mouse.x = -999; mouse.y = -999; });
    }
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { resize(); init(); if (reduceMotion) frame(false); }, 150); });
  })();

  /* ---------- NAV SCROLL ---------- */
  var nav = doc.getElementById('nav');
  var ngc = doc.getElementById('nav-ghost-cta');
  function onScroll() {
    var s = window.scrollY > 50;
    nav.classList.toggle('scrolled', s);
    if (ngc) ngc.style.display = (s && window.innerWidth > 1180) ? 'inline-flex' : 'none';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- MOBILE NAV (accessible) ---------- */
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
  if (hb && mn) {
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

  /* ---------- REVEAL ---------- */
  var obs = null;
  var revealEls = doc.querySelectorAll('[rv]');
  if (!('IntersectionObserver' in window) || reduceMotion) {
    for (var ri = 0; ri < revealEls.length; ri++) revealEls[ri].classList.add('on');
  } else {
    obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('on'); obs.unobserve(e.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    for (var rj = 0; rj < revealEls.length; rj++) obs.observe(revealEls[rj]);
  }

  /* ---------- COUNTERS (any [data-count]) ---------- */
  function animCount(el, target, dur) {
    if (reduceMotion) { el.textContent = target; return; }
    var s = null;
    function step(ts) { if (!s) s = ts; var p = Math.min((ts - s) / dur, 1); el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target); if (p < 1) requestAnimationFrame(step); else el.textContent = target; }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting && e.target.dataset.count) { animCount(e.target, parseInt(e.target.dataset.count, 10), 2000); co.unobserve(e.target); } });
    }, { threshold: 0.5 });
    doc.querySelectorAll('[data-count]').forEach(function (el) { co.observe(el); });
  }

  /* ---------- MAGNETIC BUTTONS (mouse only) ---------- */
  if (finePointer && !reduceMotion) {
    doc.querySelectorAll('.btn-prime').forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) { var r = btn.getBoundingClientRect(); var x = (e.clientX - r.left - r.width / 2) * 0.1; var y = (e.clientY - r.top - r.height / 2) * 0.1; btn.style.transform = 'translate(' + x + 'px,' + y + 'px) translateY(-3px)'; });
      btn.addEventListener('mouseleave', function () { btn.style.transform = ''; });
    });
  }

  /* ---------- FAQ (buttons with aria-expanded) ---------- */
  var faqItems = doc.querySelectorAll('.faq-item');
  function setFaq(item, open) {
    var btn = item.querySelector('.faq-q'), panel = item.querySelector('.faq-a');
    item.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    panel.style.maxHeight = open ? (panel.scrollHeight + 'px') : '';
  }
  faqItems.forEach(function (item) {
    var btn = item.querySelector('.faq-q');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var willOpen = !item.classList.contains('open');
      faqItems.forEach(function (i) { if (i !== item) setFaq(i, false); });
      setFaq(item, willOpen);
    });
  });
  window.addEventListener('resize', function () {
    faqItems.forEach(function (i) { if (i.classList.contains('open')) { var p = i.querySelector('.faq-a'); p.style.maxHeight = p.scrollHeight + 'px'; } });
  });

  /* ---------- SMOOTH IN-PAGE SCROLL (guards invalid selectors, moves focus) ---------- */
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (!id) return;
    var t = doc.getElementById(id);
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    // No history.replaceState here: changing the URL on every in-page jump could be
    // counted as extra page views by analytics (Phase 03).
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true });
  });

  /* ---------- SERVICE / PRODUCT CTAs pre-select the enquiry type ---------- */
  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-service]');
    if (!a) return;
    var sel = doc.getElementById('cf-service');
    if (!sel) return;
    var want = a.getAttribute('data-service');
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === want) { sel.value = want; break; }
  });

  /* ---------- CONTACT FORM — real submission, honest states ---------- */
  (function () {
    var form = doc.getElementById('contact-form');
    if (!form || !window.fetch) return; // without fetch the form posts natively to /api/contact
    var btn = doc.getElementById('form-btn');
    var btnLabel = btn.querySelector('.btn-label');
    var success = doc.getElementById('form-success');
    var errBox = doc.getElementById('form-error');
    var errMsg = doc.getElementById('form-error-msg');
    var elapsedInput = doc.getElementById('cf-elapsed');
    var shownAt = Date.now();
    var submitting = false, started = false;
    var FIELD_MSG = {
      firstName: { required: 'Please enter your first name.', too_long: 'First name is too long.', invalid: 'Please enter a valid first name.' },
      lastName: { required: 'Please enter your last name.', too_long: 'Last name is too long.', invalid: 'Please enter a valid last name.' },
      email: { required: 'Please enter your email address.', too_long: 'Email address is too long.', invalid: 'Please enter a valid email address, e.g. name@company.com.' },
      phone: { too_long: 'Phone number is too long.', invalid: 'Please enter a valid phone number, e.g. +974 1234 5678.' },
      company: { too_long: 'Company name is too long (max 120 characters).', invalid: 'Please check the company name.' },
      service: { invalid: 'Please choose a service from the list.' },
      message: { too_long: 'Please keep your brief under 5,000 characters.', invalid: 'Please check your project brief.' },
    };
    var GENERIC = 'Sorry, your message could not be sent right now. Please contact us on WhatsApp or by email.';
    var FIELDS = ['firstName', 'lastName', 'email', 'phone', 'company', 'service', 'message'];

    form.addEventListener('focusin', function () { if (!started) { started = true; track('contact_form_start', { form_id: 'contact' }); } });

    function fieldEl(name) { return form.elements[name]; }
    function setFieldError(name, code) {
      var el = fieldEl(name); if (!el) return;
      var out = doc.getElementById(el.id + '-err');
      var msg = code ? ((FIELD_MSG[name] && FIELD_MSG[name][code]) || 'Please check this field.') : '';
      if (code) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      if (out) { out.textContent = msg; out.hidden = !code; }
    }
    function clearErrors() { FIELDS.forEach(function (f) { setFieldError(f, null); }); errBox.hidden = true; errMsg.textContent = ''; }
    function showFormError(msg) { errMsg.textContent = msg || GENERIC; errBox.hidden = false; }
    function setLoading(on) {
      submitting = on; btn.disabled = on; form.setAttribute('aria-busy', on ? 'true' : 'false');
      btnLabel.textContent = on ? 'Sending…' : 'Send Message →';
    }

    var EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
    function clientValidate(d) {
      var f = {};
      if (!d.firstName) f.firstName = 'required'; else if (!/\p{L}/u.test(d.firstName)) f.firstName = 'invalid';
      if (!d.lastName) f.lastName = 'required'; else if (!/\p{L}/u.test(d.lastName)) f.lastName = 'invalid';
      if (!d.email) f.email = 'required'; else if (!EMAIL_RE.test(d.email)) f.email = 'invalid';
      if (d.phone) { var digits = d.phone.replace(/\D/g, '').length; if (!/^\+?[0-9 ().-]{6,30}$/.test(d.phone) || digits < 6 || digits > 15) f.phone = 'invalid'; }
      if (d.company.length > 120) f.company = 'too_long';
      if (d.message.length > 5000) f.message = 'too_long';
      return f;
    }

    // Live re-validation clears an error as soon as it is fixed.
    form.addEventListener('input', function (e) {
      var name = e.target.name;
      if (FIELDS.indexOf(name) === -1 || e.target.getAttribute('aria-invalid') !== 'true') return;
      var d = collect(); var f = clientValidate(d);
      setFieldError(name, f[name] || null);
    });

    function collect() {
      var d = {};
      FIELDS.forEach(function (n) { var el = fieldEl(n); d[n] = el ? String(el.value || '').trim() : ''; });
      return d;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitting) return;
      clearErrors();
      var d = collect();
      var errs = clientValidate(d);
      var names = Object.keys(errs);
      if (names.length) {
        names.forEach(function (n) { setFieldError(n, errs[n]); });
        fieldEl(names[0]).focus();
        track('form_error', { form_id: 'contact', error_code: 'client_validation' });
        return;
      }
      var payload = {};
      for (var k in d) payload[k] = d[k];
      payload.hp = fieldEl('hp') ? fieldEl('hp').value : '';
      payload.elapsed = Date.now() - shownAt;
      if (elapsedInput) elapsedInput.value = String(payload.elapsed);

      setLoading(true);
      track('form_submit_attempt', { form_id: 'contact' });
      var controller = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (controller) controller.abort(); }, 20000);

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
        credentials: 'same-origin',
      }).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) { return { status: res.status, body: body }; });
      }).then(function (r) {
        clearTimeout(timer);
        setLoading(false);
        if (r.status === 200 && r.body && r.body.ok === true) {
          form.hidden = true;
          success.hidden = false;
          success.focus();
          if (!r.body.duplicate) track('generate_lead', { form_id: 'contact', method: 'contact_form', service: d.service || 'unspecified' });
          return;
        }
        var code = (r.body && r.body.error) || ('http_' + r.status);
        if (r.body && r.body.fields) {
          var first = null;
          Object.keys(r.body.fields).forEach(function (n) { setFieldError(n, r.body.fields[n]); if (!first) first = n; });
          showFormError(r.body.message);
          if (first && fieldEl(first)) fieldEl(first).focus();
        } else {
          showFormError((r.body && r.body.message) || GENERIC);
          errBox.focus();
        }
        track('form_error', { form_id: 'contact', error_code: String(code) });
      }).catch(function (err) {
        clearTimeout(timer);
        setLoading(false);
        var aborted = err && err.name === 'AbortError';
        showFormError(aborted
          ? 'Sending is taking too long and your message may not have been delivered. Please contact us on WhatsApp or by email.'
          : 'We could not reach our server. Please check your connection, or contact us on WhatsApp or by email.');
        errBox.focus();
        track('form_error', { form_id: 'contact', error_code: aborted ? 'client_timeout' : 'network' });
      });
    });
  })();

  /* ==============================================================
     SOFTWARE PRODUCTS — dashboards, particles, parallax
     ============================================================== */
  function onceVisible(el, threshold, cb) {
    if (!el) return;
    if (!('IntersectionObserver' in window)) { cb(); return; }
    var o = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { o.disconnect(); cb(); } }, { threshold: threshold });
    o.observe(el);
  }
  function whileVisible(el, onChange) {
    if (!el || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (en) { onChange(en[0].isIntersecting); }, { threshold: 0 }).observe(el);
  }
  function randomBetween(a, b) { return Math.floor(Math.random() * (b - a + 1) + a); }
  function formatQAR(n) { return 'QAR ' + (n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n); }
  function flash(el) { el.classList.add('sp-flash'); setTimeout(function () { el.classList.remove('sp-flash'); }, 400); }

  /* Illustrative demo dashboards (clearly labelled "DEMO" in the markup). */
  function demoDashboard(dashId, init, tick, interval) {
    var dash = doc.getElementById(dashId);
    if (!dash) return;
    onceVisible(dash, 0.3, function () {
      var state = init();
      if (reduceMotion) return;
      var timer = null;
      function run(on) { if (on && !timer) timer = setInterval(function () { tick(state); }, interval); else if (!on && timer) { clearInterval(timer); timer = null; } }
      run(true);
      whileVisible(dash, run);
    });
  }
  var cwfRev = doc.getElementById('cwf-rev'), cwfOrd = doc.getElementById('cwf-orders'), cwfTab = doc.getElementById('cwf-tables');
  demoDashboard('cwf-dash', function () {
    var s = { rev: 8400, orders: 38, tables: 12 };
    if (cwfRev) cwfRev.textContent = formatQAR(s.rev); if (cwfOrd) cwfOrd.textContent = s.orders; if (cwfTab) cwfTab.textContent = s.tables;
    return s;
  }, function (s) {
    s.rev += randomBetween(80, 320); s.orders += randomBetween(0, 2); s.tables = randomBetween(8, 18);
    if (cwfRev) { cwfRev.textContent = formatQAR(s.rev); flash(cwfRev); }
    if (cwfOrd) cwfOrd.textContent = s.orders; if (cwfTab) cwfTab.textContent = s.tables;
  }, 2600);

  var snxRev = doc.getElementById('snx-rev'), snxSto = doc.getElementById('snx-stores'), snxLoy = doc.getElementById('snx-loyalty');
  demoDashboard('saanix-dash', function () {
    var s = { gmv: 48200, stores: 3, members: 840 };
    if (snxRev) snxRev.textContent = formatQAR(s.gmv); if (snxSto) snxSto.textContent = s.stores; if (snxLoy) snxLoy.textContent = s.members;
    return s;
  }, function (s) {
    s.gmv += randomBetween(200, 900); s.members += randomBetween(1, 5);
    if (snxRev) { snxRev.textContent = formatQAR(s.gmv); flash(snxRev); }
    if (snxLoy) snxLoy.textContent = s.members;
  }, 3100);

  /* Bar chart grows in on scroll */
  (function () {
    var barsEl = doc.getElementById('cwf-bars');
    if (!barsEl) return;
    var bars = barsEl.querySelectorAll('.sp-bar');
    if (reduceMotion) { bars.forEach(function (b) { b.style.height = b.style.getPropertyValue('--bh') || '50%'; }); return; }
    bars.forEach(function (b) { b.style.height = '0'; });
    onceVisible(barsEl, 0.4, function () {
      bars.forEach(function (b, i) { setTimeout(function () { b.style.height = b.style.getPropertyValue('--bh') || '50%'; }, i * 60); });
    });
  })();

  /* AI copilot typing animation */
  (function () {
    var typingEl = doc.getElementById('sp-ai-typing');
    var dash = doc.getElementById('saanix-dash');
    if (!typingEl || reduceMotion) return;
    var messages = [
      'Analysing inventory gaps across 3 branches...',
      'Generating weekly performance report...',
      'WhatsApp campaign sent to 2,440 customers.',
      'Low stock alert: Perfume SKU-044 needs reorder.',
      'Revenue forecast: +18% growth expected this month.',
      'Loyalty points distributed to 840 members.',
    ];
    var idx = 0, visible = true, pending = false;
    function typeMessage(text) {
      typingEl.textContent = '';
      var i = 0;
      var timer = setInterval(function () {
        typingEl.textContent += text[i]; i++;
        if (i >= text.length) { clearInterval(timer); setTimeout(next, 2800); }
      }, 38);
    }
    function next() { if (!visible) { pending = true; return; } idx = (idx + 1) % messages.length; typeMessage(messages[idx]); }
    onceVisible(dash, 0.3, function () { setTimeout(function () { typeMessage(messages[0]); }, 600); });
    whileVisible(dash, function (on) { visible = on; if (on && pending) { pending = false; next(); } });
  })();

  /* Flash + ripple keyframes (injected once) */
  if (!doc.getElementById('sp-flash-style')) {
    var st = doc.createElement('style');
    st.id = 'sp-flash-style';
    st.textContent = '@keyframes spFlash{0%{opacity:1;}40%{opacity:0.3;}100%{opacity:1;}}.sp-flash{animation:spFlash 0.4s var(--ease);}@keyframes spRipple{to{transform:scale(80);opacity:0;}}';
    doc.head.appendChild(st);
  }

  /* Touch feedback for feature chips */
  doc.querySelectorAll('.sp-feat').forEach(function (el) {
    el.addEventListener('touchstart', function () { el.style.background = 'var(--gold-dim)'; }, { passive: true });
    el.addEventListener('touchend', function () { setTimeout(function () { el.style.background = ''; }, 300); }, { passive: true });
  });

  /* Floating particles behind the products section (paused when off-screen) */
  (function () {
    var canvas = doc.getElementById('sp-particles-canvas');
    var section = doc.getElementById('software-products');
    if (!canvas || !section || !canvas.getContext || reduceMotion) return;
    var ctx = canvas.getContext('2d');
    var particles = [], visible = false, rafId = 0;
    var COUNT = window.innerWidth < 768 ? 30 : 55;
    function resizeCanvas() { canvas.width = section.offsetWidth; canvas.height = section.offsetHeight; }
    resizeCanvas();
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resizeCanvas, 200); });
    for (var i = 0; i < COUNT; i++) {
      particles.push({ x: Math.random() * (canvas.width || 1200), y: Math.random() * (canvas.height || 3000), r: Math.random() * 1.4 + 0.4, vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.22, alpha: Math.random() * 0.4 + 0.08 });
    }
    function draw() {
      if (!visible) { rafId = 0; return; }
      var W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      for (var a = 0; a < particles.length; a++) {
        var p = particles[a];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      }
      for (var b = 0; b < particles.length; b++) {
        var q = particles[b];
        for (var c = b + 1; c < particles.length; c++) {
          var r = particles[c], dx = q.x - r.x, dy = q.y - r.y, d2 = dx * dx + dy * dy;
          if (d2 < 12100) {
            var dist = Math.sqrt(d2);
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(212,175,55,' + (0.08 * (1 - dist / 110)) + ')';
            ctx.lineWidth = 0.5;
            ctx.moveTo(q.x, q.y); ctx.lineTo(r.x, r.y); ctx.stroke();
          }
        }
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(212,175,55,' + q.alpha + ')';
        ctx.fill();
      }
      rafId = requestAnimationFrame(draw);
    }
    whileVisible(section, function (on) { visible = on; if (on && !rafId) rafId = requestAnimationFrame(draw); });
  })();

  /* Mouse parallax on product visuals */
  if (finePointer && !reduceMotion) {
    doc.querySelectorAll('#software-products .sp-product-block').forEach(function (block) {
      var visual = block.querySelector('.sp-product-visual');
      if (!visual) return;
      block.addEventListener('mousemove', function (e) {
        var rect = block.getBoundingClientRect();
        var dx = (e.clientX - (rect.left + rect.width / 2)) / rect.width;
        var dy = (e.clientY - (rect.top + rect.height / 2)) / rect.height;
        visual.style.transform = 'translate(' + (-dx * 8) + 'px,' + (-dy * 6) + 'px) perspective(800px) rotateY(' + (dx * 3) + 'deg) rotateX(' + (-dy * 2) + 'deg)';
      });
      block.addEventListener('mouseleave', function () { visual.style.transform = ''; });
    });
  }

  /* Why-card stagger */
  doc.querySelectorAll('.sp-why-card').forEach(function (card, idx) { card.style.animationDelay = (idx * 0.07) + 's'; });

  /* CTA ripple */
  doc.querySelectorAll('.sp-cta-box .btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      if (reduceMotion) return;
      var rect = btn.getBoundingClientRect();
      var ripple = doc.createElement('span');
      ripple.style.cssText = 'position:absolute;border-radius:50%;background:rgba(255,255,255,0.25);pointer-events:none;width:5px;height:5px;' +
        'left:' + (e.clientX - rect.left - 2.5) + 'px;top:' + (e.clientY - rect.top - 2.5) + 'px;transform:scale(1);animation:spRipple 0.6s ease-out forwards;';
      btn.style.position = 'relative'; btn.style.overflow = 'hidden';
      btn.appendChild(ripple);
      setTimeout(function () { ripple.remove(); }, 650);
    });
  });

  /* Section entrance */
  onceVisible(doc.getElementById('software-products'), 0.08, function () { doc.getElementById('software-products').classList.add('sp-section-entered'); });
})();
