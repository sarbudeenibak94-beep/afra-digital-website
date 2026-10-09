/* ==============================================================
   AFRA DIGITAL — consent, analytics & privacy-safe event tracking
   (Phase 03). One first-party file, loaded with `defer` on every page.

   Guarantees:
   - Nothing is loaded from Google/Vercel and no measurement request is
     made until the visitor clicks "Accept". Visitors who reject trigger
     no analytics network activity at all (not even the config lookup).
   - Which tools exist is decided server-side (/api/analytics-config,
     from Vercel env vars). No tool configured = no banner, nothing loads.
   - Events use fixed names and allow-listed parameters; values that
     look like email addresses or phone numbers are dropped.
   - GA4 runs with Google signals and ad personalisation disabled and
     receives a cleaned page URL (path + vetted UTM tags only).
   ============================================================== */
(function () {
  'use strict';
  if (window.afraAnalytics) return; // never initialise twice

  var doc = document;
  var STORAGE_KEY = 'afra_consent_v1';
  var CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // ask again after 12 months
  var CONFIG_URL = '/api/analytics-config';
  var GA4_ID_RE = /^G-[A-Z0-9]{4,16}$/;
  var EVENTS = {
    contact_form_start: 1, generate_lead: 1, whatsapp_click: 1, phone_click: 1, email_click: 1,
    service_cta_click: 1, cta_click: 1, form_submit_attempt: 1, form_error: 1,
  };
  var PARAMS = { link_location: 1, service: 1, plan: 1, cta_id: 1, form_id: 1, method: 1, error_code: 1 };
  var SAFE_VALUE = /^[A-Za-z0-9 _\-\/().&]{1,60}$/;
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id'];

  var state = { consent: readConsent(), config: null, configPromise: null, gaActive: false, gaId: null, siActive: false };
  window.afraEvents = window.afraEvents || []; // in-memory event log (debug/tests); never transmitted by itself

  /* ---------- consent storage (strictly necessary: remembers the choice) ---------- */
  function readConsent() {
    try {
      var c = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!c || c.v !== 1 || typeof c.analytics !== 'boolean' || typeof c.ts !== 'number') return null;
      if (Date.now() - c.ts > CONSENT_MAX_AGE_MS) return null;
      return c;
    } catch (e) { return null; }
  }
  function writeConsent(granted) {
    var c = { v: 1, analytics: !!granted, ts: Date.now() };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch (e) { /* private mode: choice lasts for this page */ }
    state.consent = c;
  }

  /* ---------- privacy filters ---------- */
  function looksPersonal(v) { return v.indexOf('@') !== -1 || v.replace(/\D/g, '').length >= 7; }
  function sanitizeParams(params) {
    var out = {};
    if (!params) return out;
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k) || !PARAMS[k] || typeof params[k] !== 'string') continue;
      var v = params[k].trim().slice(0, 60);
      if (v && SAFE_VALUE.test(v) && !looksPersonal(v)) out[k] = v;
    }
    return out;
  }
  /** Page URL sent to analytics: origin + path + vetted UTM tags. No hash, no other query parameters. */
  function cleanLocation() {
    var u = new URL(window.location.href);
    var out = new URL(u.origin + u.pathname);
    UTM_KEYS.forEach(function (k) {
      var v = u.searchParams.get(k);
      if (!v) return;
      v = v.trim().slice(0, 100);
      if (v && !looksPersonal(v)) out.searchParams.set(k, v);
    });
    return out.toString();
  }
  function cleanReferrer() {
    try { if (!doc.referrer) return ''; var r = new URL(doc.referrer); return r.origin + r.pathname; } catch (e) { return ''; }
  }

  /* ---------- event API ---------- */
  function track(name, params) {
    if (!EVENTS[name]) return;
    var p = sanitizeParams(params);
    var sent = state.gaActive && typeof window.gtag === 'function';
    window.afraEvents.push({ event: name, params: p, sent: sent });
    if (sent) window.gtag('event', name, p); // before consent: dropped, never queued
  }
  window.afraTrack = track;

  function pageSlug() {
    var p = window.location.pathname.replace(/^\/+|\/+$/g, '');
    return (p || 'home').replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 40);
  }
  function linkLocation(el) {
    if (el.id === 'wa-float') return 'floating_button';
    var s = el.closest('#form-error, #form-success, section[id], aside[id], footer, header, .cta-strip');
    if (!s) return pageSlug();
    if (s.tagName === 'FOOTER') return 'footer';
    if (s.tagName === 'HEADER') return 'header';
    if (s.classList.contains('cta-strip')) return 'cta_strip';
    return s.id.replace(/-/g, '_');
  }

  // One delegated listener per page (capture phase, before navigation handlers).
  doc.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var loc = linkLocation(a);
    // Context comes only from fixed data-* attributes on the link, never from anything the visitor typed.
    if (/^https:\/\/wa\.me\//i.test(href)) {
      var wp = { link_location: loc };
      if (a.hasAttribute('data-wa-service')) wp.service = a.getAttribute('data-wa-service');
      if (a.hasAttribute('data-wa-plan')) wp.plan = a.getAttribute('data-wa-plan');
      track('whatsapp_click', wp);
    }
    else if (/^tel:/i.test(href)) track('phone_click', { link_location: loc });
    else if (/^mailto:/i.test(href)) track('email_click', { link_location: loc });
    else if (a.hasAttribute('data-service')) track('service_cta_click', { service: a.getAttribute('data-service'), link_location: loc });
    else if (a.hasAttribute('data-cta')) {
      var cp = { cta_id: a.getAttribute('data-cta'), link_location: loc };
      if (a.hasAttribute('data-plan')) cp.plan = a.getAttribute('data-plan');
      track('cta_click', cp);
    }
  }, true);

  /* ---------- tools (only ever started after consent) ---------- */
  function startGA(id) {
    if (state.gaActive || !GA4_ID_RE.test(id)) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window['ga-disable-' + id] = false;
    window.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', id, {
      page_location: cleanLocation(),
      page_referrer: cleanReferrer(),
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      send_page_view: true, // exactly one page_view per page load; in-page navigation no longer changes history
    });
    var s = doc.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    doc.head.appendChild(s);
    state.gaActive = true; state.gaId = id;
  }
  function startSpeedInsights() {
    if (state.siActive) return;
    window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
    var s = doc.createElement('script');
    s.defer = true;
    s.src = '/_vercel/speed-insights/script.js';
    doc.head.appendChild(s);
    state.siActive = true;
  }
  function activate(cfg) {
    if (!state.consent || state.consent.analytics !== true) return;
    if (cfg.ga4) startGA(cfg.ga4);
    if (cfg.speedInsights) startSpeedInsights();
  }
  function clearGaCookies() {
    var names = doc.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); })
      .filter(function (n) { return /^_ga($|_)|^_gid$|^_gat/.test(n); });
    var host = window.location.hostname, parts = host.split('.');
    var domains = ['', host, '.' + host];
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    names.forEach(function (n) {
      domains.forEach(function (d) { doc.cookie = n + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : ''); });
    });
  }
  function withdraw() {
    var wasActive = state.gaActive || state.siActive;
    if (state.gaActive && typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: 'denied' });
      window['ga-disable-' + state.gaId] = true; // Google's official opt-out flag: no further hits
    }
    state.gaActive = false;
    writeConsent(false);
    clearGaCookies();
    // Already-loaded scripts cannot be unloaded; reload so the page continues without them.
    if (wasActive) setTimeout(function () { window.location.reload(); }, 60);
  }

  /* ---------- configuration ---------- */
  function loadConfig() {
    if (state.configPromise) return state.configPromise;
    state.configPromise = fetch(CONFIG_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (c) {
        c = c && typeof c === 'object' ? c : {};
        state.config = {
          ga4: typeof c.ga4 === 'string' && GA4_ID_RE.test(c.ga4) ? c.ga4 : null,
          speedInsights: c.speedInsights === true,
        };
        return state.config;
      });
    return state.configPromise;
  }
  function anyEnabled(cfg) { return !!(cfg && (cfg.ga4 || cfg.speedInsights)); }

  /* ---------- consent banner ---------- */
  var banner = null, returnFocusTo = null;
  // Resolves once the banner stylesheet has loaded, so the banner is never painted unstyled
  // (an unstyled banner would sit in the page flow for a moment and shift the layout).
  var cssPromise = null;
  function ensureCss() {
    if (cssPromise) return cssPromise;
    cssPromise = new Promise(function (resolve) {
      var l = doc.createElement('link');
      l.id = 'afra-consent-css'; l.rel = 'stylesheet'; l.href = '/assets/css/consent.css';
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      l.onload = finish; l.onerror = finish;
      setTimeout(finish, 4000); // never block the choice forever
      doc.head.appendChild(l);
    });
    return cssPromise;
  }
  function el(tag, attrs, text) {
    var n = doc.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }
  function closeBanner() {
    if (!banner) return;
    banner.remove(); banner = null;
    doc.removeEventListener('keydown', onKey);
    if (returnFocusTo && doc.contains(returnFocusTo)) returnFocusTo.focus();
    returnFocusTo = null;
  }
  function onKey(e) { if (e.key === 'Escape' && banner && banner.getAttribute('data-from-settings') === '1') { e.preventDefault(); closeBanner(); } }

  function showBanner(cfg, fromSettings, trigger) {
    return ensureCss().then(function () { renderBanner(cfg, fromSettings, trigger); });
  }
  function renderBanner(cfg, fromSettings, trigger) {
    if (banner) banner.remove();
    banner = el('section', { id: 'afra-consent', 'class': 'afra-consent', role: 'dialog', 'aria-modal': 'false',
      'aria-labelledby': 'afra-consent-title', 'aria-describedby': 'afra-consent-desc', 'data-from-settings': fromSettings ? '1' : '0' });
    var inner = el('div', { 'class': 'afra-consent-inner' });
    inner.appendChild(el('h2', { id: 'afra-consent-title', 'class': 'afra-consent-title' }, 'Your privacy choices'));
    var desc = el('div', { id: 'afra-consent-desc', 'class': 'afra-consent-text' });

    if (!anyEnabled(cfg)) {
      desc.appendChild(el('p', {}, 'This website currently uses no analytics tools and sets no analytics cookies.'));
      inner.appendChild(desc);
      var actions0 = el('div', { 'class': 'afra-consent-actions' });
      var close0 = el('button', { type: 'button', 'class': 'afra-consent-btn', 'data-consent': 'close' }, 'Close');
      close0.addEventListener('click', closeBanner);
      actions0.appendChild(close0);
      inner.appendChild(actions0);
    } else {
      var tools = [];
      if (cfg.ga4) tools.push('Google Analytics (uses cookies)');
      if (cfg.speedInsights) tools.push('Vercel Speed Insights (no cookies)');
      desc.appendChild(el('p', {}, 'With your permission, AFRA DIGITAL uses ' + tools.join(' and ') +
        ' to understand how visitors use this website and to improve it. We do not use advertising features, and your contact details are never shared with these tools.'));
      var more = el('p', { 'class': 'afra-consent-small' }, 'You can change your choice at any time with “Cookie settings” at the bottom of each page. ');
      var link = el('a', { href: '/privacy-policy#cookies' }, 'Privacy Policy');
      more.appendChild(link);
      desc.appendChild(more);
      if (state.consent) desc.appendChild(el('p', { 'class': 'afra-consent-small afra-consent-status' }, 'Current choice: ' + (state.consent.analytics ? 'accepted' : 'rejected') + '.'));
      inner.appendChild(desc);
      var actions = el('div', { 'class': 'afra-consent-actions' });
      // Equal prominence: identical styling, size and weight for both choices.
      var reject = el('button', { type: 'button', 'class': 'afra-consent-btn', 'data-consent': 'reject' }, 'Reject');
      var accept = el('button', { type: 'button', 'class': 'afra-consent-btn', 'data-consent': 'accept' }, 'Accept');
      reject.addEventListener('click', function () {
        var hadGranted = state.consent && state.consent.analytics === true;
        closeBanner();
        if (hadGranted) withdraw(); else writeConsent(false);
      });
      accept.addEventListener('click', function () {
        writeConsent(true);
        closeBanner();
        activate(cfg);
      });
      actions.appendChild(reject); actions.appendChild(accept);
      if (fromSettings) {
        var close = el('button', { type: 'button', 'class': 'afra-consent-close', 'aria-label': 'Close privacy choices without changing them' }, '×');
        close.addEventListener('click', closeBanner);
        inner.appendChild(close);
      }
      inner.appendChild(actions);
    }
    banner.appendChild(inner);
    // First in the document so keyboard and screen-reader users reach it early; fixed at the bottom visually (no layout shift).
    doc.body.insertBefore(banner, doc.body.firstChild);
    doc.addEventListener('keydown', onKey);
    if (fromSettings) {
      returnFocusTo = trigger || null;
      var first = banner.querySelector('button[data-consent]');
      if (first) first.focus();
    }
  }

  function openSettings(trigger) {
    loadConfig().then(function (cfg) { showBanner(cfg, true, trigger); });
  }
  doc.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-cookie-settings]') : null;
    if (!b) return;
    e.preventDefault();
    openSettings(b);
  });

  /* ---------- start ---------- */
  function init() {
    var c = state.consent;
    if (c && c.analytics === false) return; // rejected: no requests at all
    loadConfig().then(function (cfg) {
      if (!anyEnabled(cfg)) return;          // nothing to consent to
      if (c && c.analytics === true) activate(cfg);
      else showBanner(cfg, false, null);
    });
  }

  window.afraAnalytics = {
    track: track,
    openSettings: openSettings,
    getConsent: function () { return state.consent ? { analytics: state.consent.analytics, ts: state.consent.ts } : null; },
    status: function () { return { gaActive: state.gaActive, speedInsightsActive: state.siActive, config: state.config }; },
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
