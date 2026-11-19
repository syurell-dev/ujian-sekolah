/* Pengaturan ukuran tampilan (UI) dan ukuran teks, tersimpan di localStorage. */
(function () {
  'use strict';

  var UI_VALUES = [0.85, 1, 1.15, 1.3];
  var TEXT_VALUES = [0.85, 1, 1.15, 1.35];
  var KEY_UI = 'ui_scale';
  var KEY_TEXT = 'text_scale';

  function readNum(key, fallback) {
    try {
      var v = parseFloat(localStorage.getItem(key));
      if (isFinite(v) && v >= 0.7 && v <= 1.6) return v;
    } catch (e) { /* localStorage bisa diblokir */ }
    return fallback;
  }

  var state = { ui: readNum(KEY_UI, 1), text: readNum(KEY_TEXT, 1) };

  function persist() {
    try {
      localStorage.setItem(KEY_UI, String(state.ui));
      localStorage.setItem(KEY_TEXT, String(state.text));
    } catch (e) { /* abaikan */ }
  }

  function apply() {
    var style = document.documentElement.style;
    style.setProperty('--ui-scale', String(state.ui));
    style.setProperty('--text-scale', String(state.text));

    var buttons = document.querySelectorAll('.ui-seg button');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var kind = btn.parentNode.getAttribute('data-kind');
      var value = parseFloat(btn.getAttribute('data-value'));
      var on = kind === 'ui' ? value === state.ui : value === state.text;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function segment(kind, values, label) {
    var html = '<div class="ui-row"><span>' + label + '</span><div class="ui-seg" data-kind="' + kind + '">';
    for (var i = 0; i < values.length; i++) {
      html += '<button type="button" data-value="' + values[i] + '" aria-pressed="false">' +
        Math.round(values[i] * 100) + '%</button>';
    }
    return html + '</div></div>';
  }

  function build() {
    if (document.querySelector('.ui-settings')) return;

    var wrap = document.createElement('div');
    wrap.className = 'ui-settings';
    wrap.innerHTML =
      '<div class="ui-panel" id="ui-panel" hidden>' +
        '<h4>Ukuran tampilan</h4>' +
        segment('ui', UI_VALUES, 'Antarmuka') +
        segment('text', TEXT_VALUES, 'Teks') +
        '<button type="button" class="ui-reset" id="ui-reset">Kembalikan default</button>' +
      '</div>' +
      '<button type="button" class="ui-fab" id="ui-fab" aria-expanded="false" aria-controls="ui-panel"' +
        ' aria-label="Atur ukuran tampilan" title="Atur ukuran tampilan">Aa</button>';
    document.body.appendChild(wrap);

    var fab = wrap.querySelector('#ui-fab');
    var panel = wrap.querySelector('#ui-panel');

    function toggle(open) {
      panel.hidden = !open;
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      toggle(panel.hidden);
    });

    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      var btn = e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      if (btn.id === 'ui-reset') {
        state.ui = 1;
        state.text = 1;
        persist();
        apply();
        return;
      }
      var kind = btn.parentNode.getAttribute('data-kind');
      var value = parseFloat(btn.getAttribute('data-value'));
      if (kind === 'ui') state.ui = value;
      else state.text = value;
      persist();
      apply();
    });

    document.addEventListener('click', function () { toggle(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') toggle(false);
    });

    apply();
  }

  apply();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
