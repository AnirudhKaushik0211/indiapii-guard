'use strict';
// SPEC 5: redaction styles, token consistency, exclusion, mapping and findings validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const guard = require(path.join(__dirname, '..', 'js', 'guard.js'));
const redactor = require(path.join(__dirname, '..', 'js', 'redactor.js'));
const v = require(path.join(__dirname, '..', 'js', 'validators.js'));

const G1 = 'Aadhaar 2345 6789 0124, PAN ABCPE1234F, mobile +91 98765 43210, email asha.samplekar@example.com, ' +
  'UPI asha.samplekar@okaxis, IFSC ABCD0123456, a/c 50100012345678, card 4111 1111 1111 1111, GSTIN 27ABCPE1234F1ZB.';

const TOKEN = 'Aadhaar [AADHAAR_1], PAN [PAN_1], mobile [PHONE_1], email [EMAIL_1], UPI [UPI_1], IFSC [IFSC_1], ' +
  'a/c [BANK_ACCOUNT_1], card [CARD_1], GSTIN [GSTIN_1].';
const MASK = 'Aadhaar XXXX XXXX XXXX, PAN XXXXXXXXXX, mobile +XX XXXXX XXXXX, email XXXX.XXXXXXXXX@XXXXXXX.XXX, ' +
  'UPI XXXX.XXXXXXXXX@XXXXXX, IFSC XXXXXXXXXXX, a/c XXXXXXXXXXXXXX, card XXXX XXXX XXXX XXXX, GSTIN XXXXXXXXXXXXXXX.';
const PARTIAL = 'Aadhaar XXXX XXXX 0124, PAN XXXXXX234F, mobile +XX XXXXX X3210, email aXXX.XXXXXXXXX@example.com, ' +
  'UPI aXXX.XXXXXXXXX@okaxis, IFSC XXXXXXX3456, a/c XXXXXXXXXX5678, card XXXX XXXX XXXX 1111, GSTIN XXXXXXXXXXXF1ZB.';

// G2: the second Aadhaar is built at runtime in 4-4-4 grouping.
const SECOND = '98765432101' + v.verhoeffDigit('98765432101');
const SECOND_444 = SECOND.slice(0, 4) + ' ' + SECOND.slice(4, 8) + ' ' + SECOND.slice(8);
const G2 = 'Aadhaar 2345 6789 0124 again as 234567890124 and a second one ' + SECOND_444 + '.';

test('G1 token, mask and partial outputs exactly', () => {
  const t = guard.redact(G1);
  assert.equal(t.text, TOKEN);
  assert.equal(t.redactedCount, 9);
  assert.equal(guard.redact(G1, { style: 'token' }).text, TOKEN);
  assert.equal(guard.redact(G1, { style: 'mask' }).text, MASK);
  assert.equal(guard.redact(G1, { style: 'partial' }).text, PARTIAL);
  assert.deepEqual(Object.keys(t.stats).sort(), ['belowThreshold', 'candidates', 'disabled', 'overlapping']);
});

test('G1 mapping and replacements', () => {
  const t = guard.redact(G1);
  assert.equal(t.mapping.length, 9);
  assert.deepEqual(t.mapping[0], { key: 'AADHAAR:234567890124', entity: 'AADHAAR', token: '[AADHAAR_1]',
    text: '2345 6789 0124', count: 1 });
  assert.deepEqual(t.mapping.map((m) => m.token), ['[AADHAAR_1]', '[PAN_1]', '[PHONE_1]', '[EMAIL_1]', '[UPI_1]',
    '[IFSC_1]', '[BANK_ACCOUNT_1]', '[CARD_1]', '[GSTIN_1]']);
  assert.ok(t.findings.every((f) => f.excluded === false && f.replacement === '[' + f.entity + '_1]'));
  const m = guard.redact(G1, { style: 'mask' });
  assert.ok(m.mapping.every((e) => e.token === null && e.count === 1));
  assert.equal(m.findings[2].replacement, '+XX XXXXX XXXXX');
});

