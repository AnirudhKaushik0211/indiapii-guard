'use strict';
// SPEC 10.1 selfscan row (11.4). Every identifier-shaped value that is not in 11.5 or TEST_CARDS is built at runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const selfscan = require('../scripts/selfscan.cjs');
const v = require('../js/validators.js');
const lexicon = require('../js/lexicon.js');
const guard = require('../js/guard.js');
const { maskExcerpt } = require('../eval/metrics.cjs');
const { runEval } = require('../scripts/eval.cjs');

const ROOT = path.resolve(__dirname, '..');
const AT = '@';
const G1 = 'Aadhaar 2345 6789 0124, PAN ABCPE1234F, mobile +91 98765 43210, email asha.samplekar' + AT + 'example.com, ' +
  'UPI asha.samplekar' + AT + 'okaxis, IFSC ABCD0123456, a/c 50100012345678, card 4111 1111 1111 1111, GSTIN 27ABCPE1234F1ZB.';

// Runtime-built values (not in 11.5).
const AADHAAR_BASE = '3456789' + '0123';
const PLANTED_AADHAAR = AADHAAR_BASE + v.verhoeffDigit(AADHAAR_BASE);
const CARD_BASE = '4539' + '1488' + '0343' + '646';
const PLANTED_CARD = CARD_BASE + v.luhnDigit(CARD_BASE);

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pg-self-')); }
function withDir(files, fn) {
  const dir = tmpDir();
  try {
    for (const rel of Object.keys(files)) {
      const p = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, files[rel], 'utf8');
    }
    return fn(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('known-synthetic.json lists exactly the 13 keys of SPEC 11.5', () => {
  const keys = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'known-synthetic.json'), 'utf8'));
  assert.equal(keys.length, 13);
  assert.equal(new Set(keys).size, 13);
  assert.ok(keys.every((k) => /^[A-Z_]+:/.test(k) && lexicon.ENTITIES.indexOf(k.split(':')[0]) >= 0));
});

test('a clean temporary folder passes', () => {
  withDir({ 'README.md': '# Notes\nNothing to see here.\n', 'js/a.js': 'var a = 1;\n' }, (dir) => {
    const r = selfscan.scanDir(dir);
    assert.equal(r.files, 2);
    assert.deepEqual(r.hits, []);
  });
});

test('a planted runtime-built Aadhaar-format value is a hit, printed masked with its line', () => {
  assert.notEqual(PLANTED_AADHAAR, '2345' + '6789' + '0124');
  withDir({ 'docs/a.md': 'line one\nAadhaar ' + PLANTED_AADHAAR + ' here\n' }, (dir) => {
    const r = selfscan.scanDir(dir);
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0], 'docs/a.md:2 AADHAAR ############');
    assert.ok(!r.hits.join('\n').includes(PLANTED_AADHAAR));
  });
});

test('values from 11.5 pass, TEST_CARDS pass, a Luhn-valid non-test card is a hit', () => {
  assert.deepEqual(selfscan.scanString('x', G1), []);
  assert.deepEqual(selfscan.scanString('x', 'Aadhaar 234567890124 and PAN XYZPQ1234Z, call 9123456780'), []);
  for (const c of lexicon.TEST_CARDS) assert.deepEqual(selfscan.scanString('x', 'card ' + c), [], c);
  assert.ok(lexicon.TEST_CARDS.indexOf(PLANTED_CARD) < 0);
  assert.ok(v.luhnCheck(PLANTED_CARD));
  const hits = selfscan.scanString('x', 'card ' + PLANTED_CARD);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /^x:1 CARD #+$/);
  assert.ok(!hits[0].includes(PLANTED_CARD));
});

test('e-mail at a reserved domain passes, other domains are hits', () => {
  assert.deepEqual(selfscan.scanString('x', 'mail meera.iyer' + AT + 'mail.example.com'), []);
  const hits = selfscan.scanString('x', 'mail meera.iyer' + AT + 'mail' + 'box.co');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].startsWith('x:1 EMAIL '));
  assert.ok(!hits[0].includes('meera'));
});

test('the section 5 mask and partial outputs pass', () => {
  const mask = guard.redact(G1, { style: 'mask' }).text;
  const partial = guard.redact(G1, { style: 'partial' }).text;
  assert.deepEqual(selfscan.scanString('mask', mask), []);
  assert.deepEqual(selfscan.scanString('partial', partial), []);
});

test('the real docs/SPEC.md and README.md pass', () => {
  for (const rel of ['docs/SPEC.md', 'README.md']) {
    assert.deepEqual(selfscan.scanBuffer(rel, fs.readFileSync(path.join(ROOT, ...rel.split('/')))), [], rel);
  }
});

test('the quick-run reportMd and metricsJson written to a temporary folder pass', () => {
  const r = runEval({ quick: true, write: false, latency: false });
  assert.deepEqual(r.written, []);
  withDir({ 'docs/EVAL-REPORT.md': r.reportMd, 'eval/results/metrics.json': r.metricsJson }, (dir) => {
    const s = selfscan.scanDir(dir);
    assert.equal(s.files, 2);
    assert.deepEqual(s.hits, []);
  });
});

test('maskExcerpt of hand-built UPI and decoy excerpts cut off from their label words passes', () => {
  const ORDER_BASE = '4' + '87120' + '93356' + '4127';
  const UTR_BASE = '5' + '41207' + '93318';
  const cases = [
    { kind: 'gold', entity: 'UPI', value: 'meera.' + 'iyer' + AT + 'okaxis' },
    { kind: 'gold', entity: 'UPI', value: 'meera.' + 'iyer' + AT + 'zzpay' },
    { kind: 'decoy', type: 'handle-local', value: 'deploy' + AT + 'server' },
    { kind: 'decoy', type: 'order16', value: ORDER_BASE + v.luhnDigit(ORDER_BASE) },
    { kind: 'decoy', type: 'utr12', value: UTR_BASE + v.verhoeffDigit(UTR_BASE) }
  ];
  for (const c of cases) {
    const label = c.kind === 'gold' ? 'UPI ID' : 'Order no';
    const pad = ' '.repeat(40);
    const text = label + pad + c.value + pad + 'thanks';
    const start = label.length + pad.length;
    const end = start + c.value.length;
    const doc = { text, gold: [], decoys: [] };
    if (c.kind === 'gold') doc.gold.push({ entity: c.entity, start, end });
    else doc.decoys.push({ type: c.type, start, end });
    // Unmasked, the value would be found (or is a checksum-valid lookalike); masked, nothing is left to find.
    const excerpt = maskExcerpt(doc, [], start, end);
    assert.ok(!excerpt.includes(label), 'the label word is outside the excerpt');
    assert.ok(!excerpt.includes(c.value), c.kind + ' ' + (c.type || c.entity));
    assert.deepEqual(selfscan.scanString('excerpt', excerpt), [], excerpt);
  }
});
