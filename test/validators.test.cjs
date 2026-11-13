'use strict';
// SPEC 4.1-4.6: validator vectors and properties.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const v = require(path.join(__dirname, '..', 'js', 'validators.js'));
const lexicon = require(path.join(__dirname, '..', 'js', 'lexicon.js'));

test('Verhoeff published vectors', () => {
  assert.equal(v.verhoeffDigit('236'), 3);
  assert.equal(v.verhoeffCheck('2363'), true);
  assert.equal(v.verhoeffCheck('2364'), false);
  assert.equal(v.verhoeffDigit('12345'), 1);
  assert.equal(v.verhoeffDigit('142857'), 0);
});

test('Verhoeff detects every single substitution and adjacent transposition', () => {
  const base = '23456789012';
  const valid = base + v.verhoeffDigit(base);
  assert.equal(valid, '234567890124');
  assert.equal(v.verhoeffCheck(valid), true);
  assert.equal(v.isAadhaar(valid), true);
  for (let i = 0; i < valid.length; i++) {
    for (let d = 0; d <= 9; d++) {
      if (String(d) === valid[i]) continue;
      const s = valid.slice(0, i) + d + valid.slice(i + 1);
      assert.equal(v.verhoeffCheck(s), false, 'substitution at ' + i);
    }
  }
  for (let i = 0; i + 1 < valid.length; i++) {
    if (valid[i] === valid[i + 1]) continue;
    const s = valid.slice(0, i) + valid[i + 1] + valid[i] + valid.slice(i + 2);
    assert.equal(v.verhoeffCheck(s), false, 'transposition at ' + i);
  }
});

test('isAadhaar requires 12 digits starting 2-9', () => {
  const base = '13456789012';
  const lead1 = base + v.verhoeffDigit(base);
  assert.equal(v.verhoeffCheck(lead1), true);
  assert.equal(v.isAadhaar(lead1), false);
  assert.equal(v.isAadhaar('23456789012'), false);
  assert.equal(v.isAadhaar('2345 6789 0124'), false);
});

test('Luhn vectors', () => {
  assert.equal(v.luhnCheck('79927398713'), true);
  assert.equal(v.luhnCheck('79927398710'), false);
  assert.equal(v.luhnDigit('7992739871'), 3);
  assert.equal(v.luhnCheck('0'), false);
  for (const c of lexicon.TEST_CARDS) {
    assert.equal(v.luhnCheck(c), true, c);
    assert.equal(v.isCardNumber(c), true, c);
  }
});

test('Luhn runtime 19-digit case', () => {
  const base = '600000000000000000';
  assert.equal(v.luhnDigit(base), 4);
  const n = base + v.luhnDigit(base);
  assert.equal(n.length, 19);
  assert.equal(v.luhnCheck(n), true);
  assert.equal(v.isCardNumber(n), true);
});

test('Luhn known weakness: 09 <-> 90 swap is not detected', () => {
  // Build a valid number containing "09" at runtime, then swap it.
  const base = '4000000009000';
  const n = base + v.luhnDigit(base);
  assert.equal(v.luhnCheck(n), true);
  const idx = n.indexOf('09');
  const swapped = n.slice(0, idx) + '90' + n.slice(idx + 2);
  assert.notEqual(swapped, n);
  assert.equal(v.luhnCheck(swapped), true);
});

test('PAN structure and holder letters', () => {
  assert.equal(v.isPan('ABCPE1234F'), true);
  assert.equal(v.isPan('abcpe1234f'), true);
  assert.equal(v.panHolderType('ABCPE1234F'), 'individual');
  const expected = { A: 'association of persons', B: 'body of individuals', C: 'company', F: 'firm', G: 'government',
    H: 'Hindu undivided family', J: 'artificial juridical person', L: 'local authority', P: 'individual', T: 'trust' };
  for (const k of Object.keys(expected)) {
    const s = 'ABC' + k + 'E1234F';
    assert.equal(v.isPan(s), true, k);
    assert.equal(v.panHolderType(s), expected[k]);
  }
  for (const k of ['X', 'Z', 'D', 'E']) {
    assert.equal(v.isPan('ABC' + k + 'E1234F'), false, k);
    assert.equal(v.panHolderType('ABC' + k + 'E1234F'), null);
  }
  assert.equal(v.isPan('ABCPE1234'), false);
  assert.equal(v.isPan('ABCPE12345'), false);
});

