'use strict';
// Browser smoke test (SPEC 10.3): scenarios P01-P18 in headless Edge (CDP) and Firefox (WebDriver BiDi),
// in file:// mode (double-click equivalent) and http mode (scripts/serve.cjs on 127.0.0.1).
// Usage: node scripts/ui-smoke.cjs [--browser edge|firefox|all] [--mode file|http|all] [--port 4393]
//                                  [--cdp-port 9393] [--bidi-port 9394] [--edge <path>] [--firefox <path>] [--keep]
// Exit codes: 0 = all passed in every browser that ran; 1 = a failure; 2 = no browser could run or invalid arguments.
// Only processes started here are ever stopped (taskkill /PID <pid> /T /F). Port 4317 is refused.
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const B = require('./browser.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESERVED_PORT = 4317;
const VALUE_FLAGS = ['--browser', '--mode', '--port', '--cdp-port', '--bidi-port', '--edge', '--firefox'];
const BOOL_FLAGS = ['--keep'];
const argv = process.argv.slice(2);

function usage(msg) {
  console.error(msg);
  console.error('Usage: node scripts/ui-smoke.cjs [--browser edge|firefox|all] [--mode file|http|all] [--port 4393] ' +
    '[--cdp-port 9393] [--bidi-port 9394] [--edge <path>] [--firefox <path>] [--keep]');
  process.exit(2);
}
const opts = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (BOOL_FLAGS.includes(a)) { opts[a] = true; continue; }
  if (!VALUE_FLAGS.includes(a)) usage('unknown option: ' + a);
  if (i + 1 >= argv.length) usage(a + ' needs a value');
  opts[a] = argv[++i];
}
const BROWSER = String(opts['--browser'] || 'all').toLowerCase();
const MODE = String(opts['--mode'] || 'all').toLowerCase();
const PORT = Number(opts['--port'] || '4393');
const CDP_PORT = Number(opts['--cdp-port'] || '9393');
const BIDI_PORT = Number(opts['--bidi-port'] || '9394');
const KEEP = !!opts['--keep'];
const sleep = B.sleep;

if (typeof WebSocket !== 'function') usage('Node 22+ is required (global WebSocket).');
if (!['edge', 'firefox', 'all'].includes(BROWSER)) usage('--browser must be edge, firefox or all.');
if (!['file', 'http', 'all'].includes(MODE)) usage('--mode must be file, http or all.');
for (const [name, p] of [['--port', PORT], ['--cdp-port', CDP_PORT], ['--bidi-port', BIDI_PORT]]) {
  if (!Number.isInteger(p) || p < 1 || p > 65535) usage(name + ' must be a port number.');
  if (p === RESERVED_PORT) usage('Port ' + RESERVED_PORT + ' is reserved for another local tool; choose another port.');
}

const BROWSERS = BROWSER === 'all' ? ['edge', 'firefox'] : [BROWSER];
const MODES = MODE === 'all' ? ['file', 'http'] : [MODE];
const ORIGIN = 'http://127.0.0.1:' + PORT;
const CSP_META_NODE = require('../js/guard.js').CSP_META;
const SAMPLES = require('../js/samples.js').build();

const children = [];
const results = [];

// ---------------------------------------------------------------- fixtures (SPEC 3.10 and 5)
const G1 = 'Aadhaar 2345 6789 0124, PAN ABCPE1234F, mobile +91 98765 43210, email asha.samplekar@example.com, ' +
  'UPI asha.samplekar@okaxis, IFSC ABCD0123456, a/c 50100012345678, card 4111 1111 1111 1111, GSTIN 27ABCPE1234F1ZB.';
const G1_ROWS = [
  ['AADHAAR', '2345 6789 0124', '0.95'], ['PAN', 'ABCPE1234F', '0.95'], ['PHONE', '+91 98765 43210', '0.99'],
  ['EMAIL', 'asha.samplekar@example.com', '0.95'], ['UPI', 'asha.samplekar@okaxis', '0.95'], ['IFSC', 'ABCD0123456', '0.95'],
  ['BANK_ACCOUNT', '50100012345678', '0.80'], ['CARD', '4111 1111 1111 1111', '0.95'], ['GSTIN', '27ABCPE1234F1ZB', '0.99']
];
const G1_TOKEN = 'Aadhaar [AADHAAR_1], PAN [PAN_1], mobile [PHONE_1], email [EMAIL_1], UPI [UPI_1], IFSC [IFSC_1], ' +
  'a/c [BANK_ACCOUNT_1], card [CARD_1], GSTIN [GSTIN_1].';
const G1_MASK = 'Aadhaar XXXX XXXX XXXX, PAN XXXXXXXXXX, mobile +XX XXXXX XXXXX, email XXXX.XXXXXXXXX@XXXXXXX.XXX, ' +
  'UPI XXXX.XXXXXXXXX@XXXXXX, IFSC XXXXXXXXXXX, a/c XXXXXXXXXXXXXX, card XXXX XXXX XXXX XXXX, GSTIN XXXXXXXXXXXXXXX.';
