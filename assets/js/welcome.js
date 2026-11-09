/* AFRA DIGITAL — welcome screen, once per browser session.
   Loaded in the homepage <head> (blocking, tiny) so the decision is made before the first paint, and deferred on every
   other page so a session that starts there is marked too. When the session has already seen the welcome, <html> gets
   .afra-welcome-seen and the CSS keeps #loader hidden; site.js removes it. If sessionStorage is unavailable (privacy
   modes, blocked storage) the welcome simply shows — it never blocks the page. */
(function (d) {
  var KEY = 'afra-welcome', seen = false;
  try { seen = window.sessionStorage.getItem(KEY) === '1'; window.sessionStorage.setItem(KEY, '1'); } catch (e) { /* storage unavailable */ }
  if (seen) d.documentElement.classList.add('afra-welcome-seen');
})(document);
