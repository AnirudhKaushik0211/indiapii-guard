'use strict';
// Screenshot capture (SPEC 10.5):
//   node scripts/capture-screenshots.cjs [--out docs] [--edge <path>] [--cdp-port 9393]
// Headless Edge via CDP, file:// mode (no server), viewport 1440x900, deviceScaleFactor 1, fresh profile, default
// settings. Before each shot the page's visible text is checked against the deny-list (SPEC 11.3, including
// .denylist.local when present) and the OS user name; any hit refuses the shot and exits 1 without printing the term.
// Each shot clips #pg-main (height capped at 3,000 px); the token-map shot clips #pg-map.
// A person must still look at every image before publishing (pixels can't be scanned).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const B = require('./browser.cjs');
const deny = require('./denylist.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESERVED_PORT = 4317;
const USAGE = 'Usage: node scripts/capture-screenshots.cjs [--out docs] [--edge <path>] [--cdp-port 9393]';
const MAX_HEIGHT = 3000;
const J = JSON.stringify;
const byId = B.byId;
const sleep = B.sleep;

function usage(msg) { console.error(msg + '\n' + USAGE); process.exit(2); }

function parseArgs(argv) {
  const o = { out: 'docs', edge: null, cdpPort: 9393 };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== '--out' && a !== '--edge' && a !== '--cdp-port') usage('unknown option: ' + a);
    if (seen.has(a)) usage(a + ' given twice');
    seen.add(a);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) usage(a + ' needs a value');
    i++;
    if (a === '--out') o.out = val;
    else if (a === '--edge') o.edge = val;
    else o.cdpPort = Number(val);
  }
  if (!Number.isInteger(o.cdpPort) || o.cdpPort < 1024 || o.cdpPort > 65535) usage('--cdp-port must be an integer from 1024 to 65535');
  if (o.cdpPort === RESERVED_PORT) usage('Port ' + RESERVED_PORT + ' is reserved for another local tool; choose another port.');
  return o;
}

const ARGS = parseArgs(process.argv.slice(2));
const OUT = path.resolve(ROOT, ARGS.out);

if (typeof WebSocket !== 'function') { console.error('Node 22+ is required (global WebSocket).'); process.exit(2); }

function matchers() {
  const terms = deny.loadTerms({ root: ROOT }).terms.slice();
  let user = '';
  try { user = os.userInfo().username || ''; } catch (e) { /* no user name available */ }
  if (user) terms.push(user);
  return deny.buildMatchers(terms);
}

const READY = '(() => { const s = document.getElementById("pg-sample-select"); const t = document.getElementById("pg-timing");' +
  ' return !!(window.IndiaPIIGuard && s && s.options.length === 5 && t && t.textContent !== ""); })()';

async function open(d, url) {
  await d.goto('about:blank');
  await d.goto(url);
  const ready = await B.waitFor(() => d.evaluate(READY), 10000, 100);
  if (!ready) throw new Error('the app did not start');
}

// "#pg-timing changes": count every rewrite with a MutationObserver armed before the action.
const ARM = '(() => { const el = document.getElementById("pg-timing"); if (window.__shotObs) window.__shotObs.disconnect();' +
  ' window.__shotTiming = 0; window.__shotObs = new MutationObserver(function () { window.__shotTiming += 1; });' +
  ' window.__shotObs.observe(el, { childList: true, characterData: true, subtree: true }); return true; })()';

async function waitTiming(d, what) {
  const ok = await B.waitFor(() => d.evaluate('window.__shotTiming > 0'), 5000, 50);
  if (!ok) throw new Error('#pg-timing did not change within 5 s (' + what + ')');
}

async function click(d, id) { await B.clickEl(d, byId(id)); await sleep(150); }

const selectedTab = (d) => d.evaluate('(() => { const t = document.querySelector("[role=tab][aria-selected=true]"); return t ? t.id : null; })()');

async function showTab(d, name) {
  await click(d, 'pg-tab-' + name);
  if ((await selectedTab(d)) !== 'pg-tab-' + name) throw new Error('the ' + name + ' tab was not selected');
}

async function loadSample(d, id) {
  await showTab(d, 'redact');
  await d.evaluate('(() => { const s = ' + byId('pg-sample-select') + '; s.value = ' + J(id) + ';' +
    ' s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()');
  await d.evaluate(ARM);
  await click(d, 'pg-sample-load');
  await waitTiming(d, 'sample ' + id);
  const rows = await d.evaluate('document.querySelectorAll("#pg-findings-body tr").length');
  if (!rows) throw new Error('sample ' + id + ' rendered no findings');
  await sleep(200);
}