test('IFSC: 5th character must be the digit 0', () => {
  assert.equal(v.isIfsc('ABCD0123456'), true);
  assert.equal(v.isIfsc('abcd0123456'), true);
  assert.equal(v.isIfsc('ABCDO123456'), false);
  assert.equal(v.isIfsc('ABCD1123456'), false);
  assert.equal(v.isIfsc('ABCD012345'), false);
});

test('GSTIN worked example and invalid check character', () => {
  assert.equal(v.gstinCheckChar('27ABCPE1234F1Z'), 'B');
  assert.equal(v.gstinCheck('27ABCPE1234F1ZB'), true);
  assert.equal(v.isGstin('27ABCPE1234F1ZB'), true);
  assert.equal(v.gstinCheck('27ABCPE1234F1ZC'), false);
  assert.equal(v.isGstin('27ABCPE1234F1ZC'), false);
  assert.equal(v.gstinCheck('27abcpe1234f1zb'), false);
});

test('GSTIN state codes', () => {
  assert.equal(v.GST_STATE_CODES.length, 40);
  assert.ok(v.GST_STATE_CODES.includes('01'));
  assert.ok(v.GST_STATE_CODES.includes('38'));
  assert.ok(v.GST_STATE_CODES.includes('97'));
  assert.ok(v.GST_STATE_CODES.includes('99'));
  for (const code of ['00', '39', '98']) {
    assert.ok(!v.GST_STATE_CODES.includes(code));
    const first14 = code + 'ABCPE1234F1Z';
    const g = first14 + v.gstinCheckChar(first14);
    assert.equal(v.gstinCheck(g), true);
    assert.equal(v.isGstin(g), false, code);
  }
});

test('GSTIN round trip over 200 generated strings', () => {
  const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const H = 'ABCFGHLJPT';
  let x = 12345;
  const next = (n) => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
  for (let k = 0; k < 200; k++) {
    const st = v.GST_STATE_CODES[next(v.GST_STATE_CODES.length)];
    let s = st + L[next(26)] + L[next(26)] + L[next(26)] + H[next(10)] + L[next(26)];
    for (let i = 0; i < 4; i++) s += String(next(10));
    s += L[next(26)] + '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[next(35)] + 'Z';
    const c = v.gstinCheckChar(s);
    assert.equal(v.isGstin(s + c), true, s + c);
    for (const other of A) {
      if (other === c) continue;
      assert.equal(v.gstinCheck(s + other), false);
    }
  }
});

test('other helpers', () => {
  assert.equal(v.isIndianMobile('9876543210'), true);
  assert.equal(v.isIndianMobile('5876543210'), false);
  assert.equal(v.isIndianMobile('987654321'), false);
  assert.equal(v.digitsOnly('+91 98765-43210'), '919876543210');
  assert.equal(v.isCardNumber('4111111111111112'), false);
  assert.equal(v.isCardNumber('7992739871'), false);
});

test('non-string and wrong-length inputs return false or null without throwing', () => {
  const bad = [undefined, null, 5, 234567890124, {}, [], true, '', 'abc'];
  for (const b of bad) {
    assert.equal(v.verhoeffCheck(b), false);
    assert.equal(v.isAadhaar(b), false);
    assert.equal(v.luhnCheck(b), false);
    assert.equal(v.isPan(b), false);
    assert.equal(v.panHolderType(b), null);
    assert.equal(v.isIfsc(b), false);
    assert.equal(v.gstinCheck(b), false);
    assert.equal(v.isGstin(b), false);
    assert.equal(v.isIndianMobile(b), false);
    assert.equal(v.isCardNumber(b), false);
    if (typeof b !== 'string' || b === 'abc') {
      assert.equal(v.verhoeffDigit(b), null);
      assert.equal(v.luhnDigit(b), null);
    }
    assert.equal(v.gstinCheckChar(b), null);
  }
  assert.equal(v.digitsOnly(5), null);
  assert.equal(v.gstinCheckChar('27ABCPE1234F1'), null);
  assert.equal(v.gstinCheckChar('27abcpe1234f1z'), null);
});
