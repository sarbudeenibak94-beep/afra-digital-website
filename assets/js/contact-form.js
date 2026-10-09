/* ==============================================================
   AFRA DIGITAL — contact form module (shared by the homepage and service pages)
   Moved unchanged from assets/js/site.js (Phase 05) so every page with the
   enquiry form uses one code path. Requires only the form markup itself
   (#contact-form and its fields); it does not depend on any homepage section.
   Per-page defaults (preselected service, default source id) are plain HTML
   attributes in the page markup, so they also work without JavaScript.
   ============================================================== */
(function () {
  'use strict';

  var doc = document;

  /* Analytics: events go through assets/js/analytics.js (consent-aware, allow-listed,
     PII-filtered). Never pass personal data as parameters. */
  function track(event, params) {
    if (typeof window.afraTrack === 'function') window.afraTrack(event, params);
  }

  /* ---------- CTAs carry context into the form: service, package (plan) and source button ---------- */
  var planInput = doc.getElementById('cf-plan');
  var planChip = doc.getElementById('cf-plan-chip');
  var planName = doc.getElementById('cf-plan-name');
  var sourceInput = doc.getElementById('cf-source');
  var PLAN_NAMES = { Starter: 1, Business: 1, Enterprise: 1 };
  function setPlan(plan) {
    if (!planInput) return;
    plan = PLAN_NAMES[plan] ? plan : '';
    planInput.value = plan;
    if (planName) planName.textContent = plan;
    if (planChip) planChip.hidden = !plan;
  }
  var planClear = doc.getElementById('cf-plan-clear');
  if (planClear) planClear.addEventListener('click', function () { setPlan(''); var s = doc.getElementById('cf-service'); if (s) s.focus(); });

  doc.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#contact"]');
    if (!a) return;
    var svc = a.getAttribute('data-service');
    if (svc) {
      var sel = doc.getElementById('cf-service');
      if (sel) for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === svc) { sel.value = svc; break; }
    }
    if (a.hasAttribute('data-plan')) setPlan(a.getAttribute('data-plan'));
    // Which button brought the visitor here (a fixed id such as "pricing_business"), for the enquiry email.
    var cta = a.getAttribute('data-cta');
    if (sourceInput && cta && /^[a-z0-9_]{1,40}$/.test(cta)) sourceInput.value = cta;
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
      phone: { too_long: 'Phone number is too long.', invalid: 'Please enter a valid phone number, e.g. +974 1234 5678.', required_for_contact: 'Please add a phone number so we can contact you by WhatsApp or phone.' },
      budget: { invalid: 'Please choose a budget range from the list.' },
      timeline: { invalid: 'Please choose a timeline from the list.' },
      contactPref: { invalid: 'Please choose a contact method from the list.' },
      plan: { invalid: 'Please choose the package again from the pricing section.' },
      company: { too_long: 'Company name is too long (max 120 characters).', invalid: 'Please check the company name.' },
      service: { invalid: 'Please choose a service from the list.' },
      message: { too_long: 'Please keep your brief under 5,000 characters.', invalid: 'Please check your project brief.' },
    };
    var GENERIC = 'Sorry, your message could not be sent right now. Please contact us on WhatsApp or by email.';
    var FIELDS = ['firstName', 'lastName', 'email', 'phone', 'company', 'service', 'budget', 'timeline', 'contactPref', 'plan', 'source', 'message'];

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
      if (!f.phone && !d.phone && (d.contactPref === 'WhatsApp' || d.contactPref === 'Phone')) f.phone = 'required_for_contact';
      return f;
    }

    // Live re-validation clears an error as soon as it is fixed.
    function revalidate(name) {
      var el = fieldEl(name);
      if (!el || el.getAttribute('aria-invalid') !== 'true') return;
      var f = clientValidate(collect());
      setFieldError(name, f[name] || null);
    }
    form.addEventListener('input', function (e) { if (FIELDS.indexOf(e.target.name) !== -1) revalidate(e.target.name); });
    form.addEventListener('change', function (e) { if (e.target.name === 'contactPref') revalidate('phone'); });

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
          var refBox = doc.getElementById('form-ref'), refCode = doc.getElementById('form-ref-code');
          if (refBox && refCode && typeof r.body.reference === 'string' && /^AFRA-[2-9A-HJ-NP-Z]{6}$/.test(r.body.reference)) {
            refCode.textContent = r.body.reference; refBox.hidden = false;
          }
          success.hidden = false;
          success.focus();
          // Conversion only after confirmed delivery; business categories only (no budget, no personal data).
          if (!r.body.duplicate) track('generate_lead', { form_id: 'contact', method: 'contact_form', service: d.service || 'unspecified', plan: d.plan || 'none' });
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
})();
