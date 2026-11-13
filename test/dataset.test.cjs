'use strict';
// SPEC 9.1-9.3: template validation, dataset builds and their invariants.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const dataset = require(path.join(ROOT, 'eval', 'dataset.cjs'));
const synth = require(path.join(ROOT, 'js', 'synth.js'));
const V = require(path.join(ROOT, 'js', 'validators.js'));
const L = require(path.join(ROOT, 'js', 'lexicon.js'));

const FILES = { dev: 'eval/templates-dev.cjs', heldout: 'eval/templates-heldout.cjs', adversarial: 'eval/templates-adversarial.cjs' };
const NUMERIC_NOISE = /^(ocr1|ocr2|ocr3|dspace|nbsp|spaced-hyphen|irregular)$/;
const LETTER = /\p{L}/u;

let FULL = null;
function full() {
  if (!FULL) FULL = dataset.buildAll({});
  return FULL;
}

function realModule(name) {
  const m = require(path.join(ROOT, FILES[name]));
  return { set: m.set, templates: m.templates.map((t) => Object.assign({}, t)) };
}

test('the real template files pass every rule of 9.2', () => {
  const t = dataset.loadTemplates(ROOT);
  for (const name of dataset.SET_NAMES) {
    const list = t[name];
    const pos = list.filter((x) => x.positive).length;
    const neg = list.length - pos;
    assert.ok(pos >= dataset.MIN_COUNTS[name].positive && neg >= dataset.MIN_COUNTS[name].negative, name);
    for (const e of L.ENTITIES) assert.ok(list.filter((x) => x.positive && x.entities.has(e)).length >= 5, name + ' ' + e);
    for (const d of synth.DECOY_TYPES) assert.ok(list.filter((x) => x.decoys.has(d)).length >= dataset.MIN_COUNTS[name].decoy);
    assert.ok(list.filter((x) => x.lang !== 'en').length * 5 >= list.length);
  }
  for (const n of synth.NOISE_IDS) assert.ok(t.adversarial.some((x) => x.noises.has(n)), n);
});

test('skeletons are disjoint across files', () => {
  const t = dataset.loadTemplates(ROOT);
  const owner = new Map();
  for (const name of dataset.SET_NAMES) {
    for (const x of t[name]) {
      const sk = dataset.skeleton(x.text);
      if (owner.has(sk)) assert.equal(owner.get(sk), name, x.id);
      owner.set(sk, name);
    }
  }
  assert.equal(dataset.skeleton('Hi  {NAME},\n call {PHONE|fmt=none/10}'), 'hi {}, call {}');
});

test('failing fixtures: each rule gives a Template error with file, id and problem', () => {
  const file = FILES.dev;
  function fails(mutate, re) {
    const mod = realModule('dev');
    mutate(mod);
    assert.throws(() => dataset.validateFile(file, mod, 'dev', new Map()), (e) => {
      assert.match(e.message, /^Template error in eval\/templates-dev\.cjs: [^:]+: /);
      assert.match(e.message, re);
      return true;
    });
  }
  fails((m) => { m.set = 'heldout'; }, /\(file\): set must be dev/);
  fails((m) => { m.templates[1].id = m.templates[0].id; }, /d-support-01: duplicate id/);
  fails((m) => { m.templates[0].domain = 'banking'; }, /d-support-01: unknown domain banking/);
  fails((m) => { m.templates[0].lang = 'fr'; }, /unknown lang fr/);
  fails((m) => { m.templates[0].text = ''; }, /text must be a non-empty string/);
  fails((m) => { m.templates[0].text = 'x'.repeat(1001); }, /longer than 1000/);
  fails((m) => { m.templates[0].text = 'call {PHONE'; }, /unclosed slot/);
  fails((m) => { m.templates[0].text = '{MOBILE}'; }, /unknown slot kind MOBILE/);
  fails((m) => { m.templates[0].text = '{PAN|fmt=4-4-4-space}'; }, /unknown format 4-4-4-space for PAN/);
  fails((m) => { m.templates[0].text = '{DECOY:otp|noise=ocr1}'; }, /noise is only allowed on entity slots/);
  fails((m) => { m.templates[0].text = '{AADHAAR|noise=lower}'; }, /noise lower does not apply to AADHAAR/);
  fails((m) => { m.templates[0].text = '{CARD|noise=nbsp}'; }, /needs a grouped fmt/);
  fails((m) => { m.templates[0].text = '{PHONE|noise=irregular,fmt=plus91/10}'; }, /prefix none/);
  fails((m) => { m.templates[0].text = '{DECOY:barcode}'; }, /unknown decoy type barcode/);
  fails((m) => { m.templates[0].text = '{PAN|noise=blur}'; }, /unknown noise blur/);
  fails((m) => { m.templates = m.templates.filter((t) => /neg/.test(t.id) || Number(t.id.slice(-2)) < 3); }, /positive templates/);
  fails((m) => { m.templates = m.templates.filter((t) => !/neg-0[1-5]/.test(t.id)); }, /negative templates/);
  fails((m) => { for (const t of m.templates) t.text = t.text.replace(/\{GSTIN\}/g, '{PAN}'); }, /entity GSTIN is in 0/);
  fails((m) => { for (const t of m.templates) t.text = t.text.replace(/\{DECOY:awb\}/g, '{DECOY:pnr}'); }, /decoy awb/);
  fails((m) => { for (const t of m.templates) t.lang = 'en'; }, /20% hinglish/);
  const adv = realModule('adversarial');
  for (const t of adv.templates) t.text = t.text.replace(/noise=spaced-upi/g, 'fmt=known');
  assert.throws(() => dataset.validateFile(FILES.adversarial, adv, 'adversarial', new Map()), /noise spaced-upi is not used/);
});

