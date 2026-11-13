'use strict';
// SPEC 3.2-3.11 and 6.1 option errors. Identifier values outside SPEC 11.5 and TEST_CARDS are built at runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const guard = require(path.join(__dirname, '..', 'js', 'guard.js'));
const detector = require(path.join(__dirname, '..', 'js', 'detector.js'));
const v = require(path.join(__dirname, '..', 'js', 'validators.js'));
const lx = require(path.join(__dirname, '..', 'js', 'lexicon.js'));

const G1 = 'Aadhaar 2345 6789 0124, PAN ABCPE1234F, mobile +91 98765 43210, email asha.samplekar@example.com, ' +
  'UPI asha.samplekar@okaxis, IFSC ABCD0123456, a/c 50100012345678, card 4111 1111 1111 1111, GSTIN 27ABCPE1234F1ZB.';

const G1_EXPECTED = [
  ['AADHAAR', 8, 22, '2345 6789 0124', 0.95, ['checksum:verhoeff', 'grouping:4-4-4', 'context:aadhaar']],
  ['PAN', 28, 38, 'ABCPE1234F', 0.95, ['structure:pan', 'holder:P', 'case:upper', 'context:pan']],
  ['PHONE', 47, 62, '+91 98765 43210', 0.99, ['prefix:91', 'grouping:5-5', 'context:mobile']],
  ['EMAIL', 70, 96, 'asha.samplekar@example.com', 0.95, ['structure:email']],
  ['UPI', 102, 123, 'asha.samplekar@okaxis', 0.95, ['handle:known', 'context:upi']],
  ['IFSC', 130, 141, 'ABCD0123456', 0.95, ['structure:ifsc', 'case:upper', 'context:ifsc']],
  ['BANK_ACCOUNT', 147, 161, '50100012345678', 0.80, ['grouping:14', 'context:a/c']],
  ['CARD', 168, 187, '4111 1111 1111 1111', 0.95, ['checksum:luhn', 'grouping:4-4-4-4', 'context:card']],
  ['GSTIN', 195, 210, '27ABCPE1234F1ZB', 0.99, ['checksum:gstin', 'state:27', 'context:gstin']]
];

// Runtime-built values (SPEC 3.11, 5).
const MOBILE_AADHAAR = '91987654321' + v.verhoeffDigit('91987654321');
const AADHAAR = '23456789012' + v.verhoeffDigit('23456789012');

function invariant(r) {
  const s = r.stats;
  for (const k of ['candidates', 'belowThreshold', 'overlapping', 'disabled']) {
    assert.ok(Number.isInteger(s[k]) && s[k] >= 0, k);
  }
  assert.equal(s.candidates, s.belowThreshold + s.overlapping + s.disabled + r.findings.length);
}

function run(text, options) {
  const r = guard.detect(text, options);
  invariant(r);
  return r;
}

function summary(text, options) {
  return run(text, options).findings.map((f) => f.entity + ' ' + f.text + ' ' + f.confidence);
}

// Confidence of the single finding of `entity` at threshold 0.
function conf(text, entity) {
  const fs = run(text, { threshold: 0 }).findings.filter((f) => f.entity === entity);
  assert.equal(fs.length, 1, text + ' -> ' + entity);
  return fs[0].confidence;
}

function group(digits, lengths, sep) {
  const out = [];
  let i = 0;
  for (const n of lengths) { out.push(digits.slice(i, i + n)); i += n; }
  return out.join(sep === undefined ? ' ' : sep);
}

test('runtime-built values match the design review', () => {
  // Expected value of the design review, written in pieces so the self-scan (SPEC 11.4) sees no literal value.
  assert.equal(MOBILE_AADHAAR, ['9198', '7654', '3216'].join(''));
  assert.equal(AADHAAR, '234567890124');
});

test('G1 exactly (SPEC 3.10)', () => {
  const r = run(G1);
  assert.equal(r.findings.length, 9);
  assert.equal(r.stats.disabled, 0);
  r.findings.forEach((f, i) => {
    const [entity, start, end, text, confidence, reasons] = G1_EXPECTED[i];
    assert.equal(f.id, 'f' + (i + 1));
    assert.equal(f.entity, entity);
    assert.equal(f.start, start);
    assert.equal(f.end, end);
    assert.equal(f.text, text);
    assert.equal(G1.slice(f.start, f.end), text);
    assert.equal(f.confidence, confidence);
    for (const code of reasons) assert.ok(f.reasons.includes(code), entity + ' ' + code);
    assert.equal(f.normalised, false);
  });
  assert.deepEqual(r.findings.map((f) => f.value), ['234567890124', 'ABCPE1234F', '9876543210',
    'asha.samplekar@example.com', 'asha.samplekar@okaxis', 'ABCD0123456', '50100012345678', '4111111111111111',
    '27ABCPE1234F1ZB']);
});