const G1_PARTIAL = 'Aadhaar XXXX XXXX 0124, PAN XXXXXX234F, mobile +XX XXXXX X3210, email aXXX.XXXXXXXXX@example.com, ' +
  'UPI aXXX.XXXXXXXXX@okaxis, IFSC XXXXXXX3456, a/c XXXXXXXXXX5678, card XXXX XXXX XXXX 1111, GSTIN XXXXXXXXXXXF1ZB.';
const G2_TOKEN = 'Aadhaar [AADHAAR_1] again as [AADHAAR_1] and a second one [AADHAAR_2].';
// G2 is built in the page from the SPEC 5 recipe, so the second number never appears literally in a file.
const G2_EXPR = '(() => { const v = IndiaPIIGuard.validators; const d = "98765432101" + v.verhoeffDigit("98765432101");' +
  ' return "Aadhaar 2345 6789 0124 again as 234567890124 and a second one " + d.slice(0, 4) + " " + d.slice(4, 8) + " " + d.slice(8) + "."; })()';

const MSG_COPIED = 'Copied the redacted text.';
const MSG_COPY_FAIL = 'Copy did not work in this browser. The text is selected; press Ctrl+C (Cmd+C on a Mac).';
const SETTINGS_KEY = 'indiapii-guard.settings.v1';
const HELP_KEY = 'indiapii-guard.helpSeen.v1';
const ALLOWED_KEYS = [HELP_KEY, SETTINGS_KEY];

// ---------------------------------------------------------------- shared preload (SPEC 10.3): CSP violation counter only
const HOOK = '(function () {\n' +
  '  if (window.__smokeHooked) return;\n' +
  '  window.__smokeHooked = true;\n' +
  '  window.__smokeCsp = 0;\n' +
  '  window.addEventListener("securitypolicyviolation", function () { window.__smokeCsp += 1; }, true);\n' +
  '})();';

// P03 only: window.localStorage throws a SecurityError on access.
const BLOCK_STORAGE = '(function () {\n' +
  '  try {\n' +
  '    Object.defineProperty(window, "localStorage", { configurable: true, get: function () {\n' +
  '      throw new DOMException("The operation is insecure.", "SecurityError"); } });\n' +
  '  } catch (e) { /* ignore */ }\n' +
  '})();';

// ---------------------------------------------------------------- helpers
function fail(msg) { throw new Error(msg); }
function check(cond, msg) { if (!cond) fail(msg); }
const J = JSON.stringify;
const byId = B.byId;

function baseUrl(mode) { return mode === 'file' ? pathToFileURL(path.join(ROOT, 'index.html')).href : ORIGIN + '/index.html'; }

const READY = '(() => { const s = document.getElementById("pg-sample-select"); const t = document.getElementById("pg-timing");' +
  ' return !!(window.IndiaPIIGuard && s && s.options.length === 5 && t && t.textContent !== ""); })()';

const PAGE = '(() => {\n' +
  '  const g = (id) => document.getElementById(id);\n' +
  '  const sel = document.querySelector("[role=tab][aria-selected=true]");\n' +
  '  const vis = (id) => { const el = g(id); return !!el && el.getClientRects().length > 0; };\n' +
  '  return {\n' +
  '    tab: sel ? sel.id : null,\n' +
  '    helpHidden: g("pg-panel-help").hidden, redactHidden: g("pg-panel-redact").hidden, settingsHidden: g("pg-panel-settings").hidden,\n' +
  '    helpVisible: vis("pg-panel-help"),\n' +
  '    status: g("pg-status-text").textContent,\n' +
  '    undo: vis("pg-undo"),\n' +
  '    rows: document.querySelectorAll("#pg-findings-body tr").length,\n' +
  '    output: g("pg-output").value,\n' +
  '    input: g("pg-input").value,\n' +
  '    active: document.activeElement ? document.activeElement.id : null,\n' +
  '    flag: (function () { try { return localStorage.getItem("' + HELP_KEY + '"); } catch (e) { return "blocked"; } })()\n' +
  '  };\n' +
  '})()';
const page = (d) => d.evaluate(PAGE);
const text = (d, id) => d.evaluate('(' + byId(id) + ' || {}).textContent');

async function harvestCsp(d) {
  try { const n = await d.evaluate('typeof window.__smokeCsp === "number" ? window.__smokeCsp : 0'); d.cspTotal += Number(n) || 0; } catch (e) { /* no page */ }
}

async function waitReady(d, what) {
  const ok = await B.waitFor(() => d.evaluate(READY), 10000, 100);
  check(ok, 'the app did not start (' + what + ')');
}

async function open(d, url) {
  await harvestCsp(d);
  await d.goto('about:blank');
  await d.goto(url);
  await waitReady(d, url.slice(0, 5));
}

