'use strict';
// SPEC 9.5: matching and metrics on hand-built cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const M = require(path.join(ROOT, 'eval', 'metrics.cjs'));

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const span = (entity, start, end, extra) => Object.assign({ entity, start, end }, extra || {});

test('Wilson reference values (z = 1.959963985)', () => {
  assert.equal(M.Z, 1.959963985);
  assert.deepEqual(M.wilson(95, 100).map(r6), [0.88825, 0.978456]);
  assert.deepEqual(M.wilson(0, 10).map(r6), [0, 0.277533]);
  assert.deepEqual(M.wilson(150, 150).map(r6), [0.97503, 1]);
  assert.equal(M.wilson(0, 0), null);
});

test('null conventions for precision, recall and F1', () => {
  assert.deepEqual(M.prf(0, 0, 0), { precision: null, recall: null, f1: null });
  assert.deepEqual(M.prf(0, 0, 5), { precision: null, recall: 0, f1: null });
  assert.deepEqual(M.prf(0, 3, 0), { precision: 0, recall: null, f1: null });
  assert.deepEqual(M.prf(0, 3, 2), { precision: 0, recall: 0, f1: 0 });
  const x = M.prf(8, 2, 2);
  assert.equal(x.precision, 0.8);
  assert.equal(x.recall, 0.8);
  assert.equal(r6(x.f1), 0.8);
});

test('micro sums all entities; macro averages the non-null per-entity values', () => {
  const s = M.summarise({ PAN: { tp: 9, fp: 1, fn: 0 }, EMAIL: { tp: 1, fp: 0, fn: 1 } });
  assert.equal(s.micro.tp, 10);
  assert.equal(s.micro.fp, 1);
  assert.equal(s.micro.fn, 1);
  assert.equal(r6(s.micro.precision), r6(10 / 11));
  assert.equal(r6(s.micro.recall), r6(10 / 11));
  assert.equal(r6(s.macro.precision), 0.95);
  assert.equal(r6(s.macro.recall), 0.75);
  assert.equal(r6(s.macro.f1), r6((2 * 0.9 / 1.9 + 2 * 0.5 / 1.5) / 2));
  assert.equal(s.perEntity.AADHAAR.precision, null);
  assert.equal(s.perEntity.AADHAAR.precisionCi, null);
  assert.deepEqual(s.perEntity.PAN.precisionCi.map(r6), M.wilson(9, 10).map(r6));
});

test('exact versus overlap matching, one-to-one pairing', () => {
  const gold = [span('PAN', 4, 14)];
  const near = [span('PAN', 4, 13)];
  assert.deepEqual(M.matchExact(gold, near).goldMatch, [-1]);
  assert.deepEqual(M.pairOverlap(gold, near, true).goldMatch, [0]);
  assert.deepEqual(M.pairOverlap(gold, [span('IFSC', 4, 14)], true).goldMatch, [-1]);
  assert.deepEqual(M.matchExact(gold, [span('PAN', 4, 14)]).goldMatch, [0]);
  const two = M.pairOverlap([span('PAN', 0, 10)], [span('PAN', 0, 4), span('PAN', 5, 10)], true);
  assert.deepEqual(two.goldMatch, [1]);
  assert.deepEqual(two.predMatch, [-1, 0]);
  const docs = [{ gold: [span('PAN', 0, 10), span('PAN', 20, 30)] }];
  const preds = [[span('PAN', 0, 10), span('PAN', 21, 30), span('PAN', 40, 50)]];
  const ex = M.exactScores(docs, preds).perEntity.PAN;
  assert.deepEqual([ex.tp, ex.fp, ex.fn], [1, 2, 1]);
  const ov = M.overlapScores(docs, preds).perEntity.PAN;
  assert.deepEqual([ov.tp, ov.fp, ov.fn], [2, 1, 0]);
});