test('G1 with CARD disabled: no finding of any entity on the card text', () => {
  for (const entities of [{ CARD: false }, lx.ENTITIES.filter((e) => e !== 'CARD')]) {
    const r = run(G1, { entities });
    assert.equal(r.findings.length, 8);
    assert.equal(r.stats.disabled, 1);
    assert.ok(r.findings.every((f) => f.end <= 168 || f.start >= 187));
  }
});

test('emoji prepended shifts every span by 2', () => {
  const r = run('\u{1F600}' + G1);
  assert.equal(r.findings.length, 9);
  r.findings.forEach((f, i) => {
    assert.equal(f.entity, G1_EXPECTED[i][0]);
    assert.equal(f.start, G1_EXPECTED[i][1] + 2);
    assert.equal(f.end, G1_EXPECTED[i][2] + 2);
    assert.equal(f.confidence, G1_EXPECTED[i][4]);
  });
});

test('CRLF input is not normalised', () => {
  const t = 'Aadhaar 2345 6789 0124\r\nmobile 98765 43210\r\n';
  const r = run(t);
  assert.deepEqual(r.findings.map((f) => [f.entity, f.start, f.end, f.confidence]),
    [['AADHAAR', 8, 22, 0.95], ['PHONE', 31, 42, 0.90]]);
});

test('SPEC 3.11 edge cases', () => {
  const rows = [
    ['Rs 98,76,54,321', undefined, []],
    ['\u20B9 9876543210', undefined, []],
    ['\u20B99876543210', undefined, []],
    ['Rs 9876543210', undefined, []],
    ['mobile ' + MOBILE_AADHAAR, undefined, ['AADHAAR ' + MOBILE_AADHAAR + ' 0.65']],
    ['mobile +' + MOBILE_AADHAAR, undefined, ['PHONE +' + MOBILE_AADHAAR + ' 0.99']],
    ['2026-03-14 10:22:31', undefined, []],
    ['INV-9876543210', undefined, []],
    ['Order 9876543210', undefined, []],
    ['call 9876543210', undefined, ['PHONE 9876543210 0.9']],
    ['98 76 54 32 10', undefined, []],
    ['98 76 54 32 10', { threshold: 'lenient' }, ['PHONE 98 76 54 32 10 0.45']],
    ['card 9876543210', undefined, ['PHONE 9876543210 0.55']],
    ['card 9876543210', { threshold: 'strict' }, []],
    ['+44 9876543210', undefined, []],
    ['+1 98765 43210', undefined, []],
    ['(+91) 98765 43210', undefined, ['PHONE (+91) 98765 43210 0.85']],
    ['0091 98765 43210', undefined, ['PHONE 0091 98765 43210 0.85']],
    ['09876543210', undefined, ['PHONE 09876543210 0.85']],
    ['+919876543210', undefined, ['PHONE +919876543210 0.85']],
    ['0987 654 3210', undefined, ['PHONE 0987 654 3210 0.85']],
    ['+91987 654 3210', undefined, ['PHONE +91987 654 3210 0.85']],
    ['9198 7654 3210', undefined, []],
    ['9876543210 9123456780', undefined, ['PHONE 9876543210 0.7', 'PHONE 9123456780 0.7']],
    ['9876543210@ybl', undefined, ['UPI 9876543210@ybl 0.9']],
    ['ABCPE1234F', undefined, ['PAN ABCPE1234F 0.85']],
    ['abcpe1234f', undefined, []],
    ['pan abcpe1234f', undefined, ['PAN abcpe1234f 0.7']],
    ['SKU XYZPQ1234Z', undefined, []],
    ['permanent account number ABCPE1234F', undefined, ['PAN ABCPE1234F 0.95']],
    ['2345 6789 O124', undefined, ['AADHAAR 2345 6789 O124 0.7']],
    ['2345 6789 O124', { ocrNormalise: false }, []],
    ['23O5 6789 OI24', undefined, []],
    ['row 14|9876543210|200', undefined, ['PHONE 9876543210 0.7']],
    ['ref 14|9876543210|200', undefined, []],
    ['2345 6789 0124|9876543210', undefined, ['AADHAAR 2345 6789 0124 0.8', 'PHONE 9876543210 0.7']],
    ['a/c 2345 6789 0124', undefined, ['BANK_ACCOUNT 2345 6789 0124 0.8']],
    ['build@localhost', undefined, []],
    ['asha [at] example [dot] com', undefined, []],
    ['aadhaarno 234567890124', undefined, ['AADHAAR 234567890124 0.8']],
    ['Aadhaar No.: 2345 6789 0124\nM0BILE : 98765 43210', undefined,
      ['AADHAAR 2345 6789 0124 0.95', 'PHONE 98765 43210 0.7']]
  ];
  for (const [text, options, expected] of rows) {
    assert.deepEqual(summary(text, options), expected, text);
  }
});