// captureBeyondViewport grows the viewport to the page height, which removes the vertical scrollbar and moves the
// centred layout sideways after the clip was measured. Hiding the scrollbar (screenshot session only) keeps the
// layout identical in both states. A constructed stylesheet, because the page's CSP blocks injected <style> elements.
const HIDE_SCROLLBAR = '(() => { if (window.__pgShotSheet) return true; const s = new CSSStyleSheet();' +
  ' s.replaceSync("html { scrollbar-width: none; } ::-webkit-scrollbar { width: 0; height: 0; }");' +
  ' document.adoptedStyleSheets = document.adoptedStyleSheets.concat([s]); window.__pgShotSheet = s; return true; })()';

async function shot(d, M, file, elId) {
  await d.evaluate(HIDE_SCROLLBAR);
  await d.evaluate('window.scrollTo(0, 0)');
  await sleep(200);
  const visibleText = await d.evaluate('document.body.innerText');
  if (deny.textHasHit(visibleText, M)) {
    throw Object.assign(new Error('REFUSED: the visible text for ' + file + ' contains a deny-list term or the user name.'), { refused: true });
  }
  const box = await d.evaluate('(() => { const el = ' + byId(elId) + '; if (!el) return null; const r = el.getBoundingClientRect();' +
    ' return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }; })()');
  if (!box || !box.width || !box.height) throw new Error('#' + elId + ' is not visible for ' + file);
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.min(MAX_HEIGHT, Math.ceil(box.height)) };
  const png = await d.screenshot({ clip, captureBeyondViewport: true });
  const hits = [];
  deny.scanPng(file, png, M, hits);
  if (hits.length) throw Object.assign(new Error('REFUSED: ' + hits[0]), { refused: true });
  fs.writeFileSync(path.join(OUT, file), png);
  console.log('Saved ' + path.relative(ROOT, path.join(OUT, file)).replace(/\\/g, '/') + ' (' + clip.width + 'x' + clip.height + ')');
}

const SAMPLE_SHOTS = [
  ['support-ticket', 'screenshot-support-ticket.png'],
  ['hr-form', 'screenshot-hr-form.png'],
  ['chat-log', 'screenshot-chat-log.png'],
  ['hinglish', 'screenshot-hinglish.png'],
  ['ocr-noisy', 'screenshot-ocr-noisy.png']
];

async function main() {
  const exe = B.resolveExe('edge', ARGS.edge);
  if (!exe) { console.error('Microsoft Edge was not found. Pass --edge <path> or set EDGE_PATH.'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const M = matchers();
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
  const d = await B.openEdge(exe, { cdpPort: ARGS.cdpPort });
  let code = 0;
  try {
    console.log('Browser: ' + d.version);
    await d.setViewport(1440, 900);

    // Help, first visit: clear storage in the app's own origin, then reload.
    await open(d, url);
    await d.evaluate('localStorage.clear()');
    await open(d, url);
    if ((await selectedTab(d)) !== 'pg-tab-help') throw new Error('the first visit did not open the Help tab');
    await shot(d, M, 'screenshot-help.png', 'pg-main');

    for (const [id, file] of SAMPLE_SHOTS) {
      await loadSample(d, id);
      await shot(d, M, file, 'pg-main');
    }

    // Token map for the support-ticket sample.
    await loadSample(d, 'support-ticket');
    await d.evaluate('(() => { const m = ' + byId('pg-map') + '; m.open = true; return m.open; })()');
    await sleep(200);
    const mapRows = await d.evaluate('document.querySelectorAll("#pg-map-body tr").length');
    if (!mapRows) throw new Error('the token map is empty');
    await shot(d, M, 'screenshot-token-map.png', 'pg-map');
    await d.evaluate(byId('pg-map') + '.open = false');

    await showTab(d, 'settings');
    await shot(d, M, 'screenshot-settings.png', 'pg-main');

    if (d.errors.length) { console.error('Page errors: ' + d.errors.length + '; first: ' + String(d.errors[0]).slice(0, 120)); code = 1; }
    else console.log('Done: 8 screenshots, visible-text scan clean. Look at every image before publishing.');
  } catch (e) {
    console.error(e.refused ? e.message : 'ERROR: ' + e.message);
    code = 1;
  } finally {
    await d.close();
  }
  process.exit(code);
}

main().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
