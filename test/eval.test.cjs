'use strict';
// SPEC 9.7, 9.10, 9.11: runEval determinism, no machine data, write rules, README block, fileHash normalisation.
// runEval is never called with a publishing configuration against the real project folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { runEval, parseArgs } = require(path.join(ROOT, 'scripts', 'eval.cjs'));
const dataset = require(path.join(ROOT, 'eval', 'dataset.cjs'));
const report = require(path.join(ROOT, 'eval', 'report.cjs'));

let QUICK = null;
function quick() {
  if (!QUICK) QUICK = runEval({ quick: true, write: false, latency: false });
  return QUICK;
}

function hashTree(dir) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  })(dir);
  return out;
}

test('runEval quick twice gives identical metricsJson', () => {
  const a = quick();
  const b = runEval({ quick: true, write: false, latency: false });
  assert.equal(a.metricsJson, b.metricsJson);
  assert.deepEqual(a.written, []);
  assert.equal(a.publishing, false);
  const m = JSON.parse(a.metricsJson);
  assert.deepEqual(Object.keys(m), ['tool', 'version', 'schema', 'config', 'templates', 'sets', 'gateAccuracy']);
  assert.equal(m.config.quick, true);
  assert.deepEqual(m.config.seeds, { dev: 1001, heldout: 2002, adversarial: 3003, latency: 4004 });
  assert.deepEqual(m.config.targets.heldout, { gold: 10, decoys: 1 });
  assert.deepEqual(Object.keys(m.sets), ['dev', 'heldout', 'adversarial']);
  assert.equal(m.gateAccuracy.length, 23);
  assert.ok(a.metricsJson.endsWith('}\n'));
  assert.equal(JSON.stringify(m, null, 2) + '\n', a.metricsJson);
});

test('a different dev seed gives a different dev dataset', () => {
  const t = dataset.loadTemplates(ROOT).dev;
  const a = dataset.buildSet('dev', { quick: true, templates: t });
  const b = dataset.buildSet('dev', { quick: true, templates: t, seed: 1002 });
  const a2 = dataset.buildSet('dev', { quick: true, templates: t });
  assert.deepEqual(a.documents, a2.documents);
  assert.notDeepEqual(a.documents.map((d) => d.text), b.documents.map((d) => d.text));
});

test('metricsJson contains no dates, host name, user name or path', () => {
  const j = quick().metricsJson;
  assert.ok(j.indexOf('measuredOn') < 0);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(j));
  const lower = j.toLowerCase();
  assert.ok(lower.indexOf(os.hostname().toLowerCase()) < 0, 'host name');
  const user = os.userInfo().username;
  if (user.length >= 3) assert.ok(lower.indexOf(user.toLowerCase()) < 0, 'user name');
  assert.ok(j.indexOf(ROOT) < 0 && j.indexOf(ROOT.replace(/\\/g, '\\\\')) < 0, 'project path');
  assert.ok(j.indexOf(os.homedir()) < 0 && j.indexOf(os.homedir().replace(/\\/g, '\\\\')) < 0, 'home path');
  assert.ok(!/[A-Za-z]:\\\\/.test(j), 'Windows path');
});