// Clears localStorage in the app's own origin (SPEC 10.3 preamble): load the app, clear, then the caller reloads.
async function clearStorage(d, mode) {
  await open(d, baseUrl(mode));
  return d.evaluate('(() => { try { localStorage.clear(); return localStorage.length === 0 ? "ok" : "length " + localStorage.length; } catch (e) { return "threw " + e.name; } })()');
}

// "#pg-timing changes": a MutationObserver counts every rewrite of its text (the UI rewrites it after each detection,
// even when the new text equals the old one). Arm before the action, then wait (poll 50 ms, timeout 5 s).
const ARM = '(() => { const el = document.getElementById("pg-timing"); if (window.__smokeObs) window.__smokeObs.disconnect();' +
  ' window.__smokeTiming = 0; window.__smokeObs = new MutationObserver(function () { window.__smokeTiming += 1; });' +
  ' window.__smokeObs.observe(el, { childList: true, characterData: true, subtree: true }); return true; })()';
async function arm(d) { await d.evaluate(ARM); }
async function waitTiming(d, what) {
  const ok = await B.waitFor(() => d.evaluate('window.__smokeTiming > 0'), 5000, 50);
  check(ok, '#pg-timing did not change within 5 s (' + what + ')');
}

// Sets #pg-input to a value (string or page expression) and dispatches input, then waits for the detection.
async function setInput(d, value, isExpr) {
  await arm(d);
  await d.evaluate('(() => { const el = document.getElementById("pg-input"); el.value = ' + (isExpr ? value : J(value)) + ';' +
    ' el.dispatchEvent(new Event("input", { bubbles: true })); return el.value.length; })()');
  await waitTiming(d, 'input');
}

async function click(d, id) { await B.clickEl(d, byId(id)); await sleep(60); }
// Clicks a control whose handler runs a detection, and waits for it.
async function clickDetect(d, id) { await arm(d); await B.clickEl(d, byId(id)); await waitTiming(d, 'click ' + id); }

async function tab(d, name) {
  await click(d, 'pg-tab-' + name);
  const sel = await d.evaluate(byId('pg-tab-' + name) + '.getAttribute("aria-selected")');
  check(sel === 'true', name + ' tab not selected after click');
}

async function rowCount(d) { return d.evaluate('document.querySelectorAll("#pg-findings-body tr").length'); }
async function output(d) { return d.evaluate(byId('pg-output') + '.value'); }

async function waitStatus(d, accepted, ms) {
  return B.waitFor(async () => { const s = await text(d, 'pg-status-text'); return accepted.includes(s) ? s : null; }, ms || 5000, 50);
}

async function selectSample(d, id) {
  await d.evaluate('(() => { const s = ' + byId('pg-sample-select') + '; s.value = ' + J(id) + '; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()');
}

async function typeText(d, s) { for (const ch of s) await d.press(ch); }

const DUP_IDS = '(() => { const seen = Object.create(null), dup = []; for (const el of document.querySelectorAll("[id]")) { if (seen[el.id]) dup.push(el.id); seen[el.id] = 1; } return dup; })()';

