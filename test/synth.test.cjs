'use strict';
// SPEC 8.1-8.5: PRNG, generators, decoys and noise.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const prng = require(path.join(ROOT, 'js', 'prng.js'));
const synth = require(path.join(ROOT, 'js', 'synth.js'));
const V = require(path.join(ROOT, 'js', 'validators.js'));
const L = require(path.join(ROOT, 'js', 'lexicon.js'));
const guard = require(path.join(ROOT, 'js', 'guard.js'));

const CONTEXT_WORD = { AADHAAR: 'aadhaar', PHONE: 'phone', CARD: 'card', PAN: 'pan', EMAIL: 'email', UPI: 'upi',
  IFSC: 'ifsc', GSTIN: 'gstin', BANK_ACCOUNT: 'account' };

function validValue(entity, value) {
  switch (entity) {
    case 'AADHAAR': return V.isAadhaar(value);
    case 'PHONE': return V.isIndianMobile(value);
    case 'CARD': return V.isCardNumber(value) && L.TEST_CARDS.indexOf(value) >= 0;
    case 'PAN': return V.isPan(value) && value === value.toUpperCase();
    case 'EMAIL': {
      const at = value.indexOf('@');
      return /^[a-z0-9._+]{4,}$/.test(value.slice(0, at)) && synth.EMAIL_DOMAINS.indexOf(value.slice(at + 1)) >= 0;
    }
    case 'UPI': {
      const at = value.indexOf('@');
      const handle = value.slice(at + 1);
      return /^[a-z0-9._]{4,}$/.test(value.slice(0, at)) &&
        (L.UPI_HANDLES.indexOf(handle) >= 0 || synth.UNKNOWN_HANDLES.indexOf(handle) >= 0);
    }
    case 'IFSC': return V.isIfsc(value) && value === value.toUpperCase();
    case 'GSTIN': return V.isGstin(value);
    case 'BANK_ACCOUNT': return /^[1-9][0-9]{8,17}$/.test(value);
    default: return false;
  }
}

test('mulberry32 and helpers are deterministic and in range', () => {
  const a = prng.mulberry32(42);
  const b = prng.mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  const r = prng.mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const n = prng.int(r, 3, 5);
    assert.ok(n >= 3 && n <= 5 && Number.isInteger(n));
  }
  assert.match(prng.digits(r, 12), /^[0-9]{12}$/);
  assert.equal(prng.weighted(prng.mulberry32(1), [['only', 1]]), 'only');
  assert.equal(prng.chance(r, 0), false);
  assert.equal(prng.chance(r, 1), true);
  assert.ok(['a', 'b'].indexOf(prng.pick(r, ['a', 'b'])) >= 0);
  assert.notEqual(prng.mulberry32(1)(), prng.mulberry32(2)());
});

test('every generator and format: valid value, detected exactly after its own context word (200 values each)', () => {
  const rng = prng.mulberry32(8080);
  for (const entity of L.ENTITIES) {
    for (const fmt of synth.FORMATS[entity]) {
      for (let i = 0; i < 200; i++) {
        const item = synth.GENERATORS[entity](rng, { fmt });
        assert.equal(item.format, fmt);
        assert.ok(validValue(entity, item.value), entity + ' ' + fmt + ' invalid value');
        const prefix = CONTEXT_WORD[entity] + ' ';
        const text = prefix + item.text;
        const f = guard.detect(text).findings;
        // SPEC 3.5 PHONE step 1: a first digit group that is exactly '91' is a separate prefix and is removed first,
        // so a 2-4-4 mobile starting with 91 (about 2.5% of 2-4-4 values) leaves 8 digits and is not a phone.
        // The detector follows the SPEC here; the eval measures it.
        if (entity === 'PHONE' && (fmt === 'none/2-4-4' || fmt === 'paren-plus91/2-4-4') && item.value.slice(0, 2) === '91') {
          assert.ok(!f.some((x) => x.entity === 'PHONE'), 'SPEC 3.5 separate-prefix reading changed');
          continue;
        }
        assert.equal(f.length, 1, entity + ' ' + fmt + ': ' + f.map((x) => x.entity).join(','));
        assert.equal(f[0].entity, entity);
        assert.equal(f[0].start, prefix.length);
        assert.equal(f[0].end, text.length);
        assert.equal(f[0].value, item.value);
      }
    }
  }
});

