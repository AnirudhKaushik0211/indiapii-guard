'use strict';
// In-browser latency (SPEC 10.4, 9.6). File mode, fresh profiles, the drivers of scripts/browser.cjs.
// Usage: node scripts/bench-browser.cjs [--browser edge|firefox|all] [--edge <path>] [--firefox <path>]
//                                       [--cdp-port 9395] [--bidi-port 9396]
// Writes eval/results/latency-browser.json. Exit 0 if every requested browser produced results, 1 if any failed,
// 2 if none ran or the arguments are invalid. Only processes started here are stopped. Port 4317 is refused.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const B = require('./browser.cjs');
const dataset = require('../eval/dataset.cjs');
const report = require('../eval/report.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESERVED_PORT = 4317;
const SIZES = [
  { label: '1KB', minChars: 1024, warmup: 20, runs: 200 },
  { label: '10KB', minChars: 10240, warmup: 20, runs: 100 }
];
const VALUE_FLAGS = ['--browser', '--edge', '--firefox', '--cdp-port', '--bidi-port'];

function usage(msg) {
  console.error(msg);
  console.error('Usage: node scripts/bench-browser.cjs [--browser edge|firefox|all] [--edge <path>] [--firefox <path>] ' +
    '[--cdp-port 9395] [--bidi-port 9396]');
  process.exit(2);
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!VALUE_FLAGS.includes(argv[i])) usage('unknown option: ' + argv[i]);
    if (i + 1 >= argv.length) usage(argv[i] + ' needs a value');
    o[argv[i]] = argv[++i];
  }
  const browser = String(o['--browser'] || 'all').toLowerCase();
  if (!['edge', 'firefox', 'all'].includes(browser)) usage('--browser must be edge, firefox or all.');
  const cdp = Number(o['--cdp-port'] || '9395');
  const bidi = Number(o['--bidi-port'] || '9396');
  for (const [name, p] of [['--cdp-port', cdp], ['--bidi-port', bidi]]) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) usage(name + ' must be a port number.');
    if (p === RESERVED_PORT) usage('Port ' + RESERVED_PORT + ' is reserved for another local tool; choose another port.');
  }
  return { browsers: browser === 'all' ? ['edge', 'firefox'] : [browser], edge: o['--edge'], firefox: o['--firefox'], cdp, bidi };
}

function localDate() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// The timing loop runs in the page: warm-up calls, then timed calls with performance.now(), nearest-rank percentiles.
function loopExpr(textJson, warmup, runs) {
  return '(() => { const text = ' + textJson + '; const G = window.IndiaPIIGuard;\n' +
    '  for (let i = 0; i < ' + warmup + '; i++) G.redact(text);\n' +
    '  const ds = []; let findings = 0;\n' +
    '  for (let i = 0; i < ' + runs + '; i++) { const t0 = performance.now(); const r = G.redact(text); ds.push(performance.now() - t0); findings = r.findings.length; }\n' +
    '  ds.sort((a, b) => a - b);\n' +
    '  const q = (p) => ds[Math.max(0, Math.ceil(p * ds.length) - 1)];\n' +
    '  return { chars: text.length, findings, p50: q(0.5), p95: q(0.95), max: ds[ds.length - 1] }; })()';
}

async function benchOne(name, exe, args, inputs) {
  const d = name === 'edge' ? await B.openEdge(exe, { cdpPort: args.cdp }) : await B.openFirefox(exe, { bidiPort: args.bidi });
  try {
    await d.goto(pathToFileURL(path.join(ROOT, 'index.html')).href);
    const ready = await B.waitFor(() => d.evaluate('!!(window.IndiaPIIGuard && window.IndiaPIIGuard.redact)'), 10000, 100);
    if (!ready) throw new Error('the app did not load');
    const r3 = (x) => Math.round(x * 1000) / 1000;
    const sizes = [];
    for (const s of SIZES) {
      const r = await d.evaluate(loopExpr(JSON.stringify(inputs[s.label]), s.warmup, s.runs));
      sizes.push({ label: s.label, chars: r.chars, warmup: s.warmup, runs: s.runs, findings: r.findings,
        p50: r3(r.p50), p95: r3(r.p95), max: r3(r.max) });
    }
    return { name, version: d.version, sizes };
  } finally {
    try { await d.close(); } catch (e) { B.killTree(d.proc); }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const templates = dataset.loadTemplates(ROOT).heldout;
  const inputs = {};
  for (const s of SIZES) inputs[s.label] = dataset.latencyInput(templates, s.minChars);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const out = { schema: 1, measuredOn: localDate(), version: pkg.version, detectorHash: report.detectorHash(ROOT), browsers: [] };
  let ok = 0;
  let failed = 0;
  for (const name of args.browsers) {
    const exe = B.resolveExe(name, args[name]);
    if (!exe) { out.browsers.push({ name, error: 'executable not found' }); failed++; console.log('SKIP ' + name + ': executable not found'); continue; }
    try {
      const r = await benchOne(name, exe, args, inputs);
      out.browsers.push(r);
      ok++;
      for (const s of r.sizes) console.log(name + ' ' + s.label + ' (' + s.chars + ' chars, ' + s.runs + ' runs): p50 ' + s.p50 + ' ms, p95 ' + s.p95 + ' ms, max ' + s.max + ' ms');
    } catch (e) {
      out.browsers.push({ name, error: String(e.message || e).split('\n')[0] });
      failed++;
      console.log('FAIL ' + name + ': ' + String(e.message || e).split('\n')[0]);
    }
  }
  if (ok === 0) { console.log('No browser produced results; nothing written.'); process.exit(2); }
  const file = path.join(ROOT, 'eval', 'results', 'latency-browser.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote eval/results/latency-browser.json (detectorHash ' + out.detectorHash + ').');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error((e && e.stack) || e); process.exit(1); });