test('quick and partial runs against a temporary copy write nothing and change no file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-eval-'));
  try {
    for (const f of ['package.json', 'README.md']) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
    for (const d of ['js', 'eval', 'docs']) {
      fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
    }
    const before = hashTree(tmp);
    const q = runEval({ quick: true, write: true, latency: false, root: tmp });
    assert.deepEqual(q.written, []);
    const p = runEval({ sets: ['dev'], write: true, latency: false, root: tmp });
    assert.deepEqual(p.written, []);
    assert.deepEqual(Object.keys(p.metrics.sets), ['dev']);
    const r = runEval({ quick: true, write: true, latency: false, checkRepro: true, root: tmp });
    assert.deepEqual(r.written, []);
    assert.equal(r.repro, true);
    assert.deepEqual(hashTree(tmp), before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('readmeBlock of a quick run renders the table and the gate line', () => {
  const b = quick().readmeBlock;
  assert.ok(b.indexOf('Measured on the synthetic held-out set (exact span match, Balanced threshold). ' +
    'See docs/EVAL-REPORT.md for method, failures and limitations.') === 0);
  assert.match(b, /^\| Entity \| Precision \| Recall \| F1 \| Support \|$/m);
  assert.match(b, /^\| Micro average \| /m);
  assert.match(b, /^Release gate: (PASS|FAIL|INCOMPLETE) \(\d+ of 27 criteria met\)\.$/m);
  const replaced = report.replaceReadmeBlock('# T\n\n<!-- eval:start -->\nold\n<!-- eval:end -->\n', 'NEW');
  assert.equal(replaced, '# T\n\n<!-- eval:start -->\nNEW\n<!-- eval:end -->\n');
  assert.equal(report.replaceReadmeBlock('# T\n', 'NEW'), null);
});

test('reportMd has the 13 sections of 9.7 in order', () => {
  const md = quick().reportMd;
  const heads = md.split('\n').filter((l) => /^## /.test(l) && md.indexOf(l) >= 0);
  const want = ['How to read this', 'Release gate', 'Held-out results', 'Development and adversarial results',
    'Overlap matching', 'Leakage and decoys', 'Where it fails', 'Threshold trade-off', 'Failure examples', 'Latency',
    'Method', 'Development history'];
  const found = want.map((w) => md.indexOf('\n## ' + w + '\n'));
  for (let i = 0; i < want.length; i++) assert.ok(found[i] > 0, want[i]);
  for (let i = 1; i < found.length; i++) assert.ok(found[i] > found[i - 1], want[i]);
  assert.ok(heads.length >= 12);
  assert.ok(md.indexOf('# IndiaPII Guard evaluation report\n') === 0);
  assert.ok(md.indexOf('Generated by `npm run eval`. Do not edit by hand.') > 0);
  assert.ok(md.indexOf(report.SYNTHETIC_STATEMENT) > 0);
  assert.ok(md.indexOf('the adversarial results are no longer unseen data.') > 0);
});

test('HISTORY parsing: frozen hashes, run count and adversarial-change sentence', () => {
  const h = '# H\n\n## 2026-01-01 - Templates frozen\n- Frozen held-out templates SHA-256: ' + 'a'.repeat(64) +
    '\n- Frozen adversarial templates SHA-256: ' + 'b'.repeat(64) + '\n\n## 2026-01-02 - held-out run 1: first\n' +
    '- Reason: first\n\n## 2026-01-03 - held-out run 2: fix\n- Reason: defect reproduced by adversarial-0042\n';
  assert.deepEqual(report.frozenHashes(h), { heldout: 'a'.repeat(64), adversarial: 'b'.repeat(64) });
  assert.equal(report.heldoutRunCount(h), 2);
  assert.equal(report.adversarialChangeCount(h), 1);
  assert.equal(report.adversarialChangeCount(h.replace('adversarial-0042', 'dev-0042')), 0);
  const numbered = h.replace('defect reproduced by adversarial-0042',
    'owner decision. (1) dev-0001: a. (2) adversarial-0002: b. (3) adversarial-0003 and dev-0004: c.');
  assert.equal(report.adversarialChangeCount(numbered), 2);
  const real = fs.readFileSync(path.join(ROOT, 'eval', 'HISTORY.md'), 'utf8');
  const frozen = report.frozenHashes(real);
  assert.equal(frozen.heldout, report.fileHash(path.join(ROOT, 'eval', 'templates-heldout.cjs')));
  assert.equal(frozen.adversarial, report.fileHash(path.join(ROOT, 'eval', 'templates-adversarial.cjs')));
});

test('fileHash: CRLF and LF, BOM and no BOM give the same value', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-hash-'));
  try {
    const lf = path.join(tmp, 'lf.txt');
    const crlf = path.join(tmp, 'crlf.txt');
    const bom = path.join(tmp, 'bom.txt');
    fs.writeFileSync(lf, 'line one\nline two\n');
    fs.writeFileSync(crlf, 'line one\r\nline two\r\n');
    fs.writeFileSync(bom, '\uFEFFline one\r\nline two\r\n');
    const h = report.fileHash(lf);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(report.fileHash(crlf), h);
    assert.equal(report.fileHash(bom), h);
    assert.equal(h, crypto.createHash('sha256').update('line one\nline two\n').digest('hex'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.match(report.detectorHash(ROOT), /^[0-9a-f]{64}$/);
});

test('CLI argument parsing', () => {
  assert.deepEqual(parseArgs(['--sets', 'dev']).sets, ['dev']);
  assert.deepEqual(parseArgs(['--sets=dev,heldout']).sets, ['dev', 'heldout']);
  assert.equal(parseArgs(['--quick', '--no-latency']).quick, true);
  assert.equal(parseArgs(['--x', '--help']).help, true);
  assert.throws(() => parseArgs(['--sets', 'test']), /unknown set: test/);
  assert.throws(() => parseArgs(['--sets']), /--sets needs a value/);
  assert.throws(() => parseArgs(['--quick', '--quick']), /--quick given twice/);
  assert.throws(() => parseArgs(['--fast']), /unknown option: --fast/);
});