test('character leak rate counts letters and digits inside gold spans', () => {
  const docs = [{ text: 'id AB-12 end', gold: [span('PAN', 3, 8)], decoys: [] }];
  const none = M.leak(docs, [[]]);
  assert.deepEqual(none, { counted: 4, leaked: 4, rate: 1 });
  const half = M.leak(docs, [[span('IFSC', 3, 5)]]);
  assert.deepEqual(half, { counted: 4, leaked: 2, rate: 0.5 });
});

test('decoy hits and FP / FN categories', () => {
  const doc = { text: 'x'.repeat(100), gold: [span('PAN', 10, 20), span('EMAIL', 30, 40), span('AADHAAR', 50, 60)],
    decoys: [{ type: 'otp', start: 70, end: 76 }, { type: 'pnr', start: 80, end: 90 }] };
  const preds = [span('PHONE', 70, 76), span('PAN', 10, 19), span('UPI', 30, 40), span('CARD', 92, 99)];
  const dh = M.decoyHits([doc], [preds]);
  assert.deepEqual(dh.all, { total: 2, hit: 1, rate: 0.5 });
  assert.deepEqual(dh.byType.otp, { total: 1, hit: 1, rate: 1 });
  assert.deepEqual(dh.byType.pnr, { total: 1, hit: 0, rate: 0 });
  assert.deepEqual(dh.byType.awb, { total: 0, hit: 0, rate: null });
  assert.equal(M.fpCategory(doc, preds[0]).category, 'decoy');
  assert.equal(M.fpCategory(doc, preds[1]).category, 'boundary');
  assert.equal(M.fpCategory(doc, preds[2]).category, 'type');
  assert.equal(M.fpCategory(doc, preds[3]).category, 'spurious');
  assert.equal(M.fnCategory(doc.gold[0], preds).category, 'boundary');
  assert.equal(M.fnCategory(doc.gold[1], preds).category, 'type');
  assert.equal(M.fnCategory(doc.gold[1], preds).pred.entity, 'UPI');
  assert.equal(M.fnCategory(doc.gold[2], preds).category, 'missed');
});

test('confusion table: type-agnostic overlap pairing, NONE row and MISSED column', () => {
  const docs = [{ gold: [span('PAN', 0, 10), span('EMAIL', 20, 30), span('AADHAAR', 50, 60)] }];
  const preds = [[span('IFSC', 0, 10), span('EMAIL', 20, 30), span('PHONE', 40, 45)]];
  const c = M.confusion(docs, preds);
  assert.equal(c.rows[c.rows.length - 1], 'NONE');
  assert.equal(c.cols[c.cols.length - 1], 'MISSED');
  const at = (r, col) => c.counts[c.rows.indexOf(r)][c.cols.indexOf(col)];
  assert.equal(at('PAN', 'IFSC'), 1);
  assert.equal(at('EMAIL', 'EMAIL'), 1);
  assert.equal(at('AADHAAR', 'MISSED'), 1);
  assert.equal(at('NONE', 'PHONE'), 1);
  assert.equal(c.counts.flat().reduce((a, b) => a + b, 0), 4);
});

test('nearest-rank percentiles', () => {
  const xs = [];
  for (let i = 1; i <= 100; i++) xs.push(i);
  assert.equal(M.percentile(xs, 0.5), 50);
  assert.equal(M.percentile(xs, 0.95), 95);
  assert.equal(M.percentile(xs, 1), 100);
  assert.equal(M.percentile([7], 0.95), 7);
  assert.equal(M.percentile([], 0.5), null);
});

