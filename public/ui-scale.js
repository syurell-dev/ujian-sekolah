/* Pengaturan ukuran tampilan (UI), ukuran teks, dan tema. Tersimpan di localStorage. */
(function () {
  'use strict';

  var UI_VALUES = [0.85, 1, 1.15, 1.3];
  var TEXT_VALUES = [0.85, 1, 1.15, 1.35];
  var THEME_VALUES = [
    { value: 'light', label: 'Terang' },
    { value: 'dark', label: 'Gelap' }
  ];
  var KEY_UI = 'ui_scale';
  var KEY_TEXT = 'text_scale';
  var KEY_THEME = 'guru_theme';
  var DEFAULT_THEME = 'dark';
  var themeEnabled = document.documentElement.hasAttribute('data-theme-enabled');

  function readNum(key, fallback) {
    try {
      var v = parseFloat(localStorage.getItem(key));
      if (isFinite(v) && v >= 0.7 && v <= 1.6) return v;
    } catch (e) { /* localStorage bisa diblokir */ }
    return fallback;
  }

  function readTheme() {
    if (!themeEnabled) return null;
    try {
      var v = localStorage.getItem(KEY_THEME);
      if (v === 'light' || v === 'dark') return v;
    } catch (e) { /* abaikan */ }
    return DEFAULT_THEME;
  }

  var state = { ui: readNum(KEY_UI, 1), text: readNum(KEY_TEXT, 1), theme: readTheme() };

  function persist() {
    try {
      localStorage.setItem(KEY_UI, String(state.ui));
      localStorage.setItem(KEY_TEXT, String(state.text));
      if (themeEnabled) localStorage.setItem(KEY_THEME, state.theme);
    } catch (e) { /* abaikan */ }
  }

  function apply() {
    var root = document.documentElement;
    var style = root.style;
    style.setProperty('--ui-scale', String(state.ui));
    style.setProperty('--text-scale', String(state.text));
    if (themeEnabled) root.setAttribute('data-theme', state.theme);

    var buttons = document.querySelectorAll('.ui-seg button');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var kind = btn.parentNode.getAttribute('data-kind');
      var value = btn.getAttribute('data-value');
      var on;
      if (kind === 'theme') on = value === state.theme;
      else on = parseFloat(value) === (kind === 'ui' ? state.ui : state.text);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function segment(kind, values, label) {
    var html = '<div class="ui-row"><span>' + label + '</span><div class="ui-seg" data-kind="' + kind + '">';
    for (var i = 0; i < values.length; i++) {
      var item = values[i];
      var value = typeof item === 'object' ? item.value : item;
      var text = typeof item === 'object' ? item.label : Math.round(item * 100) + '%';
      html += '<button type="button" data-value="' + value + '" aria-pressed="false">' + text + '</button>';
    }
    return html + '</div></div>';
  }

  function onPanelClick(e) {
    e.stopPropagation();
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    if (btn.id === 'ui-reset') {
      state.ui = 1;
      state.text = 1;
      if (themeEnabled) state.theme = DEFAULT_THEME;
      persist();
      apply();
      return;
    }
    var kind = btn.parentNode.getAttribute('data-kind');
    if (kind === 'theme') {
      state.theme = btn.getAttribute('data-value');
    } else {
      var value = parseFloat(btn.getAttribute('data-value'));
      if (kind === 'ui') state.ui = value;
      else state.text = value;
    }
    persist();
    apply();
  }

  function buildFloating() {
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

    panel.addEventListener('click', onPanelClick);

    document.addEventListener('click', function () { toggle(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') toggle(false);
    });

    apply();
  }

  function buildInline(host) {
    if (host.querySelector('.ui-panel')) return;

    var panel = document.createElement('div');
    panel.className = 'ui-panel ui-panel-inline';
    panel.id = 'ui-panel';
    panel.innerHTML =
      segment('theme', THEME_VALUES, 'Tema') +
      segment('ui', UI_VALUES, 'Ukuran antarmuka') +
      segment('text', TEXT_VALUES, 'Ukuran teks') +
      '<button type="button" class="ui-reset" id="ui-reset">Kembalikan default</button>';
    host.appendChild(panel);
    panel.addEventListener('click', onPanelClick);

    apply();
  }

  function build() {
    var host = document.getElementById('ui-settings-inline');
    if (host) buildInline(host);
    else buildFloating();
  }

  apply();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