test('G2 consistency: same key, same token; numbering by first appearance', () => {
  assert.equal(SECOND, ['9876', '5432', '1012'].join(''));
  const r = guard.redact(G2);
  assert.equal(r.text, 'Aadhaar [AADHAAR_1] again as [AADHAAR_1] and a second one [AADHAAR_2].');
  assert.equal(r.redactedCount, 3);
  assert.deepEqual(r.mapping.map((m) => [m.key, m.token, m.text, m.count]), [
    ['AADHAAR:234567890124', '[AADHAAR_1]', '2345 6789 0124', 2],
    ['AADHAAR:' + SECOND, '[AADHAAR_2]', SECOND_444, 1]
  ]);
});

test('G2 exclusion leaves both occurrences and renumbers the other', () => {
  const r = guard.redact(G2, { exclude: ['AADHAAR:234567890124'] });
  assert.equal(r.text, 'Aadhaar 2345 6789 0124 again as 234567890124 and a second one [AADHAAR_1].');
  assert.equal(r.redactedCount, 1);
  assert.deepEqual(r.findings.map((f) => f.excluded), [true, true, false]);
  assert.equal(r.findings[0].replacement, '2345 6789 0124');
  assert.deepEqual(r.mapping.map((m) => m.key), ['AADHAAR:' + SECOND]);
});

test('re-detecting token output finds nothing', () => {
  for (const t of [G1, G2]) {
    const out = guard.redact(t).text;
    assert.deepEqual(guard.detect(out).findings, []);
    assert.deepEqual(guard.detect(out, { threshold: 'lenient' }).findings, []);
  }
});

test('replacement from the end keeps offsets valid with different lengths', () => {
  const text = 'ab cd ef';
  const findings = [
    { entity: 'PAN', start: 0, end: 2, value: 'A' },
    { entity: 'PAN', start: 3, end: 5, value: 'B' },
    { entity: 'IFSC', start: 6, end: 8, value: 'A' }
  ];
  const r = guard.applyRedaction(text, findings);
  assert.equal(r.text, '[PAN_1] [PAN_2] [IFSC_1]');
  assert.equal(guard.applyRedaction(text, findings, { style: 'partial' }).text, 'ab cd ef');
  assert.equal(guard.applyRedaction(text, findings, { style: 'mask' }).text, 'XX XX XX');
  assert.equal(guard.applyRedaction(text, []).text, text);
  assert.equal(findings[0].replacement, undefined, 'input findings are not mutated');
});

test('partial style details', () => {
  const text = 'a@x.test ab-cd';
  const r = guard.applyRedaction(text, [
    { entity: 'EMAIL', start: 0, end: 8, value: 'a@x.test' },
    { entity: 'PAN', start: 9, end: 14, value: 'ABCD' }
  ], { style: 'partial' });
  assert.equal(r.text, 'a@x.test ab-cd');
});

test('applyRedaction errors', () => {
  const t = 'abcdefghij';
  const f = (start, end, extra) => Object.assign({ entity: 'PAN', start, end, value: 'X' }, extra || {});
  const cases = [
    [[f(5, 7), f(0, 2)], RangeError],
    [[f(0, 4), f(3, 6)], RangeError],
    [[f(0, 11)], RangeError],
    [[f(-1, 2)], RangeError],
    [[f(3, 3)], RangeError],
    [[f(0, 2, { entity: 'FOO' })], TypeError],
    [[f(0, 2, { entity: undefined })], TypeError],
    [[f(0.5, 2)], TypeError],
    [[f('0', 2)], TypeError],
    [[f(0, 2, { value: 5 })], TypeError],
    [[null], TypeError],
    ['nope', TypeError],
    [undefined, TypeError]
  ];
  for (const [findings, type] of cases) {
    assert.throws(() => guard.applyRedaction(t, findings), type, JSON.stringify(findings));
    assert.throws(() => redactor.applyRedaction(t, findings), type);
  }
  assert.throws(() => guard.applyRedaction(5, []), { name: 'TypeError', message: 'text must be a string' });
  assert.throws(() => guard.applyRedaction(t, [], { style: 'blur' }),
    { name: 'TypeError', message: 'style must be token, mask or partial' });
  assert.throws(() => guard.applyRedaction(t, [], null), { name: 'TypeError', message: 'options must be an object' });
  // detect output always passes.
  const d = guard.detect(G1);
  assert.equal(guard.applyRedaction(G1, d.findings).text, TOKEN);
});