// ---------------------------------------------------------------- scenarios
const SCENARIOS = [
  { id: 'P01', name: 'first visit', fn: async (d, mode, ctx) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'storage clear: ' + c);
    await d.reload();
    await waitReady(d, 'reload');
    const p = await page(d);
    check(p.tab === 'pg-tab-help', 'selected tab ' + p.tab);
    check(p.helpVisible && !p.helpHidden, 'Help panel not visible');
    check(p.redactHidden && p.settingsHidden, 'other panels not hidden');
    check(await d.evaluate(byId('pg-tab-help') + '.getAttribute("aria-selected")') === 'true', 'aria-selected');
    ctx.noErrors();
  } },
  { id: 'P02', name: 'help seen persists', fn: async (d) => {
    await click(d, 'pg-help-start');
    let p = await page(d);
    check(p.tab === 'pg-tab-redact', 'after Start redacting: ' + p.tab);
    await harvestCsp(d);
    await d.reload();
    await waitReady(d, 'reload');
    p = await page(d);
    check(p.tab === 'pg-tab-redact', 'after reload: ' + p.tab);
    check(p.flag === '1', 'flag = ' + p.flag);
  } },
  { id: 'P03', name: 'storage blocked', fn: async (d, mode, ctx) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'storage clear: ' + c);
    const h = await d.addPreload(BLOCK_STORAGE);
    try {
      await harvestCsp(d);
      await d.reload();
      await waitReady(d, 'reload with storage blocked');
      const blocked = await d.evaluate('(() => { try { void window.localStorage; return false; } catch (e) { return e.name; } })()');
      check(blocked === 'SecurityError', 'storage was not blocked: ' + blocked);
      let p = await page(d);
      check(p.tab === 'pg-tab-help', 'selected tab ' + p.tab);
      await tab(d, 'redact');
      await setInput(d, G1);
      p = await page(d);
      check(p.rows === 9, 'rows ' + p.rows);
      check(p.status === '9 items found.' || p.status === '', 'unexpected status ' + J(p.status));
      ctx.noErrors();
    } finally {
      await d.removePreload(h);
    }
  } },
  { id: 'P04', name: 'samples', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    for (const s of SAMPLES) {
      await selectSample(d, s.id);
      await clickDetect(d, 'pg-sample-load');
      const r = await d.evaluate('(() => { const t = document.getElementById("pg-input").value; const n = document.getElementById("pg-sample-note");' +
        ' return { text: t, rows: document.querySelectorAll("#pg-findings-body tr").length, inPage: IndiaPIIGuard.detect(t).findings.length,' +
        ' note: !n.hidden && n.getClientRects().length > 0, out: document.getElementById("pg-output").value }; })()');
      const gold = s.gold.filter((g) => !g.knownMiss);
      check(r.text === s.text, s.id + ': text differs from samples.build()');
      check(r.rows === r.inPage, s.id + ': rows ' + r.rows + ' vs detect ' + r.inPage);
      check(r.rows === gold.length, s.id + ': rows ' + r.rows + ' vs gold ' + gold.length);
      check(r.note, s.id + ': sample note not visible');
      for (const g of gold) check(!r.out.includes(s.text.slice(g.start, g.end)), s.id + ': output contains a ' + g.entity + ' gold value');
    }
  } },
  { id: 'P05', name: 'paste-detect-redact-copy', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    await setInput(d, G1);
    const t = await d.evaluate('[...document.querySelectorAll("#pg-findings-body tr")].map((tr) => [tr.getAttribute("data-entity"),' +
      ' tr.children[2].textContent, tr.children[3].textContent])');
    check(J(t) === J(G1_ROWS), 'rows ' + J(t));
    check(await output(d) === G1_TOKEN, 'token output ' + J(await output(d)));
    const marks = await d.evaluate('(() => { const ms = [...document.querySelectorAll("#pg-highlight mark")];' +
      ' return { n: ms.length, tags: ms.filter((m) => { const s = m.nextSibling; return s && s.className === "pg-tag" &&' +
      ' s.textContent.length > 2 && s.getClientRects().length > 0; }).length }; })()');
    check(marks.n === 9 && marks.tags === 9, 'marks ' + J(marks));
    await click(d, 'pg-copy');
    const s = await waitStatus(d, [MSG_COPIED, MSG_COPY_FAIL], 6000);
    check(s, 'no copy status: ' + J(await text(d, 'pg-status-text')));
  } },
  { id: 'P06', name: 'consistent tokens', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    await setInput(d, G2_EXPR, true);
    check(await output(d) === G2_TOKEN, 'G2 output ' + J(await output(d)));
  } },
  { id: 'P07', name: 'toggles', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'settings');
    await clickDetect(d, 'pg-set-ent-phone');
    check(await d.evaluate(byId('pg-set-ent-phone') + '.checked') === false, 'phone still ticked');
    await tab(d, 'redact');
    await setInput(d, G1);
    let n = await rowCount(d);
    check(n === 8, 'rows with PHONE off ' + n);
    const out = await output(d);
    check(out.includes('+91 98765 43210') && !out.includes('[PHONE_1]'), 'output ' + J(out));
    await tab(d, 'settings');
    await clickDetect(d, 'pg-set-ent-phone');
    await tab(d, 'redact');
    n = await rowCount(d);
    check(n === 9, 'rows after re-tick ' + n);
  } },
  { id: 'P08', name: 'styles', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    await setInput(d, G1);
    await tab(d, 'settings');
    const pre0 = await text(d, 'pg-set-preview');
    check(pre0 === 'Preview: Aadhaar 2345 6789 0124 -> [AADHAAR_1]', 'preview ' + J(pre0));
    await clickDetect(d, 'pg-set-style-mask');
    check(await output(d) === G1_MASK, 'mask output ' + J(await output(d)));
    const pre1 = await text(d, 'pg-set-preview');
    check(pre1 === 'Preview: Aadhaar 2345 6789 0124 -> XXXX XXXX XXXX', 'mask preview ' + J(pre1));
    await clickDetect(d, 'pg-set-style-partial');
    check(await output(d) === G1_PARTIAL, 'partial output ' + J(await output(d)));
    const pre2 = await text(d, 'pg-set-preview');
    check(pre2 === 'Preview: Aadhaar 2345 6789 0124 -> XXXX XXXX 0124', 'partial preview ' + J(pre2));
  } },
  { id: 'P09', name: 'threshold', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    await setInput(d, 'reach 98 76 54 32 10 today');
    let n = await rowCount(d);
    check(n === 0, 'Balanced rows ' + n);
    await tab(d, 'settings');
    await clickDetect(d, 'pg-set-th-lenient');
    n = await rowCount(d);
    check(n === 1, 'Lenient rows ' + n);
    await clickDetect(d, 'pg-set-th-balanced');
    await tab(d, 'redact');
    await setInput(d, 'card 9876543210');
    n = await rowCount(d);
    check(n === 1, 'card text at Balanced: rows ' + n);
    await tab(d, 'settings');
    await clickDetect(d, 'pg-set-th-strict');
    n = await rowCount(d);
    check(n === 0, 'card text at Strict: rows ' + n);
  } },
  { id: 'P10', name: 'keep unredacted', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    await setInput(d, G1);
    await clickDetect(d, 'pg-keep-f1');
    const KEPT = 'Kept Aadhaar number unredacted (1 occurrence).';
    let out = await output(d);
    check(out.includes('2345 6789 0124') && out.includes('[PAN_1]'), 'output ' + J(out));
    const kept = await d.evaluate('document.querySelector("#pg-highlight mark").classList.contains("pg-kept")');
    check(kept, 'first mark not pg-kept');
    let s = await text(d, 'pg-status-text');
    check(s === KEPT, 'status ' + J(s));
    // NIT 2: "the next detection" = an input event without a value change; the count announcement must be dropped.
    await arm(d);
    await d.evaluate(byId('pg-input') + '.dispatchEvent(new Event("input", { bubbles: true }))');
    await waitTiming(d, 'next detection');
    s = await text(d, 'pg-status-text');
    check(s === KEPT, 'status after the next detection ' + J(s));
    await clickDetect(d, 'pg-keep-f1');
    out = await output(d);
    check(out.includes('[AADHAAR_1]'), 'output after re-tick ' + J(out));
    s = await text(d, 'pg-status-text');
    check(s === 'Redacting Aadhaar number again (1 occurrence).', 'status after re-tick ' + J(s));
    await setInput(d, G2_EXPR, true);
    await clickDetect(d, 'pg-keep-f1');
    const st = await d.evaluate('[1, 2, 3].map((i) => document.getElementById("pg-keep-f" + i).checked)');
    check(J(st) === J([false, false, true]), 'G2 checkbox states ' + J(st));
    s = await text(d, 'pg-status-text');
    check(s === 'Kept Aadhaar number unredacted (2 occurrences).', 'G2 status ' + J(s));
  } },
  { id: 'P11', name: 'too long', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    await setInput(d, '"ab ".repeat(66667)', true);
    const len = await d.evaluate(byId('pg-input') + '.value.length');
    check(len === 200001, 'length ' + len);
    const r = await d.evaluate('(() => { const e = document.getElementById("pg-input-err"); return { err: !e.hidden && e.getClientRects().length > 0,' +
      ' msg: e.textContent, inv: document.getElementById("pg-input").getAttribute("aria-invalid"),' +
      ' rows: document.querySelectorAll("#pg-findings-body tr").length, copy: document.getElementById("pg-copy").disabled }; })()');
    check(r.err, 'error not visible');
    check(r.msg === 'This text has 200,001 characters. The limit is 200,000; split it into parts.', 'message ' + J(r.msg));
    check(r.inv === 'true', 'aria-invalid ' + r.inv);
    check(r.rows === 0, 'rows ' + r.rows);
    check(r.copy === true, 'copy not disabled');
    await setInput(d, '"ab ".repeat(66666) + "ab"', true);
    const r2 = await d.evaluate('(() => { const e = document.getElementById("pg-input-err"); return { len: document.getElementById("pg-input").value.length,' +
      ' hidden: e.hidden, timing: document.getElementById("pg-timing").textContent }; })()');
    check(r2.len === 200000, 'length ' + r2.len);
    check(r2.hidden, 'error still visible at 200,000');
    check(/^Checked in \d+\.\d ms\.$/.test(r2.timing), 'timing ' + J(r2.timing));
  } },
  { id: 'P12', name: 'undo', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    let p = await page(d);
    check(!p.undo, 'undo visible at start');
    await click(d, 'pg-input');
    await typeText(d, 'hell');
    await arm(d);
    await d.press('o');
    await waitTiming(d, 'typing');
    p = await page(d);
    check(p.input === 'hello', 'typed ' + J(p.input));
    await selectSample(d, 'support-ticket');
    await clickDetect(d, 'pg-sample-load');
    p = await page(d);
    check(p.status === 'Text replaced.' && p.undo, 'after load: ' + J({ status: p.status, undo: p.undo }));
    await clickDetect(d, 'pg-undo');
    p = await page(d);
    check(p.input === 'hello', 'undo gave ' + J(p.input));
    check(p.status === 'Undone.' && !p.undo, 'after undo: ' + J({ status: p.status, undo: p.undo }));
    check(p.active === 'pg-input', 'focus after undo ' + p.active);
    await clickDetect(d, 'pg-sample-load');
    p = await page(d);
    check(p.undo, 'undo not visible after the second load');
    await click(d, 'pg-input');
    await arm(d);
    await d.press('z');
    p = await page(d);
    check(!p.undo, 'undo still visible after typing');
    await waitTiming(d, 'typing one character');
    await tab(d, 'settings');
    await clickDetect(d, 'pg-set-style-mask');
    await clickDetect(d, 'pg-set-reset');
    p = await page(d);
    const tok = await d.evaluate(byId('pg-set-style-token') + '.checked');
    check(tok, 'token not selected after reset');
    check(p.status === 'Settings reset.' && p.undo, 'after reset: ' + J({ status: p.status, undo: p.undo }));
    await clickDetect(d, 'pg-undo');
    p = await page(d);
    const mask = await d.evaluate(byId('pg-set-style-mask') + '.checked');
    check(mask, 'mask not selected after undo');
    check(p.status === 'Undone.' && !p.undo, 'after settings undo: ' + J({ status: p.status, undo: p.undo }));
    check(p.active === 'pg-set-reset', 'focus after settings undo ' + p.active);
    await tab(d, 'redact');
    const before = (await page(d)).input;
    check(before.length > 0, 'input empty before Clear');
    await clickDetect(d, 'pg-clear');
    p = await page(d);
    check(p.status === 'Text replaced.' && p.undo && p.input === '', 'after first Clear: ' + J({ status: p.status, undo: p.undo }));
    await click(d, 'pg-clear');
    p = await page(d);
    check(p.status === 'Nothing changed.' && p.undo, 'after second Clear: ' + J({ status: p.status, undo: p.undo }));
    await clickDetect(d, 'pg-undo');
    p = await page(d);
    check(p.input === before, 'undo after Clear did not restore the text');
  } },
  { id: 'P13', name: 'keyboard tabs', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await click(d, 'pg-title'); // a real click gives the page keyboard focus
    await d.evaluate(byId('pg-tab-help') + '.focus()');
    const state = () => d.evaluate('(() => { const a = document.activeElement; const sel = document.querySelector("[role=tab][aria-selected=true]");' +
      ' return { active: a ? a.id : null, selected: sel ? sel.id : null }; })()');
    await d.press('ArrowRight');
    let s = await state();
    check(s.active === 'pg-tab-redact' && s.selected === 'pg-tab-redact', 'ArrowRight ' + J(s));
    await d.press('End');
    s = await state();
    check(s.active === 'pg-tab-settings' && s.selected === 'pg-tab-settings', 'End ' + J(s));
    await d.press('Home');
    s = await state();
    check(s.active === 'pg-tab-help' && s.selected === 'pg-tab-help', 'Home ' + J(s));
  } },
  { id: 'P14', name: 'responsive', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    await selectSample(d, 'support-ticket');
    await clickDetect(d, 'pg-sample-load');
    await d.setViewport(375, 800);
    try {
      await sleep(300);
      const fits = () => d.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })');
      let r = await fits();
      check(r.iw <= 400, 'viewport not applied: innerWidth ' + r.iw);
      check(r.sw <= r.iw + 1, 'Redact overflows: scrollWidth ' + r.sw + ' > ' + r.iw);
      await tab(d, 'settings');
      await sleep(200);
      r = await fits();
      check(r.sw <= r.iw + 1, 'Settings overflows: scrollWidth ' + r.sw + ' > ' + r.iw);
    } finally {
      await d.setViewport(1400, 1000);
    }
  } },
  { id: 'P15', name: 'no network, no CSP violations', fn: async (d, mode, ctx) => {
    await harvestCsp(d);
    const allowed = mode === 'file' ? (u) => u.startsWith('file:') : (u) => u.startsWith(ORIGIN + '/');
    const bad = d.requests.slice(ctx.requestStart).filter((u) => !/\/favicon\.ico(\?|$)/.test(u) && u !== 'about:blank' && !allowed(u));
    check(bad.length === 0, 'unexpected requests: ' + bad.slice(0, 5).map((u) => u.slice(0, 80)).join(', '));
    // Sanity check that the recorder works. Firefox's BiDi network module reports no file:// loads, so file mode is exempt.
    if (mode === 'http') check(d.requests.length > ctx.requestStart, 'no requests recorded');
    const cspMeta = await d.evaluate('window.IndiaPIIGuard ? window.IndiaPIIGuard.CSP_META : null');
    check(cspMeta === CSP_META_NODE, 'CSP_META in page ' + cspMeta);
    if (cspMeta) check(d.cspTotal === ctx.cspStart, 'securitypolicyviolation events: ' + (d.cspTotal - ctx.cspStart));
  } },
  { id: 'P16', name: 'accessibility basics and focus', fn: async (d, mode) => {
    await open(d, baseUrl(mode));
    await tab(d, 'redact');
    await setInput(d, G1);
    const a = await d.evaluate('(() => {\n' +
      '  const unlabelled = [];\n' +
      '  for (const el of document.querySelectorAll("input, select, textarea")) {\n' +
      '    const named = (el.id && document.querySelector("label[for=\\"" + el.id + "\\"]")) || el.getAttribute("aria-label") ||\n' +
      '      el.getAttribute("aria-labelledby");\n' +
      '    if (!named) unlabelled.push(el.id || el.name || el.tagName);\n' +
      '  }\n' +
      '  const panels = [...document.querySelectorAll("[role=tabpanel]")].filter((p) => {\n' +
      '    const ref = p.getAttribute("aria-labelledby"); const t = ref && document.getElementById(ref);\n' +
      '    return !(t && t.textContent.trim()) && !p.getAttribute("aria-label");\n' +
      '  }).map((p) => p.id);\n' +
      '  return { unlabelled, panels, lang: document.documentElement.getAttribute("lang"), h1: document.querySelectorAll("h1").length };\n' +
      '})()');
    check(a.unlabelled.length === 0, 'unlabelled controls ' + a.unlabelled.join(','));
    check(a.panels.length === 0, 'panels without a name ' + a.panels.join(','));
    check(a.lang === 'en', 'lang ' + a.lang);
    check(a.h1 === 1, 'h1 count ' + a.h1);
    const dups = await d.evaluate(DUP_IDS);
    check(dups.length === 0, 'duplicate ids ' + dups.join(','));

    // Precondition: the document must have focus, or no :focus rule can match in any browser (harness state, not the app).
    check(await d.evaluate('document.hasFocus()'), 'the browser window has no focus');
    await click(d, 'pg-title');
    const SEL = 'a[href], button, input, select, textarea, summary, [tabindex="0"]';
    const FOCUS = '(() => { const el = document.activeElement; if (!el || el === document.body) return null; const cs = getComputedStyle(el);\n' +
      '  const p = el.closest("[role=tabpanel]");\n' +
      '  const key = el.id || (p ? "idx" + [...p.querySelectorAll(' + J(SEL) + ')].indexOf(el) : el.tagName);\n' +
      '  return { id: el.id || "", key, tag: el.tagName.toLowerCase(), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) || 0,\n' +
      '    panel: p ? p.id : null }; })()';
    const VISIBLE = (panel) => '(() => [...document.getElementById(' + J(panel) + ').querySelectorAll(' + J(SEL) + ')]\n' +
      '  .map((el, i) => ({ el, key: el.id || "idx" + i }))\n' +
      '  .filter(({ el }) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0) &&\n' +
      '    !el.disabled && el.tabIndex >= 0 && !(el.type === "radio" && !el.checked))\n' +
      '  .map(({ key }) => key))()';
    const problems = [];
    const ORDER = ['help', 'redact', 'settings'];
    for (let k = 0; k < ORDER.length; k++) {
      const name = ORDER[k];
      const panel = 'pg-panel-' + name;
      // Select the panel's tab with a real ArrowRight from the previous tab (keyboard focus matches :focus-visible).
      await d.evaluate(byId('pg-tab-' + ORDER[(k + ORDER.length - 1) % ORDER.length]) + '.focus()');
      await d.press('ArrowRight');
      const t = await d.evaluate(FOCUS);
      if (!t || t.id !== 'pg-tab-' + name) { problems.push('ArrowRight did not focus pg-tab-' + name); continue; }
      if (t.style === 'none' || t.width < 2) problems.push(t.id + ' outline ' + t.style + ' ' + t.width);
      const want = await d.evaluate(VISIBLE(panel));
      const reached = new Set();
      for (let i = 0; i < 300; i++) {
        await d.press('Tab');
        const fx = await d.evaluate(FOCUS);
        if (!fx || fx.panel !== panel) break;
        if (fx.style === 'none' || fx.width < 2) problems.push((fx.id || fx.tag) + ' outline ' + fx.style + ' ' + fx.width);
        reached.add(fx.key);
        // Stop at the panel's last control: one more Tab would leave the document (there is nothing focusable
        // after the panels), and focus outside the page would break the following key presses.
        if (want.every((id) => reached.has(id))) break;
      }
      const missed = want.filter((id) => !reached.has(id));
      if (missed.length) problems.push(name + ': not reached by Tab: ' + missed.join(','));
      if (reached.size === 0) problems.push(name + ': no element reached');
    }
    check(problems.length === 0, problems.slice(0, 8).join('; '));
  } },
  { id: 'P18', name: 'privacy', fn: async (d, mode) => {
    const c = await clearStorage(d, mode);
    check(c === 'ok', 'storage clear: ' + c);
    await d.reload();
    await waitReady(d, 'reload');
    await tab(d, 'redact');
    await setInput(d, G1);
    await tab(d, 'settings');
    await clickDetect(d, 'pg-set-style-mask');
    await clickDetect(d, 'pg-set-th-strict');
    const dump = () => d.evaluate('(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })()');
    let st = await dump();
    let keys = Object.keys(st);
    check(keys.every((k) => ALLOWED_KEYS.includes(k)), 'unexpected keys ' + J(keys));
    check(!keys.includes(SETTINGS_KEY), 'settings stored with Remember off');
    await clickDetect(d, 'pg-set-remember');
    st = await dump();
    keys = Object.keys(st);
    check(keys.every((k) => ALLOWED_KEYS.includes(k)), 'unexpected keys ' + J(keys));
    let parsed = null;
    try { parsed = JSON.parse(st[SETTINGS_KEY]); } catch (e) { parsed = null; }
    check(parsed && parsed.v === 1 && parsed.style === 'mask' && parsed.threshold === 'strict' && parsed.remember === true &&
      parsed.ocr === true && parsed.entities && Object.keys(parsed.entities).length === 9, 'stored settings ' + J(st[SETTINGS_KEY]));
    for (const k of keys) for (const r of G1_ROWS) check(!String(st[k]).includes(r[1]), 'stored value contains G1 text');
    check(!Object.values(st).some((v) => String(v).includes(G1.slice(0, 20))), 'stored value contains the input');
    await clickDetect(d, 'pg-set-remember');
    st = await dump();
    check(!Object.keys(st).includes(SETTINGS_KEY), 'settings key not removed by Remember off');
    const lc = await d.evaluate('({ hash: location.hash, cookie: document.cookie })');
    check(lc.hash === '' && lc.cookie === '', 'hash/cookie ' + J(lc));
  } }
];