test('drawn formats come from the 8.2 lists', () => {
  const rng = prng.mulberry32(99);
  for (const entity of L.ENTITIES) {
    for (let i = 0; i < 300; i++) {
      const item = synth.GENERATORS[entity](rng, {});
      assert.ok(synth.FORMATS[entity].indexOf(item.format) >= 0, entity + ' ' + item.format);
      if (entity === 'PAN' || entity === 'IFSC') assert.equal(item.format, 'upper');
    }
  }
});

test('same seed gives the same sequence; a different seed differs', () => {
  function run(seed) {
    const rng = prng.mulberry32(seed);
    const out = [];
    for (const entity of L.ENTITIES) for (let i = 0; i < 20; i++) out.push(synth.GENERATORS[entity](rng, {}).text);
    for (const t of synth.DECOY_TYPES) out.push(synth.genDecoy(rng, t).text);
    for (const k of synth.FILLERS) out.push(synth.genFiller(rng, k));
    return out;
  }
  assert.deepEqual(run(123), run(123));
  assert.notDeepEqual(run(123), run(124));
});

test('avoid is respected; an exhausted avoid set throws', () => {
  const rng = prng.mulberry32(5);
  for (const entity of L.ENTITIES) {
    if (entity === 'CARD') continue;
    const avoid = new Set();
    for (let i = 0; i < 300; i++) {
      const item = synth.GENERATORS[entity](rng, { avoid });
      assert.ok(!avoid.has(item.value), entity + ' repeated ' + i);
      avoid.add(item.value);
    }
  }
  const all = { has: () => true };
  assert.throws(() => synth.genAADHAAR(rng, { avoid: all }), { message: 'could not generate a fresh value' });
  // The renderer adds non-CARD values to avoid.
  const avoid = new Set();
  const r = synth.renderTemplate(rng, synth.parseTemplate('pan {PAN} card {CARD}'), avoid);
  assert.equal(avoid.size, 1);
  assert.ok(avoid.has(r.gold[0].value));
});

test('fillers use the fictional names and stated shapes', () => {
  const rng = prng.mulberry32(11);
  for (let i = 0; i < 200; i++) {
    const name = synth.genFiller(rng, 'NAME').split(' ');
    assert.ok(synth.FIRST_NAMES.indexOf(name[0]) >= 0 && synth.SURNAMES.indexOf(name[1]) >= 0);
    assert.match(synth.genFiller(rng, 'NAME_UPPER'), /^[A-Z]+ [A-Z]+$/);
    assert.ok(synth.CITIES.indexOf(synth.genFiller(rng, 'CITY')) >= 0);
    assert.match(synth.genFiller(rng, 'DATE'), /^(\d\d-\d\d-2026|\d\d\/\d\d\/2026|\d{1,2} [A-Z][a-z]+ 2026)$/);
    assert.match(synth.genFiller(rng, 'TIME'), /^([01]\d|2[0-3]):[0-5]\d$/);
    const amount = synth.genFiller(rng, 'AMOUNT');
    assert.match(amount, /^(Rs |\u20B9)\d{1,2}(,\d\d)*,?\d{0,3}$/);
    const n = Number(amount.replace(/[^0-9]/g, ''));
    assert.ok(n >= 100 && n <= 99999);
  }
  assert.equal(synth.indianGroup('1234567'), '12,34,567');
  assert.equal(synth.indianGroup('123456789'), '12,34,56,789');
  assert.equal(synth.indianGroup('999'), '999');
});