test('cross-file rules: duplicate ids and shared skeletons are template errors', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-dataset-'));
  try {
    fs.mkdirSync(path.join(tmp, 'eval'));
    const write = (name, mod) => fs.writeFileSync(path.join(tmp, FILES[name]), 'module.exports = ' + JSON.stringify(mod) + ';\n');
    const dev = realModule('dev');
    const held = realModule('heldout');
    const adv = realModule('adversarial');
    write('dev', dev);
    write('adversarial', adv);
    const shared = JSON.parse(JSON.stringify(held));
    shared.templates[0].text = dev.templates[0].text.replace('{NAME}', '{CITY}');
    write('heldout', shared);
    assert.throws(() => dataset.loadTemplates(tmp), /Template error in eval\/templates-heldout\.cjs: h-support-01: skeleton also used by d-support-01/);
    const dup = JSON.parse(JSON.stringify(held));
    dup.templates[0].id = dev.templates[0].id;
    write('heldout', dup);
    assert.throws(() => dataset.loadTemplates(tmp), /d-support-01: duplicate id \(also in eval\/templates-dev\.cjs\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('full builds reach the targets with the stated seeds and document ids', () => {
  const sets = full();
  for (const name of dataset.SET_NAMES) {
    const cfg = dataset.SETS[name];
    const s = sets[name];
    assert.equal(s.seed, cfg.seed);
    const gold = {};
    const decoys = {};
    for (const d of s.documents) {
      for (const g of d.gold) gold[g.entity] = (gold[g.entity] || 0) + 1;
      for (const x of d.decoys) decoys[x.type] = (decoys[x.type] || 0) + 1;
    }
    for (const e of L.ENTITIES) assert.ok(gold[e] >= cfg.gold, name + ' ' + e);
    for (const t of synth.DECOY_TYPES) assert.ok(decoys[t] >= cfg.decoys, name + ' ' + t);
    s.documents.forEach((d, i) => assert.match(d.id, new RegExp('^' + name + '-\\d{4}$')));
    assert.ok(s.documents.length < 20 * 9 * cfg.gold);
    for (const d of s.documents) {
      for (const g of d.gold) assert.deepEqual(Object.keys(g), ['entity', 'start', 'end', 'format', 'noise', 'lang']);
    }
  }
  // Every 5th (dev, heldout) or 3rd (adversarial) phase-1 document is negative.
  const d5 = sets.dev.documents[4];
  assert.equal(d5.gold.length, 0);
  assert.equal(sets.adversarial.documents[2].gold.length, 0);
});

test('values are unique within a set and disjoint across sets (except CARD)', () => {
  const sets = full();
  const seen = new Map();
  for (const name of dataset.SET_NAMES) {
    const within = new Set();
    for (const v of sets[name].values) {
      assert.ok(!within.has(v), name + ' repeats a value');
      within.add(v);
      assert.ok(!seen.has(v), name + ' reuses a value from ' + seen.get(v));
    }
    for (const v of within) seen.set(v, name);
  }
});

function reverseNoise(text, noise) {
  let t = text;
  if (noise && noise.indexOf('ocr') === 0) t = t.replace(/O/g, '0').replace(/[lI]/g, '1');
  if (noise === 'lower') t = t.toUpperCase();
  if (noise === 'obfuscated-email') t = t.replace(' [at] ', '@').split(' [dot] ').join('.');
  if (noise === 'spaced-upi') t = t.replace(' @ ', '@');
  return t;
}

function revalidates(entity, t) {
  const d = V.digitsOnly(t);
  switch (entity) {
    case 'AADHAAR': return V.isAadhaar(d);
    case 'PHONE': return d.length >= 10 && V.isIndianMobile(d.slice(-10));
    case 'CARD': return V.isCardNumber(d) && L.TEST_CARDS.indexOf(d) >= 0;
    case 'BANK_ACCOUNT': return /^[1-9][0-9]{8,17}$/.test(d);
    case 'PAN': return V.isPan(t) && t === t.toUpperCase();
    case 'IFSC': return V.isIfsc(t) && t === t.toUpperCase();
    case 'GSTIN': return V.isGstin(t);
    case 'EMAIL': return /^[a-z0-9._+]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(t);
    case 'UPI': return /^[a-z0-9._-]{2,}@[a-z][a-z0-9]+$/.test(t);
    default: return false;
  }
}

test('gold spans re-validate, decoys never overlap gold, no letter glued to a noisy numeric slot', () => {
  const sets = full();
  for (const name of dataset.SET_NAMES) {
    for (const doc of sets[name].documents) {
      for (const g of doc.gold) {
        const raw = doc.text.slice(g.start, g.end);
        assert.ok(raw.length > 0 && raw.trim() === raw, doc.id);
        assert.ok(revalidates(g.entity, reverseNoise(raw, g.noise)), doc.id + ' ' + g.entity + ' ' + g.noise);
        if (g.noise && NUMERIC_NOISE.test(g.noise)) {
          assert.ok(!LETTER.test(doc.text.charAt(g.start - 1)) && !LETTER.test(doc.text.charAt(g.end)), doc.id + ' glued');
        }
        for (const x of doc.decoys) assert.ok(x.end <= g.start || g.end <= x.start, doc.id + ' decoy overlaps gold');
      }
      for (let i = 1; i < doc.gold.length; i++) assert.ok(doc.gold[i - 1].end <= doc.gold[i].start);
    }
  }
});

test('adversarial unsupported share is at most 0.15', () => {
  const gold = full().adversarial.documents.flatMap((d) => d.gold);
  const share = gold.filter(dataset.isUnsupported).length / gold.length;
  assert.ok(share > 0 && share <= 0.15, String(share));
  assert.equal(dataset.isUnsupported({ entity: 'PAN', noise: 'lower' }), false);
  assert.equal(dataset.isUnsupported({ entity: 'GSTIN', noise: 'lower' }), true);
  assert.equal(dataset.isUnsupported({ entity: 'PHONE', noise: 'irregular' }), false);
  assert.equal(dataset.isUnsupported({ entity: 'AADHAAR', noise: 'irregular' }), true);
  assert.equal(dataset.isUnsupported({ entity: 'AADHAAR', noise: 'ocr2' }), false);
  assert.equal(dataset.isUnsupported({ entity: 'AADHAAR', noise: 'ocr3' }), true);
});

test('--quick sizes: gold target 10 and decoy target 1 for every set', () => {
  const q = dataset.buildAll({ quick: true });
  for (const name of dataset.SET_NAMES) {
    const gold = {};
    const decoys = {};
    for (const d of q[name].documents) {
      for (const g of d.gold) gold[g.entity] = (gold[g.entity] || 0) + 1;
      for (const x of d.decoys) decoys[x.type] = (decoys[x.type] || 0) + 1;
    }
    for (const e of L.ENTITIES) assert.ok(gold[e] >= 10);
    for (const t of synth.DECOY_TYPES) assert.ok(decoys[t] >= 1);
    assert.ok(q[name].documents.length < full()[name].documents.length / 3);
  }
  assert.deepEqual(dataset.buildAll({ quick: true }), q);
});

test('writeData writes only dist/eval-data/<set>.jsonl', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-data-'));
  try {
    const q = dataset.buildAll({ quick: true, sets: ['dev'] });
    assert.deepEqual(Object.keys(q), ['dev']);
    const written = dataset.writeData(tmp, q);
    assert.deepEqual(written, ['dist/eval-data/dev.jsonl']);
    const lines = fs.readFileSync(path.join(tmp, 'dist', 'eval-data', 'dev.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, q.dev.documents.length);
    assert.deepEqual(fs.readdirSync(tmp), ['dist']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('latency inputs: held-out templates from seed 4004, at least 1,024 and 10,240 characters', () => {
  const t = dataset.loadTemplates(ROOT).heldout;
  const a = dataset.latencyInput(t, 1024);
  const b = dataset.latencyInput(t, 10240);
  assert.ok(a.length >= 1024 && b.length >= 10240);
  assert.equal(b.slice(0, a.length), a);
  assert.equal(dataset.latencyInput(t, 1024), a);
});