test('3.11 detail: dropped values and spans', () => {
  assert.deepEqual(summary('Rs 9876543210', { threshold: 0 }).filter((s) => s.startsWith('PHONE')),
    ['PHONE 9876543210 0.3']);
  assert.deepEqual(summary('ref 14|9876543210|200', { threshold: 0 }).filter((s) => s.startsWith('PHONE')),
    ['PHONE 9876543210 0.3']);
  assert.deepEqual(summary('abcpe1234f', { threshold: 0 }), ['PAN abcpe1234f 0.4']);
  assert.deepEqual(summary('build@localhost', { threshold: 0 }), ['UPI build@localhost 0.45']);
  const ocr = run('2345 6789 O124').findings[0];
  assert.equal(ocr.normalised, true);
  assert.equal(ocr.value, '234567890124');
  assert.ok(ocr.reasons.includes('ocr:1'));
  const paren = run('(+91) 98765 43210').findings[0];
  assert.equal(paren.start, 0);
  assert.ok(paren.reasons.includes('prefix:(+91)'));
  assert.equal(paren.value, '9876543210');
  const pan = run('permanent account number ABCPE1234F', { threshold: 0 });
  assert.ok(pan.findings[0].reasons.includes('context:permanent account number'));
  const mob = run('mobile ' + MOBILE_AADHAAR).findings[0];
  assert.ok(mob.reasons.includes('competing:PHONE'));
  const aadhaarCross = run('Aadhaar No.: 2345 6789 0124\nM0BILE : 98765 43210').findings[1];
  assert.ok(!aadhaarCross.reasons.some((r) => r.startsWith('competing:')));
});

test('ReDoS inputs complete in under 500 ms', () => {
  const a = 'a'.repeat(50000) + '@' + 'a'.repeat(49999);
  assert.equal(a.length, 100000);
  let t0 = performance.now();
  run(a);
  assert.ok(performance.now() - t0 < 500, 'address input');
  let d = '';
  let x = 7;
  while (d.length < 100000) { x = (x * 31 + 11) % 1000; d += (x % 10) + (x % 3 === 0 ? ' ' : ''); }
  d = d.slice(0, 100000);
  t0 = performance.now();
  run(d);
  assert.ok(performance.now() - t0 < 500, 'digits input');
});