test('decoys of 8.4 have the stated shapes', () => {
  const rng = prng.mulberry32(21);
  const SHAPES = {
    'order10': /^[6-9]\d{9}$/, 'order16': /^4\d{15}$|^4\d{3} \d{4} \d{4} \d{4}$/, 'utr12': /^[2-9]\d{11}$/,
    'invoice': /^INV-2026-\d{6}$/, 'timestamp': /^2026-\d\d-\d\d \d\d:\d\d:\d\d$/, 'epoch10': /^17\d{8}$/,
    'epochms13': /^17\d{11}$/, 'price': /^[1-9]\d{0,1}(,\d\d)*,\d{3}(\.00)?$/, 'awb': /^([6-9]\d{9}|[1-9]\d{10,11})$/,
    'pnr': /^[6-9]\d{9}$/, 'otp': /^\d{6}$/, 'pincode': /^[1-8]\d{5}$/,
    'sku-pan': /^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/, 'coupon-ifsc': /^[A-Z]{4}0[A-Z0-9]{6}$/,
    'handle-local': /^(build|admin|deploy|root|intranet|localhost|server)@(build|admin|deploy|root|intranet|localhost|server)$/,
    'version': /^v[1-9]\.([0-9]|1[0-9]|20)\.([0-9]|1[0-9]|20)$/
  };
  assert.deepEqual(Object.keys(SHAPES), synth.DECOY_TYPES);
  for (const t of synth.DECOY_TYPES) {
    for (let i = 0; i < 200; i++) {
      const d = synth.genDecoy(rng, t);
      assert.equal(d.type, t);
      assert.match(d.text, SHAPES[t], t + ': ' + d.text.replace(/\d/g, '#'));
      if (t === 'order16') assert.ok(V.luhnCheck(V.digitsOnly(d.text)));
      if (t === 'utr12') assert.ok(V.verhoeffCheck(d.text));
      if (t === 'price') assert.ok([6, 7, 8, 9].indexOf(d.text.replace(/\.00$/, '').replace(/,/g, '').length) >= 0);
      if (t === 'sku-pan') assert.ok(V.isPan(d.text));
      if (t === 'coupon-ifsc') assert.ok(V.isIfsc(d.text));
    }
  }
  assert.throws(() => synth.genDecoy(rng, 'nope'), /unknown decoy type/);
});

test('OCR placement changes only k eligible 0/1 digits, within the per-group limit', () => {
  const rng = prng.mulberry32(31);
  for (const k of [1, 2, 3]) {
    for (const entity of ['AADHAAR', 'PHONE', 'CARD', 'BANK_ACCOUNT']) {
      let placed = 0;
      for (let i = 0; i < 200; i++) {
        const item = synth.GENERATORS[entity](rng, {});
        const noisy = synth.placeOcr(rng, item.text, k);
        if (noisy === null) continue;
        placed++;
        assert.equal(noisy.length, item.text.length);
        const groups = [];
        const re = /[0-9]+/g;
        let m;
        while ((m = re.exec(item.text)) !== null) groups.push({ start: m.index, len: m[0].length, n: 0 });
        let changed = 0;
        for (let j = 0; j < noisy.length; j++) {
          if (noisy[j] === item.text[j]) continue;
          changed++;
          if (item.text[j] === '0') assert.equal(noisy[j], 'O');
          else { assert.equal(item.text[j], '1'); assert.ok(noisy[j] === 'l' || noisy[j] === 'I'); }
          const g = groups.find((x) => x.start <= j && j < x.start + x.len);
          assert.ok(g.len >= 3);
          g.n++;
        }
        assert.equal(changed, k);
        for (const g of groups) assert.ok(g.n <= Math.floor(g.len / 2));
      }
      assert.ok(placed > 0, entity + ' ocr' + k + ' never placed');
    }
  }
});

test('genValue with OCR noise redraws and gives up with the stated error', () => {
  const rng = prng.mulberry32(41);
  for (let i = 0; i < 100; i++) {
    const v = synth.genValue(rng, 'PHONE', { noise: 'ocr2', fmt: 'none/5-5' });
    assert.equal(v.format, 'none/5-5');
    assert.equal(v.text.replace(/[OlI]/g, '').length, v.text.length - 2);
    assert.equal(V.digitsOnly(v.text.replace(/O/g, '0').replace(/[lI]/g, '1')), v.value);
  }
  // Every acceptable value lacks 0 and 1, so the OCR noise can never be placed.
  const noZeroOne = { has: (v) => /[01]/.test(v) };
  assert.throws(() => synth.genValue(prng.mulberry32(3), 'AADHAAR', { noise: 'ocr1', fmt: 'contiguous', avoid: noZeroOne }),
    { message: 'could not place OCR noise' });
});