// ---------------------------------------------------------------- runner
function report(browser, mode, id, name, ok, detail) {
  results.push({ browser, mode, id, ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + browser + ' ' + mode + ' ' + id + ' ' + name + (ok ? '' : ' - ' + detail));
}

async function runMode(d, mode) {
  const ctx = { requestStart: d.requests.length, cspStart: d.cspTotal };
  const p17 = [];
  for (const sc of SCENARIOS) {
    const errStart = d.errors.length;
    ctx.noErrors = () => { const e = d.errors.slice(errStart); check(e.length === 0, 'errors: ' + e.slice(0, 3).join(' | ')); };
    let ok = true;
    let detail = '';
    try {
      await sc.fn(d, mode, ctx);
    } catch (e) { ok = false; detail = String((e && e.message) || e).split('\n')[0]; }
    await sleep(100);
    const errs = d.errors.slice(errStart);
    let dups = [];
    try { dups = await d.evaluate(DUP_IDS); } catch (e) { /* page gone */ }
    if (errs.length) p17.push(sc.id + ' errors: ' + errs.slice(0, 3).join(' | '));
    if (dups && dups.length) p17.push(sc.id + ' duplicate ids: ' + dups.join(','));
    report(d.name, mode, sc.id, sc.name, ok, detail);
  }
  // P17 covers every scenario of the mode (P18 included), so it is reported last.
  report(d.name, mode, 'P17', 'no errors', p17.length === 0, p17.join('; '));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const probe = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      reject(new Error('port ' + PORT + ' is already in use; choose another --port'));
    });
    probe.on('timeout', () => probe.destroy(new Error('timeout')));
    probe.on('error', () => {
      const proc = spawn(process.execPath, [path.join(__dirname, 'serve.cjs'), '--port', String(PORT), '--root', ROOT], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(proc);
      let out = '';
      proc.stdout.on('data', (c) => { out += c; });
      proc.stderr.on('data', (c) => { out += c; });
      B.waitFor(() => new Promise((ok) => {
        const r = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1000 }, (res) => { res.resume(); ok(res.statusCode === 200); });
        r.on('error', () => ok(false));
        r.on('timeout', () => { r.destroy(); ok(false); });
      }), 8000, 200).then((up) => (up ? resolve(proc) : reject(new Error('serve.cjs did not start: ' + out.slice(-200)))));
    });
  });
}

