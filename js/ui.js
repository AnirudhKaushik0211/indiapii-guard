/* IndiaPII Guard page wiring (browser only; SPEC 2.5 and 7). DOM APIs and text nodes only, never HTML strings.
 * Storage is used only through storageGet, storageSet and storageRemove (SPEC 7.12). */
(function () {
  'use strict';
  var G = window.IndiaPIIGuard;
  var L = G.lexicon;
  var ENTITIES = G.ENTITIES;
  var LABELS = L.LABELS;
  var PLURAL_LABELS = L.PLURAL_LABELS;

  var MAX_CHARS = 200000;
  var LONG_TEXT = 50000;
  var DEBOUNCE_MS = 250;
  var DEBOUNCE_LONG_MS = 600;
  var ANNOUNCE_GAP_MS = 2000;
  var HELP_KEY = 'indiapii-guard.helpSeen.v1';
  var SETTINGS_KEY = 'indiapii-guard.settings.v1';
  var STYLES = ['token', 'mask', 'partial'];
  var PRESETS = ['lenient', 'balanced', 'strict'];
  var PRESET_NAMES = { lenient: 'Lenient', balanced: 'Balanced', strict: 'Strict' };
  var TABS = ['help', 'redact', 'settings'];
  var PREVIEW_TEXT = 'Aadhaar 2345 6789 0124';

  var MSG = {
    replaced: 'Text replaced.',
    nothing: 'Nothing changed.',
    reset: 'Settings reset.',
    undone: 'Undone.',
    copied: 'Copied the redacted text.',
    copyFail: 'Copy did not work in this browser. The text is selected; press Ctrl+C (Cmd+C on a Mac).',
    copyEmpty: 'Nothing to copy yet.',
    error: 'Something went wrong while checking the text. Your text is still in the box; please report this ' +
      '(without the text) on the project\'s Issues page.',
    badSettings: 'Saved settings could not be read, so the defaults are used.'
  };

  // ---------------------------------------------------------------- storage (SPEC 7.12, exactly)
  var ALLOWED_KEYS = ['indiapii-guard.helpSeen.v1', 'indiapii-guard.settings.v1'];
  function storageGet(key) { if (ALLOWED_KEYS.indexOf(key) < 0) return null; try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, value) { if (ALLOWED_KEYS.indexOf(key) < 0) return false; try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function storageRemove(key) { if (ALLOWED_KEYS.indexOf(key) < 0) return false; try { window.localStorage.removeItem(key); return true; } catch (e) { return false; } }

  // ---------------------------------------------------------------- safe reads (SPEC 7.11)
  function $(id) { return document.getElementById(id); }
  function readField(id) { var el = $(id); return el ? String(el.value) : ''; }
  function readChecked(id) { var el = $(id); return el ? !!el.checked : false; }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  function setHidden(id, hidden) { var el = $(id); if (el) el.hidden = hidden; }
  function clearChildren(el) { if (el) while (el.firstChild) el.removeChild(el.firstChild); }
  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.appendChild(document.createTextNode(text));
    return el;
  }
  function now() { return performance.now(); }
  function thousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function entCtrlId(e) { return 'pg-set-ent-' + e.toLowerCase().replace(/_/g, '-'); }
  function keyOf(f) { return f.entity + ':' + f.value; }

  // ---------------------------------------------------------------- state (SPEC 2.5)
  var state = {
    settings: null,
    excluded: {},
    undo: null,
    timer: null,
    findings: [],
    lastCount: null,
    lastCountAt: -Infinity,
    lastMsgAt: -Infinity
  };
  var SAMPLES = G.samples.build();

  // ---------------------------------------------------------------- settings (SPEC 7.6, 7.12)
  function defaultSettings() {
    var ents = {};
    for (var i = 0; i < ENTITIES.length; i++) ents[ENTITIES[i]] = true;
    return { v: 1, entities: ents, style: 'token', threshold: 'balanced', ocr: true, remember: false };
  }
  function copySettings(s) {
    var ents = {};
    for (var i = 0; i < ENTITIES.length; i++) ents[ENTITIES[i]] = s.entities[ENTITIES[i]] !== false;
    return { v: 1, entities: ents, style: s.style, threshold: s.threshold, ocr: s.ocr, remember: s.remember };
  }
  function settingsEqual(a, b) { return JSON.stringify(copySettings(a)) === JSON.stringify(copySettings(b)); }

  // Returns valid settings or null (SPEC 7.12 "Settings validation on read").
  function validateSettings(raw) {
    var o;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
    if (!o.entities || typeof o.entities !== 'object' || Array.isArray(o.entities)) return null;
    var keys = Object.keys(o.entities);
    for (var i = 0; i < keys.length; i++) {
      if (ENTITIES.indexOf(keys[i]) < 0 || typeof o.entities[keys[i]] !== 'boolean') return null;
    }
    if (STYLES.indexOf(o.style) < 0 || PRESETS.indexOf(o.threshold) < 0) return null;
    if (typeof o.ocr !== 'boolean' || typeof o.remember !== 'boolean') return null;
    return copySettings(o);
  }
  function settingsFromControls() {
    var s = defaultSettings();
    for (var i = 0; i < ENTITIES.length; i++) s.entities[ENTITIES[i]] = readChecked(entCtrlId(ENTITIES[i]));
    for (var j = 0; j < STYLES.length; j++) if (readChecked('pg-set-style-' + STYLES[j])) s.style = STYLES[j];
    for (var k = 0; k < PRESETS.length; k++) if (readChecked('pg-set-th-' + PRESETS[k])) s.threshold = PRESETS[k];
    s.ocr = readChecked('pg-set-ocr');
    s.remember = readChecked('pg-set-remember');
    return s;
  }
  function setChecked(id, on) { var el = $(id); if (el) el.checked = !!on; }
  function applySettingsToControls(s) {
    for (var i = 0; i < ENTITIES.length; i++) setChecked(entCtrlId(ENTITIES[i]), s.entities[ENTITIES[i]] !== false);
    for (var j = 0; j < STYLES.length; j++) setChecked('pg-set-style-' + STYLES[j], s.style === STYLES[j]);
    for (var k = 0; k < PRESETS.length; k++) setChecked('pg-set-th-' + PRESETS[k], s.threshold === PRESETS[k]);
    setChecked('pg-set-ocr', s.ocr);
    setChecked('pg-set-remember', s.remember);
  }
  function persistSettings() {
    if (state.settings.remember) storageSet(SETTINGS_KEY, JSON.stringify(state.settings));
    else storageRemove(SETTINGS_KEY);
  }
  function excludedKeys() { return Object.keys(state.excluded); }
  function optionsFromSettings(extraExclude) {
    var s = state.settings;
    var ents = {};
    for (var i = 0; i < ENTITIES.length; i++) ents[ENTITIES[i]] = s.entities[ENTITIES[i]] !== false;
    return { threshold: s.threshold, entities: ents, style: s.style, ocrNormalise: s.ocr,
      exclude: extraExclude === undefined ? excludedKeys() : extraExclude };
  }
  function updatePreview() {
    var r = G.redact(PREVIEW_TEXT, { style: state.settings.style });
    setText('pg-set-preview', 'Preview: ' + PREVIEW_TEXT + ' -> ' + r.text.slice('Aadhaar '.length));
  }

  // ---------------------------------------------------------------- messages (SPEC 7.10)
  function showStatus(text) { setText('pg-status-text', text); }
  function message(text) { showStatus(text); state.lastMsgAt = now(); }
  function setUndo(slot) { state.undo = slot; setHidden('pg-undo', false); }
  function clearUndo() { state.undo = null; setHidden('pg-undo', true); }

  function clearOutputs() {
    clearChildren($('pg-highlight'));
    clearChildren($('pg-findings-body'));
    clearChildren($('pg-map-body'));
    var out = $('pg-output');
    if (out) out.value = '';
    state.findings = [];
  }
  function handleError(e) {
    try { clearOutputs(); } catch (e2) { /* keep going */ }
    message(MSG.error);
    console.warn('IndiaPII Guard: unexpected ' + (e && e.name ? e.name : 'error') + ' in a handler.');
  }
  // Every event handler is wrapped, so an unexpected exception never escapes (SPEC 7.10).
  function guarded(fn) {
    return function (ev) {
      try { return fn.call(this, ev); } catch (e) { handleError(e); return undefined; }
    };
  }

  // ---------------------------------------------------------------- reason texts (SPEC 7.8)
  function reasonText(code, f) {
    var i = code.indexOf(':');
    var kind = i < 0 ? code : code.slice(0, i);
    var arg = i < 0 ? '' : code.slice(i + 1);
    switch (code) {
      case 'checksum:verhoeff': return 'Aadhaar check digit (Verhoeff) is valid';
      case 'checksum:luhn': return 'Card check digit (Luhn) is valid';
      case 'checksum:gstin': return 'GSTIN check character is valid';
      case 'structure:ifsc': return 'IFSC pattern (4 letters, 0, 6 characters)';
      case 'structure:email': return 'E-mail address';
      case 'handle:known': return 'Known UPI handle';
      case 'handle:unknown': return 'Unknown UPI handle';
      case 'grouping:non-canonical': return 'Unusual grouping';
      case 'case:mixed': return 'Not in capitals (lower confidence)';
      case 'gstin:14th-not-Z': return '14th character is not Z (lower confidence)';
      default: break;
    }
    if (code === 'structure:pan' || kind === 'holder') {
      var letter = kind === 'holder' ? arg : String(f.value || '').charAt(3).toUpperCase();
      var type = G.validators.panHolderType(String(f.value || ''));
      return 'PAN pattern; 4th letter ' + letter + ' = ' + (type || 'unknown holder type');
    }
    if (kind === 'prefix') return 'Indian prefix ' + arg;
    if (kind === 'grouping') return 'Written as ' + arg;
    if (kind === 'context') return 'Context word "' + arg + '" nearby';
    if (kind === 'negative') return '"' + arg + '" nearby suggests a reference number (lower confidence)';
    if (kind === 'competing') return 'Context suggests a ' + (LABELS[arg] || arg) + ' instead (lower confidence)';
    if (kind === 'ocr') return 'Read ' + arg + ' lookalike character(s) as digits';
    if (kind === 'state') return 'State code ' + arg;
    return code;
  }
  function whyText(f) {
    var out = [];
    var panDone = false;
    for (var i = 0; i < f.reasons.length; i++) {
      var c = f.reasons[i];
      if (c === 'structure:pan' || c.indexOf('holder:') === 0) {
        if (panDone) continue;
        panDone = true;
      }
      out.push(reasonText(c, f));
    }
    return out.join('; ');
  }

  // ---------------------------------------------------------------- rendering (SPEC 7.5, 7.7)
  function summaryText(text, findings) {
    if (text === '') return 'Paste some text to start.';
    if (!findings.length) return 'No personal data found at the ' + PRESET_NAMES[state.settings.threshold] + ' threshold.';
    var counts = {};
    for (var i = 0; i < findings.length; i++) counts[findings[i].entity] = (counts[findings[i].entity] || 0) + 1;
    var parts = [];
    for (var j = 0; j < ENTITIES.length; j++) {
      var e = ENTITIES[j];
      if (counts[e]) parts.push(counts[e] + ' ' + (counts[e] === 1 ? LABELS[e] : PLURAL_LABELS[e]));
    }
    var lead = findings.length === 1 ? 'Found 1 item: ' : 'Found ' + findings.length + ' items: ';
    return lead + parts.join(', ') + '.';
  }

  function renderHighlight(text, findings) {
    var box = $('pg-highlight');
    if (!box) return;
    var frag = document.createDocumentFragment();
    var pos = 0;
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      if (f.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, f.start)));
      var mark = node('mark', 'pg-mark pg-e-' + f.entity.toLowerCase() + (f.excluded ? ' pg-kept' : ''), text.slice(f.start, f.end));
      mark.setAttribute('data-finding', f.id);
      frag.appendChild(mark);
      var tag = f.excluded ? '[kept: ' + LABELS[f.entity] + ']' : '[' + LABELS[f.entity] + ' ' + f.confidence.toFixed(2) + ']';
      frag.appendChild(node('span', 'pg-tag', tag));
      pos = f.end;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    clearChildren(box);
    box.appendChild(frag);
  }

  function renderTable(text, findings) {
    var body = $('pg-findings-body');
    if (!body) return;
    var frag = document.createDocumentFragment();
    var line = 1;
    var lineStart = 0;
    var scanned = 0;
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      for (; scanned < f.start; scanned++) {
        if (text.charCodeAt(scanned) === 10) { line++; lineStart = scanned + 1; }
      }
      var label = LABELS[f.entity];
      var tr = document.createElement('tr');
      tr.setAttribute('data-entity', f.entity);
      tr.setAttribute('data-finding', f.id);
      tr.appendChild(node('td', null, String(i + 1)));
      var ent = node('td');
      var sw = node('span', 'pg-swatch pg-e-' + f.entity.toLowerCase());
      sw.setAttribute('aria-hidden', 'true');
      ent.appendChild(sw);
      ent.appendChild(document.createTextNode(label));
      tr.appendChild(ent);
      tr.appendChild(node('td', 'pg-mono', f.text));
      tr.appendChild(node('td', null, f.confidence.toFixed(2)));
      tr.appendChild(node('td', null, whyText(f)));
      tr.appendChild(node('td', null, 'line ' + line + ', column ' + (f.start - lineStart + 1)));
      var cell = node('td');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'pg-keep-' + f.id;
      box.checked = !f.excluded;
      box.setAttribute('aria-label', 'Redact ' + label + ' ' + (i + 1));
      box.setAttribute('data-key', keyOf(f));
      cell.appendChild(box);
      tr.appendChild(cell);
      frag.appendChild(tr);
    }
    clearChildren(body);
    body.appendChild(frag);
  }

  function renderMap(mapping) {
    var token = state.settings.style === 'token';
    setHidden('pg-map-token', !token);
    setHidden('pg-map-other', token);
    var body = $('pg-map-body');
    if (!body) return;
    var frag = document.createDocumentFragment();
    if (token) {
      for (var i = 0; i < mapping.length; i++) {
        var m = mapping[i];
        if (m.token === null || m.token === undefined) continue;
        var tr = document.createElement('tr');
        tr.appendChild(node('td', 'pg-mono', m.token));
        tr.appendChild(node('td', null, LABELS[m.entity]));
        tr.appendChild(node('td', 'pg-mono', m.text));
        tr.appendChild(node('td', null, String(m.count)));
        frag.appendChild(tr);
      }
    }
    clearChildren(body);
    body.appendChild(frag);
  }

  function updateSampleNote(text) {
    var hit = null;
    for (var i = 0; i < SAMPLES.length; i++) if (SAMPLES[i].text === text) { hit = SAMPLES[i]; break; }
    setText('pg-sample-note', hit ? 'Sample: all identifiers are randomly generated. ' + hit.note : '');
    setHidden('pg-sample-note', !hit);
  }

  function setTooLong(n) {
    var input = $('pg-input');
    var copy = $('pg-copy');
    if (n === null) {
      setText('pg-input-err', '');
      setHidden('pg-input-err', true);
      if (input) input.removeAttribute('aria-invalid');
      if (copy) copy.disabled = false;
    } else {
      setText('pg-input-err', 'This text has ' + thousands(n) + ' characters. The limit is 200,000; split it into parts.');
      setHidden('pg-input-err', false);
      if (input) input.setAttribute('aria-invalid', 'true');
      if (copy) copy.disabled = true;
    }
  }

  // Count announcement (SPEC 7.5): dropped, not deferred, within 2 s of another message or count.
  function announceCount(text, n) {
    if (text === '') { state.lastCount = null; return; }
    if (n === state.lastCount) return;
    var t = now();
    if (t - state.lastMsgAt < ANNOUNCE_GAP_MS || t - state.lastCountAt < ANNOUNCE_GAP_MS) return;
    showStatus(n === 0 ? 'No items found.' : n === 1 ? '1 item found.' : n + ' items found.');
    state.lastCount = n;
    state.lastCountAt = t;
  }

  // Runs detection on the current input immediately (SPEC 2.5).
  function runDetection() {
    if (state.timer !== null) { clearTimeout(state.timer); state.timer = null; }
    var text = readField('pg-input');
    setText('pg-count', thousands(text.length) + ' / 200,000 characters');
    updateSampleNote(text);
    if (text.length > MAX_CHARS) {
      setTooLong(text.length);
      clearOutputs();
      setText('pg-summary', '');
      setText('pg-timing', '');
      return;
    }
    setTooLong(null);
    var t0 = now();
    var r = G.redact(text, optionsFromSettings());
    var ms = now() - t0;
    // Prune excluded keys that are no longer present (SPEC 7.5).
    var present = {};
    for (var i = 0; i < r.findings.length; i++) present[keyOf(r.findings[i])] = true;
    var keys = excludedKeys();
    for (var k = 0; k < keys.length; k++) if (!present[keys[k]]) delete state.excluded[keys[k]];
    state.findings = r.findings;
    renderHighlight(text, r.findings);
    renderTable(text, r.findings);
    setText('pg-summary', summaryText(text, r.findings));
    var out = $('pg-output');
    if (out) out.value = r.text;
    renderMap(r.mapping);
    setText('pg-timing', 'Checked in ' + (Math.round(ms * 10) / 10).toFixed(1) + ' ms.');
    announceCount(text, r.findings.length);
  }

  function scheduleDetection() {
    if (state.timer !== null) clearTimeout(state.timer);
    var len = readField('pg-input').length;
    state.timer = setTimeout(guarded(function () { state.timer = null; runDetection(); }), len > LONG_TEXT ? DEBOUNCE_LONG_MS : DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------- tabs (SPEC 7.2, 7.3)
  function selectTab(name, focus) {
    for (var i = 0; i < TABS.length; i++) {
      var on = TABS[i] === name;
      var tab = $('pg-tab-' + TABS[i]);
      if (tab) {
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.setAttribute('tabindex', on ? '0' : '-1');
      }
      setHidden('pg-panel-' + TABS[i], !on);
    }
    if (focus) { var t = $('pg-tab-' + name); if (t) t.focus(); }
    if (name !== 'help') storageSet(HELP_KEY, '1');
  }
  function currentTab() {
    for (var i = 0; i < TABS.length; i++) {
      var t = $('pg-tab-' + TABS[i]);
      if (t && t.getAttribute('aria-selected') === 'true') return TABS[i];
    }
    return 'help';
  }
  function onTabKey(ev) {
    // Arrow keys move from the focused tab (WAI-ARIA tabs pattern), which may differ from the selected one.
    var t = ev.target;
    var i = t && t.id && t.id.indexOf('pg-tab-') === 0 ? TABS.indexOf(t.id.slice(7)) : -1;
    if (i < 0) i = TABS.indexOf(currentTab());
    var next = null;
    if (ev.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (ev.key === 'ArrowLeft') next = (i + TABS.length - 1) % TABS.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    ev.preventDefault();
    selectTab(TABS[next], true);
  }

  // ---------------------------------------------------------------- actions
  function findSample(id) {
    for (var i = 0; i < SAMPLES.length; i++) if (SAMPLES[i].id === id) return SAMPLES[i];
    return null;
  }
  function loadSample(id) {
    var s = findSample(id);
    var input = $('pg-input');
    if (!s || !input) return;
    var prev = String(input.value);
    if (prev === s.text) { message(MSG.nothing); return; }
    setUndo({ kind: 'input', value: prev });
    input.value = s.text;
    state.excluded = {};
    runDetection();
    message(MSG.replaced);
  }
  function onClear() {
    var input = $('pg-input');
    if (!input) return;
    var prev = String(input.value);
    if (prev === '') { message(MSG.nothing); return; }
    setUndo({ kind: 'input', value: prev });
    input.value = '';
    state.excluded = {};
    runDetection();
    message(MSG.replaced);
  }
  function onReset() {
    var d = defaultSettings();
    if (settingsEqual(state.settings, d)) { message(MSG.nothing); return; }
    setUndo({ kind: 'settings', value: copySettings(state.settings) });
    applySettingsToControls(d);
    state.settings = d;
    storageRemove(SETTINGS_KEY);
    state.excluded = {};
    updatePreview();
    runDetection();
    message(MSG.reset);
  }
  function onUndo() {
    var u = state.undo;
    if (!u) return;
    state.excluded = {};
    var focusId;
    if (u.kind === 'input') {
      var input = $('pg-input');
      if (input) input.value = u.value;
      if (currentTab() !== 'redact') selectTab('redact', false);
      runDetection();
      focusId = 'pg-input';
    } else {
      state.settings = copySettings(u.value);
      applySettingsToControls(state.settings);
      if (state.settings.remember) storageSet(SETTINGS_KEY, JSON.stringify(state.settings));
      if (currentTab() !== 'settings') selectTab('settings', false);
      updatePreview();
      runDetection();
      focusId = 'pg-set-reset';
    }
    clearUndo();
    message(MSG.undone);
    var el = $(focusId);
    if (el) el.focus();
  }
  function onSettingsChange(ev) {
    var t = ev.target;
    if (!t || !t.id || t.id.indexOf('pg-set-') !== 0) return;
    clearUndo();
    state.settings = settingsFromControls();
    persistSettings();
    updatePreview();
    runDetection();
  }
  function onKeepChange(ev) {
    var t = ev.target;
    if (!t || !t.id || t.id.indexOf('pg-keep-') !== 0) return;
    var key = t.getAttribute('data-key');
    var f = null;
    var n = 0;
    for (var i = 0; i < state.findings.length; i++) {
      if (keyOf(state.findings[i]) === key) { n++; if (!f) f = state.findings[i]; }
    }
    if (!f) return;
    if (t.checked) delete state.excluded[key];
    else state.excluded[key] = true;
    var id = t.id;
    runDetection();
    var again = $(id);
    if (again) again.focus();
    var occ = '(' + n + (n === 1 ? ' occurrence).' : ' occurrences).');
    message(t.checked ? 'Redacting ' + LABELS[f.entity] + ' again ' + occ : 'Kept ' + LABELS[f.entity] + ' unredacted ' + occ);
  }

  // Copy (SPEC 7.9).
  function copyFallback() {
    var out = $('pg-output');
    if (!out) return;
    out.focus();
    out.select();
    var ok = false;
    try { ok = !!document.execCommand('copy'); } catch (e) { ok = false; }
    if (ok) { message(MSG.copied); return; }
    message(MSG.copyFail);
    out.focus();
    out.select();
  }
  function onCopy() {
    var text = readField('pg-output');
    if (text === '') { message(MSG.copyEmpty); return; }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(guarded(function () { message(MSG.copied); }), guarded(copyFallback));
    } else {
      copyFallback();
    }
  }

  // ---------------------------------------------------------------- start-up
  function on(id, type, fn) { var el = $(id); if (el) el.addEventListener(type, guarded(fn)); }

  function start() {
    var select = $('pg-sample-select');
    if (select) {
      clearChildren(select);
      for (var i = 0; i < SAMPLES.length; i++) {
        var opt = node('option', null, SAMPLES[i].title);
        opt.value = SAMPLES[i].id;
        select.appendChild(opt);
      }
      select.value = SAMPLES[0].id;
    }

    var badSettings = false;
    var stored = storageGet(SETTINGS_KEY);
    state.settings = defaultSettings();
    if (stored !== null) {
      var v = validateSettings(stored);
      if (v) state.settings = v;
      else { badSettings = true; storageRemove(SETTINGS_KEY); }
    }
    // Controls are always set from the settings object, so restored form state never disagrees with it.
    applySettingsToControls(state.settings);
    var input = $('pg-input');
    if (input) input.value = '';

    for (var t = 0; t < TABS.length; t++) {
      (function (name) { on('pg-tab-' + name, 'click', function () { selectTab(name, false); }); })(TABS[t]);
    }
    on('pg-tablist', 'keydown', onTabKey);
    on('pg-help-start', 'click', function () {
      storageSet(HELP_KEY, '1');
      selectTab('redact', false);
      var el = $('pg-input');
      if (el) el.focus();
    });
    on('pg-help-try', 'click', function () {
      storageSet(HELP_KEY, '1');
      var sel = $('pg-sample-select');
      if (sel) sel.value = 'support-ticket';
      selectTab('redact', false);
      loadSample('support-ticket');
    });
    on('pg-sample-load', 'click', function () { loadSample(readField('pg-sample-select')); });
    on('pg-clear', 'click', onClear);
    on('pg-input', 'input', function () { clearUndo(); scheduleDetection(); });
    on('pg-panel-settings', 'change', onSettingsChange);
    on('pg-findings-body', 'change', onKeepChange);
    on('pg-set-reset', 'click', onReset);
    on('pg-undo', 'click', onUndo);
    on('pg-copy', 'click', onCopy);

    selectTab(storageGet(HELP_KEY) === '1' ? 'redact' : 'help', false);
    updatePreview();
    runDetection();
    if (badSettings) message(MSG.badSettings);
  }

  try { start(); } catch (e) { handleError(e); }
})();