test('separator, case, grouping and address noise change only the stated characters', () => {
  const rng = prng.mulberry32(51);
  const SEP = { 'dspace': '  ', 'nbsp': '\u00A0', 'spaced-hyphen': ' - ' };
  const grouped = { AADHAAR: '4-4-4-space', PHONE: 'plus91-space/5-5', CARD: '4-4-4-4-hyphen', BANK_ACCOUNT: 'groups-of-4-space' };
  for (const noise of Object.keys(SEP)) {
    for (const entity of Object.keys(grouped)) {
      for (let i = 0; i < 50; i++) {
        const item = synth.GENERATORS[entity](rng, { fmt: grouped[entity] });
        const noisy = synth.applyNoise(rng, noise, entity, item);
        const expected = item.text.replace(/([0-9])[ -](?=[0-9])/g, (all, d) => d + SEP[noise]);
        assert.equal(noisy.text, expected);
        assert.notEqual(noisy.text, item.text);
        assert.equal(noisy.value, item.value);
      }
    }
  }
  for (const entity of ['PAN', 'IFSC', 'GSTIN']) {
    const item = synth.GENERATORS[entity](rng, {});
    assert.equal(synth.applyNoise(rng, 'lower', entity, item).text, item.text.toLowerCase());
  }
  for (let i = 0; i < 50; i++) {
    const a = synth.genValue(rng, 'AADHAAR', { noise: 'irregular' });
    assert.match(a.text, /^(\d{4} \d{3} \d{5}|\d{3} \d{4} \d{5})$/);
    assert.equal(V.digitsOnly(a.text), a.value);
    const p = synth.genValue(rng, 'PHONE', { noise: 'irregular', fmt: 'none/10' });
    assert.match(p.text, /^\d{3} \d{2} \d{5}$/);
    assert.equal(p.format, 'none/3-2-5');
    const e = synth.genValue(rng, 'EMAIL', { noise: 'obfuscated-email' });
    assert.equal(e.text.replace(' [at] ', '@').split(' [dot] ').join('.'), e.value);
    const u = synth.genValue(rng, 'UPI', { noise: 'spaced-upi' });
    assert.equal(u.text.replace(' @ ', '@'), u.value);
  }
});

test('noise outside the applies-to matrix throws', () => {
  const rng = prng.mulberry32(61);
  const item = synth.genAADHAAR(rng, {});
  assert.throws(() => synth.applyNoise(rng, 'lower', 'AADHAAR', item), { message: 'noise lower does not apply to AADHAAR' });
  assert.throws(() => synth.genValue(rng, 'EMAIL', { noise: 'ocr1' }), { message: 'noise ocr1 does not apply to EMAIL' });
  assert.throws(() => synth.genValue(rng, 'PAN', { noise: 'irregular' }), { message: 'noise irregular does not apply to PAN' });
  const s = Object.keys(synth.NOISE_APPLIES_TO);
  assert.deepEqual(s, synth.NOISE_IDS);
  assert.equal(synth.noiseProblem('CARD', 'nbsp', undefined), 'noise nbsp needs a grouped fmt for CARD');
  assert.equal(synth.noiseProblem('CARD', 'nbsp', '4-6-5'), null);
  assert.equal(synth.noiseProblem('PHONE', 'irregular', 'plus91/10'), 'noise irregular on PHONE needs fmt with prefix none');
});

test('template slot grammar', () => {
  const parts = synth.parseTemplate('a {{b}} {PAN|fmt=upper} {DECOY:otp} {NAME} {AADHAAR|noise=ocr3,knownMiss}');
  assert.equal(parts[0].text, 'a {b} ');
  assert.equal(parts[1].entity, 'PAN');
  assert.equal(parts[1].fmt, 'upper');
  assert.equal(parts[3].decoy, 'otp');
  assert.equal(parts[5].filler, 'NAME');
  assert.equal(parts[7].noise, 'ocr3');
  assert.equal(parts[7].knownMiss, true);
  for (const [bad, msg] of [['{FOO}', /unknown slot kind FOO/], ['{PAN', /unclosed slot/], ['x } y', /unmatched \}/],
    ['{DECOY:nope}', /unknown decoy type nope/], ['{PAN|fmt=wide}', /unknown format wide for PAN/],
    ['{NAME|fmt=upper}', /fmt is only allowed on entity slots/], ['{AADHAAR|noise=lower}', /does not apply to AADHAAR/],
    ['{CARD|noise=nbsp}', /needs a grouped fmt/], ['{PAN|size=2}', /invalid option/],
    ['{PAN|fmt=upper,fmt=upper}', /given twice/]]) {
    assert.throws(() => synth.parseTemplate(bad), msg, bad);
  }
  const rng = prng.mulberry32(71);
  const r = synth.renderTemplate(rng, synth.parseTemplate('PAN: {PAN}, otp {DECOY:otp}.'), new Set());
  assert.equal(r.text.slice(r.gold[0].start, r.gold[0].end), r.gold[0].value);
  assert.equal(r.gold[0].start, 5);
  assert.match(r.text.slice(r.decoys[0].start, r.decoys[0].end), /^\d{6}$/);
});