function cleanup() { for (const p of children) B.killTree(p); }

async function main() {
  const watchdog = setTimeout(() => { console.error('Smoke test timed out after 20 minutes.'); cleanup(); process.exit(1); }, 20 * 60 * 1000);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  if (MODES.includes('http')) {
    try { await startServer(); } catch (e) { console.error('Cannot run http mode: ' + e.message); cleanup(); process.exit(2); }
  }
  let ran = 0;
  for (const name of BROWSERS) {
    const exe = B.resolveExe(name, opts['--' + name]);
    if (!exe) { console.log('SKIP ' + name + ': executable not found'); continue; }
    let d;
    try {
      d = name === 'edge' ? await B.openEdge(exe, { cdpPort: CDP_PORT, keep: KEEP }) : await B.openFirefox(exe, { bidiPort: BIDI_PORT, keep: KEEP });
    } catch (e) {
      console.log('SKIP ' + name + ': could not start (' + String(e.message).split('\n')[0] + ')');
      continue;
    }
    children.push(d.proc);
    ran++;
    d.cspTotal = 0;
    console.log('# ' + name + ': ' + (d.version || d.label));
    try {
      await d.addPreload(HOOK); // registered once per browser, never removed
      for (const mode of MODES) await runMode(d, mode);
    } catch (e) {
      report(name, '-', 'P00', 'driver', false, String(e.message).split('\n')[0]);
    } finally {
      try { await d.close(); } catch (e) { /* killed in cleanup */ }
    }
  }
  cleanup();
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('Summary: ' + results.length + ' checks, ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed; browsers run: ' + ran + '.');
  if (ran === 0) { console.log('No browser could run.'); process.exit(2); }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error((e && e.stack) || e); cleanup(); process.exit(1); });
