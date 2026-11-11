// MK-Flix footer for cinejoy.pk. Run in the page after it loads; safe to
// run more than once.
//
// The site's footer (logo, hosting disclaimer, contact email) is hidden and
// replaced with the MK-Flix lines and support details. They are real text
// so people can select and copy the payment details: one click (desktop) or
// a long-press (phone) on the number or email selects the whole value.
//
// The site's own code owns the footer and can redraw it at any time, which
// would drop our block, so a MutationObserver puts it back whenever it is
// missing. The footer element itself is kept, so its bottom padding still
// keeps the page clear of the site's bottom navigation bar on narrow screens.
//
// This file is shared: the desktop app loads it from mk-flix-desktop/, the
// Android app from app/src/main/assets/. Keep the two copies identical.
(function () {
  if (window.__mkflixFooter) return;
  window.__mkflixFooter = true;

  var CSS = [
    '.app-shell > footer > :not(#mkflix-footer) { display: none !important; }',
    '#mkflix-footer { text-align: center; -webkit-user-select: text; user-select: text; }',
    '#mkflix-footer .mkf-name { color: rgba(255,255,255,0.85); font-size: 1rem;',
    '  font-weight: 700; letter-spacing: 0.02em; }',
    '#mkflix-footer .mkf-tag { margin-top: 0.4rem; color: rgba(255,255,255,0.4);',
    '  font-size: 0.75rem; }',
    '#mkflix-footer .mkf-support { margin-top: 1.25rem; color: rgba(255,255,255,0.6);',
    '  font-size: 0.8rem; font-weight: 600; }',
    '#mkflix-footer .mkf-pay { margin-top: 0.3rem; color: rgba(255,255,255,0.45);',
    '  font-size: 0.75rem; }',
    '#mkflix-footer .mkf-value { color: rgba(255,255,255,0.75); cursor: text;',
    '  -webkit-user-select: all; user-select: all; }'
  ].join('\n');

  function el(className, text) {
    var e = document.createElement(className === 'mkf-value' ? 'span' : 'div');
    e.className = className;
    if (text) e.textContent = text;
    return e;
  }

  function build() {
    var box = document.createElement('div');
    box.id = 'mkflix-footer';
    box.appendChild(el('mkf-name', 'MK-Flix: Powered by CineJoy'));
    box.appendChild(el('mkf-tag', 'NutFlix just got better 😉'));
    box.appendChild(el('mkf-support', 'Support or buy me coffee'));
    var pay = el('mkf-pay');
    pay.appendChild(document.createTextNode('M-Pesa: '));
    pay.appendChild(el('mkf-value', '0748-774-164'));
    pay.appendChild(document.createTextNode(' | PayPal: '));
    pay.appendChild(el('mkf-value', 'alexroymauk@gmail.com'));
    box.appendChild(pay);
    return box;
  }

  function ensure() {
    if (!document.getElementById('mkflix-footer-style') && document.head) {
      var style = document.createElement('style');
      style.id = 'mkflix-footer-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    var footer = document.querySelector('.app-shell > footer');
    if (footer && !footer.querySelector('#mkflix-footer')) footer.appendChild(build());
  }

  ensure();
  new MutationObserver(ensure).observe(document.documentElement, { childList: true, subtree: true });
})();