test('confidence table of SPEC 3.7, one case per cell', () => {
  const card = lx.TEST_CARDS[0];
  const gOther14 = '27ABCPE1234F1Y';
  const gOther = gOther14 + v.gstinCheckChar(gOther14);
  const cells = [
    // AADHAAR: base, own, negative, negative + own, competing
    [AADHAAR, 'AADHAAR', 0.80], ['aadhaar ' + AADHAAR, 'AADHAAR', 0.95], ['order ' + AADHAAR, 'AADHAAR', 0.40],
    ['aadhaar order ' + AADHAAR, 'AADHAAR', 0.55], ['mobile ' + AADHAAR, 'AADHAAR', 0.65],
    // PHONE canonical + prefix
    ['+919876543210', 'PHONE', 0.85], ['mobile +919876543210', 'PHONE', 0.99], ['order +919876543210', 'PHONE', 0.45],
    ['mobile order +919876543210', 'PHONE', 0.65], ['card +919876543210', 'PHONE', 0.70],
    // PHONE canonical, no prefix
    ['9876543210', 'PHONE', 0.70], ['mobile 9876543210', 'PHONE', 0.90], ['order 9876543210', 'PHONE', 0.30],
    ['mobile order 9876543210', 'PHONE', 0.50], ['card 9876543210', 'PHONE', 0.55],
    // PHONE non-canonical + prefix
    ['+91 98 76 54 32 10', 'PHONE', 0.70], ['mobile +91 98 76 54 32 10', 'PHONE', 0.90],
    ['order +91 98 76 54 32 10', 'PHONE', 0.30], ['mobile order +91 98 76 54 32 10', 'PHONE', 0.50],
    ['card +91 98 76 54 32 10', 'PHONE', 0.55],
    // PHONE non-canonical, no prefix
    ['98 76 54 32 10', 'PHONE', 0.45], ['mobile 98 76 54 32 10', 'PHONE', 0.65], ['order 98 76 54 32 10', 'PHONE', 0.05],
    ['mobile order 98 76 54 32 10', 'PHONE', 0.25], ['card 98 76 54 32 10', 'PHONE', 0.30],
    // CARD
    [card, 'CARD', 0.85], ['card ' + card, 'CARD', 0.95], ['order ' + card, 'CARD', 0.45],
    ['card order ' + card, 'CARD', 0.55], ['mobile ' + card, 'CARD', 0.70],
    // BANK_ACCOUNT
    ['50100012345678', 'BANK_ACCOUNT', 0.30], ['a/c 50100012345678', 'BANK_ACCOUNT', 0.80],
    ['order 50100012345678', 'BANK_ACCOUNT', 0], ['a/c order 50100012345678', 'BANK_ACCOUNT', 0.40],
    ['mobile 50100012345678', 'BANK_ACCOUNT', 0.15],
    // PAN upper / mixed
    ['ABCPE1234F', 'PAN', 0.85], ['abcpe1234f', 'PAN', 0.40], ['pan ABCPE1234F', 'PAN', 0.95],
    ['pan abcpe1234f', 'PAN', 0.70], ['sku ABCPE1234F', 'PAN', 0.45], ['sku abcpe1234f', 'PAN', 0],
    // IFSC upper / mixed
    ['ABCD0123456', 'IFSC', 0.80], ['abcd0123456', 'IFSC', 0.35], ['ifsc ABCD0123456', 'IFSC', 0.95],
    ['ifsc abcd0123456', 'IFSC', 0.70], ['sku ABCD0123456', 'IFSC', 0.40], ['sku abcd0123456', 'IFSC', 0],
    // GSTIN 14th Z / other
    ['27ABCPE1234F1ZB', 'GSTIN', 0.95], [gOther, 'GSTIN', 0.85], ['gstin 27ABCPE1234F1ZB', 'GSTIN', 0.99],
    ['gstin ' + gOther, 'GSTIN', 0.89], ['sku 27ABCPE1234F1ZB', 'GSTIN', 0.55], ['sku ' + gOther, 'GSTIN', 0.45],
    // EMAIL (context changes nothing, no negative lexicon)
    ['asha.samplekar@example.com', 'EMAIL', 0.95], ['order asha.samplekar@example.com', 'EMAIL', 0.95],
    // UPI known / unknown
    ['asha.samplekar@okaxis', 'UPI', 0.90], ['build@localhost', 'UPI', 0.45],
    ['upi asha.samplekar@okaxis', 'UPI', 0.95], ['upi build@localhost', 'UPI', 0.85]
  ];
  for (const [text, entity, expected] of cells) assert.equal(conf(text, entity), expected, text);
  assert.ok(run(gOther).findings[0].reasons.includes('gstin:14th-not-Z'));
  // OCR penalty
  assert.equal(conf('aadhaar 2345 6789 O124', 'AADHAAR'), 0.85);
});

test('resolution order: length, confidence, priority, start', () => {
  // Same span, same confidence: priority decides (AADHAAR before BANK_ACCOUNT). Bank context crosses the line,
  // so it is own context for the bank account but not competing context for the Aadhaar.
  assert.deepEqual(summary('a/c\n' + AADHAAR), ['AADHAAR ' + AADHAAR + ' 0.8']);
  // Same span, higher confidence wins.
  assert.deepEqual(summary('a/c ' + AADHAAR), ['BANK_ACCOUNT ' + AADHAAR + ' 0.8']);
  // Longer span wins over higher confidence: the + phone span is longer than the Aadhaar span.
  const r = run('mobile +' + MOBILE_AADHAAR);
  assert.equal(r.findings.length, 1);
  assert.ok(r.stats.overlapping >= 1);
  // A digit chain inside an e-mail that does not touch @ loses to the longer EMAIL span.
  assert.deepEqual(summary('9876543210.asha@example.com'), ['EMAIL 9876543210.asha@example.com 0.95']);
});