test('masked excerpts: digits, address local parts, decoy domains and span letters', () => {
  const text = 'PAN ABCPE1234F\nmail asha.samplekar@example.com upi asha.samplekar@okaxis via build@localhost';
  const s = (t) => [text.indexOf(t), text.indexOf(t) + t.length];
  const [p0, p1] = s('ABCPE1234F');
  const [e0, e1] = s('asha.samplekar@example.com');
  const u0 = text.lastIndexOf('asha.samplekar@okaxis');
  const [d0, d1] = s('build@localhost');
  const doc = { text, gold: [span('PAN', p0, p1), span('EMAIL', e0, e1), span('UPI', u0, u0 + 21)],
    decoys: [{ type: 'handle-local', start: d0, end: d1 }] };
  const out = M.maskExcerpt(doc, [], 0, text.length);
  assert.equal(out, 'PAN AAAAA####A\u23CEmail xxxx.xxxxxxxxx@example.com upi xxxx.xxxxxxxxx@okaxis via xxxxx@xxxxxxxxx');
  // A predicted span is masked like a gold span; digits outside spans become '#'.
  const doc2 = { text: 'order 98 76 Asha 5', gold: [], decoys: [] };
  assert.equal(M.maskExcerpt(doc2, [span('BANK_ACCOUNT', 6, 16)], 6, 16), 'order ## ## Aaaa #');
  // The window is 30 characters either side.
  const long = { text: 'a'.repeat(40) + 'ABCPE1234F' + 'b'.repeat(40), gold: [span('PAN', 40, 50)], decoys: [] };
  assert.equal(M.maskExcerpt(long, [], 40, 50), 'a'.repeat(30) + 'AAAAA####A' + 'b'.repeat(30));
});

test('evaluateSet re-runs detection per sweep threshold and preset (never filters)', () => {
  const calls = [];
  const set = { documents: [
    { id: 't-0001', templateId: 'x', domain: 'misc', lang: 'en', text: 'PAN ABCPE1234F',
      gold: [{ entity: 'PAN', start: 4, end: 14, format: 'upper', noise: null, lang: 'en' }], decoys: [] },
    { id: 't-0002', templateId: 'y', domain: 'misc', lang: 'hinglish', text: 'otp 123456',
      gold: [], decoys: [{ type: 'otp', start: 4, end: 10 }] }
  ] };
  const detect = (text, options) => {
    calls.push(options === undefined ? 'default' : options.threshold);
    const t = options === undefined ? 0.5 : (typeof options.threshold === 'number' ? options.threshold : 0.5);
    const findings = [];
    if (text.indexOf('PAN') === 0 && t <= 0.8) findings.push({ entity: 'PAN', start: 4, end: 14, reasons: ['structure:pan'] });
    if (text.indexOf('otp') === 0 && t <= 0.35) findings.push({ entity: 'PHONE', start: 4, end: 10, reasons: ['x'] });
    return { findings };
  };
  const m = M.evaluateSet(set, detect);
  assert.deepEqual(m.sweep.map((x) => x.threshold), M.SWEEP);
  assert.equal(M.SWEEP.length, 13);
  assert.equal(M.SWEEP[0], 0.3);
  assert.equal(M.SWEEP[12], 0.9);
  for (const t of M.SWEEP) assert.ok(calls.indexOf(t) >= 0);
  for (const p of M.PRESETS) assert.ok(calls.indexOf(p) >= 0);
  assert.equal(calls.filter((c) => c === 'default').length, 2);
  assert.equal(m.sweep[0].precision, 0.5);
  assert.equal(m.sweep[2].precision, 1);
  assert.equal(m.sweep[12].recall, 0);
  assert.equal(m.documents, 2);
  assert.equal(m.negativeDocuments, 1);
  assert.equal(m.exact.micro.tp, 1);
  assert.deepEqual(m.byLanguage.en, { support: 1, tp: 1, recall: 1 });
  assert.deepEqual(m.byNoise.none, { support: 1, tp: 1, recall: 1 });
  assert.deepEqual(m.byFormat.PAN.upper, { support: 1, tp: 1, recall: 1 });
  assert.equal(m.decoyHits.all.hit, 0);
  assert.deepEqual(Object.keys(m), ['documents', 'negativeDocuments', 'characters', 'support', 'decoys', 'unsupportedShare',
    'exact', 'overlap', 'leak', 'decoyHits', 'fpCategories', 'fnCategories', 'byFormat', 'byNoise', 'byLanguage',
    'confusion', 'sweep', 'presets', 'failures']);
});