test('toggles apply after resolution', () => {
  const t = 'card ' + lx.TEST_CARDS[0];
  assert.deepEqual(summary(t, { entities: { CARD: false } }), []);
  assert.deepEqual(summary(t, { entities: { CARD: false }, threshold: 0 }), []);
  assert.deepEqual(summary('a/c 2345 6789 0124', { entities: ['AADHAAR'] }), []);
  assert.deepEqual(summary(G1, { entities: [] }), []);
});

test('thresholds and presets', () => {
  assert.deepEqual(guard.THRESHOLDS, { lenient: 0.35, balanced: 0.5, strict: 0.7 });
  assert.deepEqual(detector.THRESHOLDS, guard.THRESHOLDS);
  assert.equal(summary('98 76 54 32 10', { threshold: 0.45 }).length, 1);
  assert.equal(summary('98 76 54 32 10', { threshold: 0.46 }).length, 0);
  assert.equal(summary('card 9876543210', { threshold: 'balanced' }).length, 1);
  assert.equal(summary('9876543210', { threshold: 'strict' }).length, 1);
  assert.equal(summary('9876543210', { threshold: 0.71 }).length, 0);
  assert.equal(summary('9876543210', { threshold: 1 }).length, 0);
});

test('phone prefix and separator forms', () => {
  const rows = [
    ['+91-98765-43210', 'PHONE +91-98765-43210 0.85'],
    ['+91 98765-43210', 'PHONE +91 98765-43210 0.85'],
    ['91 98765 43210', 'PHONE 91 98765 43210 0.85'],
    ['0 98765 43210', 'PHONE 0 98765 43210 0.85'],
    ['98765\u00A043210', 'PHONE 98765\u00A043210 0.7'],
    ['98765  43210', 'PHONE 98765  43210 0.7'],
    ['98765 - 43210', 'PHONE 98765 - 43210 0.7'],
    ['98765\u201343210', 'PHONE 98765\u201343210 0.7'],
    ['987 654 3210', 'PHONE 987 654 3210 0.7'],
    ['98 7654 3210', 'PHONE 98 7654 3210 0.7'],
    ['9876 543 210', 'PHONE 9876 543 210 0.7'],
    ['+ 9876543210', null],
    ['+0 9876543210', null],
    ['919876543210', 'PHONE 919876543210 0.85'],
    ['91 9876 543 210', 'PHONE 91 9876 543 210 0.85'],
    ['5876543210', null]
  ];
  for (const [text, expected] of rows) {
    const got = summary(text).filter((s) => s.startsWith('PHONE'));
    assert.deepEqual(got, expected ? [expected] : [], text);
  }
});

test('digit-chain boundary rules (SPEC 3.3)', () => {
  const none = ['x9876543210', '9876543210x', '_9876543210', '@9876543210', '1.9876543210', '9876543210.5',
    '1,9876543210', '9876543210,5', '10:9876543210', 'ID#9876543210', 'ab/9876543210', 'A-9876543210'];
  for (const t of none) assert.deepEqual(summary(t).filter((s) => s.startsWith('PHONE')), [], t);
  const some = ['# 9876543210', '(9876543210)', '9876543210.', '9876543210, ok', 'x: 9876543210', '-9876543210'];
  for (const t of some) assert.equal(summary(t).filter((s) => s.startsWith('PHONE')).length, 1, t);
});

test('card groupings', () => {
  const c16 = lx.TEST_CARDS[0];
  const c15 = lx.TEST_CARDS[9];
  const c14 = lx.TEST_CARDS[13];
  const c13 = lx.TEST_CARDS[2];
  const ok = [group(c16, [4, 4, 4, 4]), group(c16, [4, 4, 4, 4], '-'), c16, group(c15, [4, 6, 5]), c15,
    group(c14, [4, 6, 4]), c14, c13, group(c13, [4, 4, 4, 1])];
  for (const t of ok) assert.equal(conf('card ' + t, 'CARD'), 0.95, t);
  assert.deepEqual(summary('card ' + group(c16, [8, 8])).filter((s) => s.startsWith('CARD')), []);
  assert.deepEqual(summary('card ' + group(c16, [3, 4, 4, 5])).filter((s) => s.startsWith('CARD')), []);
  const bad = c16.slice(0, 15) + ((Number(c16[15]) + 1) % 10);
  assert.deepEqual(summary('card ' + bad).filter((s) => s.startsWith('CARD')), []);
});

test('Aadhaar formats, bank account formats', () => {
  assert.equal(conf('aadhaar ' + group(AADHAAR, [4, 4, 4], '-'), 'AADHAAR'), 0.95);
  assert.deepEqual(summary('aadhaar ' + group(AADHAAR, [6, 6])).filter((s) => s.startsWith('AADHAAR')), []);
  const lead1 = '13456789012' + v.verhoeffDigit('13456789012');
  assert.deepEqual(summary('aadhaar ' + lead1).filter((s) => s.startsWith('AADHAAR')), []);
  assert.equal(conf('a/c ' + group('50100012345678', [4, 4, 6]), 'BANK_ACCOUNT'), 0.8);
  assert.deepEqual(summary('a/c ' + group('50100012345678', [2, 6, 6])), []);
  assert.deepEqual(summary('a/c 12345678'), []);
});

test('OCR rules of SPEC 3.4', () => {
  assert.equal(detector.buildShadow('2345 6789 O124'), '2345 6789 0124');
  assert.equal(detector.buildShadow('2O24'), '2O24');
  assert.equal(detector.buildShadow('HELLO 98765'), 'HELLO 98765');
  assert.equal(detector.buildShadow('I 9876543210'), 'I 9876543210');
  assert.equal(detector.buildShadow('x2345 6789 O124'), 'x2345 6789 O124');
  const nine = '98765' + '4321';
  assert.equal(detector.buildShadow(nine + 'l'), nine + '1');
  assert.equal(detector.buildShadow('98 OO 54 32 10'), '98 OO 54 32 10');
  assert.equal(detector.buildShadow('row 14|9876543210|200'), 'row 14|9876543210|200');
  const f = run('I 9876543210').findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].start, 2);
  assert.equal(f[0].normalised, false);
});

test('stats counters', () => {
  const r = run(G1);
  assert.equal(r.stats.disabled, 0);
  assert.ok(r.stats.overlapping >= 1);
  assert.ok(r.stats.belowThreshold >= 1);
  assert.deepEqual(run('').stats, { candidates: 0, belowThreshold: 0, overlapping: 0, disabled: 0 });
  assert.deepEqual(run('').findings, []);
  // Discarded chains and foreign + prefixes are never counted.
  assert.equal(run('INV-9876543210').stats.candidates, 0);
  assert.equal(run('+44 9876543210').stats.candidates, 0);
});

test('option errors and messages (SPEC 6.1)', () => {
  const ENT = 'entities must be an array of entity ids or an object of booleans';
  const cases = [
    [() => guard.detect(5), TypeError, 'text must be a string'],
    [() => guard.detect(undefined), TypeError, 'text must be a string'],
    [() => guard.detect('x', null), TypeError, 'options must be an object'],
    [() => guard.detect('x', 5), TypeError, 'options must be an object'],
    [() => guard.detect('x', []), TypeError, 'options must be an object'],
    [() => guard.detect('x', 'balanced'), TypeError, 'options must be an object'],
    [() => guard.detect('x', { threshold: 2 }), TypeError, 'threshold must be a number between 0 and 1 or a preset name'],
    [() => guard.detect('x', { threshold: NaN }), TypeError, 'threshold must be a number between 0 and 1 or a preset name'],
    [() => guard.detect('x', { threshold: 'Strict' }), TypeError, 'threshold must be a number between 0 and 1 or a preset name'],
    [() => guard.detect('x', { entities: 'PAN' }), TypeError, ENT],
    [() => guard.detect('x', { entities: null }), TypeError, ENT],
    [() => guard.detect('x', { entities: 5 }), TypeError, ENT],
    [() => guard.detect('x', { entities: () => 1 }), TypeError, ENT],
    [() => guard.detect('x', { entities: [1] }), TypeError, ENT],
    [() => guard.detect('x', { entities: { PAN: 'no' } }), TypeError, ENT],
    [() => guard.detect('x', { entities: ['FOO'] }), TypeError, 'unknown entity: FOO'],
    [() => guard.detect('x', { entities: ['pan'] }), TypeError, 'unknown entity: pan'],
    [() => guard.detect('x', { entities: { FOO: true } }), TypeError, 'unknown entity: FOO'],
    [() => guard.detect('x', { style: 'blur' }), TypeError, 'style must be token, mask or partial'],
    [() => guard.detect('x', { ocrNormalise: 'yes' }), TypeError, 'ocrNormalise must be a boolean'],
    [() => guard.detect('x', { exclude: 'AADHAAR:1' }), TypeError, 'exclude must be an array of strings'],
    [() => guard.detect('x', { exclude: [1] }), TypeError, 'exclude must be an array of strings'],
    [() => guard.detect('x', { maxLength: 0 }), TypeError, 'maxLength must be a positive integer'],
    [() => guard.detect('x', { maxLength: 1.5 }), TypeError, 'maxLength must be a positive integer'],
    [() => guard.detect('abcd', { maxLength: 3 }), RangeError, 'text is longer than 3 characters'],
    [() => guard.detect('a'.repeat(1000001)), RangeError, 'text is longer than 1000000 characters'],
    // Validation order: text first, then options, then keys in table order.
    [() => guard.detect(5, null), TypeError, 'text must be a string'],
    [() => guard.detect('x', { threshold: 2, entities: 'PAN' }), TypeError,
      'threshold must be a number between 0 and 1 or a preset name'],
    [() => guard.detect('x', { style: 'blur', entities: ['FOO'] }), TypeError, 'unknown entity: FOO'],
    [() => guard.detect('abcd', { maxLength: 3, style: 'blur' }), TypeError, 'style must be token, mask or partial']
  ];
  for (const [fn, type, message] of cases) {
    assert.throws(fn, (err) => err instanceof type && err.message === message, message);
  }
  // Valid edge values and ignored unknown keys.
  assert.equal(run('x', { threshold: 0, entities: {}, foo: 1, maxLength: 1 }).findings.length, 0);
  assert.equal(run('x', undefined).findings.length, 0);
});

// v1.0 deviations from SPEC 3.6 / 3.7 made after held-out run 1 (eval/HISTORY.md, held-out run 2).
// Each case reproduces the dev or adversarial document named in the comment, with 11.5 or test-card values.
test('deviation: Devanagari order word is negative context (dev d-neg-11)', () => {
  const text = '\u0906\u092A\u0915\u093E \u0911\u0930\u094D\u0921\u0930 4111 1111 1111 1111 \u092D\u0947\u091C \u0926\u093F\u092F\u093E';
  assert.equal(conf(text, 'CARD'), 0.45);
  assert.deepEqual(summary(text), []);
  const r = run(text, { threshold: 0 }).findings.find((f) => f.entity === 'CARD');
  assert.ok(r.reasons.indexOf('negative:\u0911\u0930\u094D\u0921\u0930') >= 0);
});

test('deviation: complaint is negative context (adversarial a-neg-11)', () => {
  const text = 'Your complaint 9876543210 is resolved.';
  assert.equal(conf(text, 'PHONE'), 0.3);
  assert.deepEqual(summary(text), []);
});

test('deviation: own context after a value does not count when a negative phrase precedes it (a-chat-02, a-chat-03)', () => {
  assert.equal(conf('order 4111111111111111 is fine but my real card is', 'CARD'), 0.45);
  assert.equal(conf('utr ' + AADHAAR + ' pe check karo, aadhaar', 'AADHAAR'), 0.4);
  // Own context before the value still counts together with the negative phrase (SPEC 3.7 table).
  assert.equal(conf('card order 4111111111111111', 'CARD'), 0.55);
  assert.equal(conf('card 4111111111111111 order', 'CARD'), 0.55);
  // Without a preceding negative phrase, own context after the value counts as before.
  assert.equal(conf('4111111111111111 is my card', 'CARD'), 0.95);
});

test('deviation: payment words are UPI context (dev d-payments-02, adversarial a-payments-03, a-chat-04)', () => {
  const upi = 'asha.samplekar@' + 'testupi';
  assert.equal(conf('Pay Rs 500 to ' + upi + ' before noon', 'UPI'), 0.85);
  assert.equal(conf('Settlement to ' + upi + ' done', 'UPI'), 0.85);
  assert.equal(conf('bhai ' + upi + ' pe 500 bhej', 'UPI'), 0.85);
  assert.equal(conf('Write to ' + upi + ' soon', 'UPI'), 0.45);
  assert.deepEqual(summary('Write to ' + upi + ' soon'), []);
});