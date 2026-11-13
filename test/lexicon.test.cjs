'use strict';
// SPEC 3.1, 3.6, 7.5, 8.2: lexicon data and the phrase compiler.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const lx = require(path.join(__dirname, '..', 'js', 'lexicon.js'));
const v = require(path.join(__dirname, '..', 'js', 'validators.js'));

function phrasesIn(name, text) {
  const re = lx.compileLexicon(name === 'NEG_NUMERIC' || name === 'NEG_CODE' ? lx[name] : lx.CONTEXT[name]);
  return lx.findMatches(re, text).map((m) => m.phrase);
}

test('ENTITIES order, labels, kinds and plural labels', () => {
  assert.deepEqual(lx.ENTITIES, ['GSTIN', 'CARD', 'AADHAAR', 'EMAIL', 'UPI', 'PAN', 'IFSC', 'PHONE', 'BANK_ACCOUNT']);
  assert.equal(lx.LABELS.PHONE, 'Mobile number');
  assert.equal(lx.LABELS.EMAIL, 'E-mail address');
  assert.equal(lx.KINDS.CARD, 'numeric');
  assert.equal(lx.KINDS.UPI, 'address');
  assert.equal(lx.KINDS.GSTIN, 'code');
  assert.deepEqual(lx.PLURAL_LABELS, {
    GSTIN: 'GSTIN', CARD: 'Card numbers', AADHAAR: 'Aadhaar numbers', EMAIL: 'E-mail addresses', UPI: 'UPI IDs',
    PAN: 'PAN', IFSC: 'IFSC', PHONE: 'Mobile numbers', BANK_ACCOUNT: 'Bank account numbers'
  });
  assert.equal(lx.PRIORITY.GSTIN, 1);
  assert.equal(lx.PRIORITY.BANK_ACCOUNT, 9);
});

test('phrase compilation: joiners', () => {
  for (const t of ['aadhaar no 1', 'aadhaar-no 1', 'aadhaar.no 1', 'Aadhaar No.: 1', 'AADHAAR_NO 1']) {
    assert.deepEqual(phrasesIn('AADHAAR', t), ['aadhaar no'], t);
  }
  assert.deepEqual(phrasesIn('AADHAAR', 'aadhaarno 1'), []);
  assert.equal(lx.compilePhrase('a/c no'), 'a\\/c[\\s.:_\\-/]{1,3}no');
});

test('word boundaries', () => {
  assert.deepEqual(phrasesIn('NEG_NUMERIC', 'users'), []);
  assert.deepEqual(phrasesIn('NEG_NUMERIC', 'Rs 5'), ['rs']);
  assert.deepEqual(phrasesIn('PAN', 'Japan'), []);
  assert.deepEqual(phrasesIn('PAN', 'PAN: x'), ['pan']);
  assert.deepEqual(phrasesIn('PHONE', 'mobile'), ['mobile']);
});

test('symbol phrase matches glued to an amount', () => {
  assert.deepEqual(phrasesIn('NEG_NUMERIC', 'cost \u20B9500'), ['\u20B9']);
});

test('longest phrase first', () => {
  assert.deepEqual(phrasesIn('PHONE', 'mobile number 1'), ['mobile number']);
  assert.deepEqual(phrasesIn('GSTIN', 'GSTIN 1'), ['gstin']);
});

test('Devanagari phrases match, nukta in both forms', () => {
  assert.deepEqual(phrasesIn('AADHAAR', '\u0906\u0927\u093E\u0930 \u0928\u0902\u092C\u0930: 1'),
    ['\u0906\u0927\u093E\u0930 \u0928\u0902\u092C\u0930']);
  assert.deepEqual(phrasesIn('PHONE', '\u095E\u094B\u0928 1'), ['\u095E\u094B\u0928']);
  assert.deepEqual(phrasesIn('PHONE', '\u092B\u093C\u094B\u0928 1'), ['\u092B\u093C\u094B\u0928']);
  assert.deepEqual(phrasesIn('PHONE', '\u092B\u094B\u0928 1'), ['\u092B\u094B\u0928']);
  assert.deepEqual(phrasesIn('BANK_ACCOUNT', '\u092C\u0948\u0902\u0915 \u0916\u093E\u0924\u093E 1'),
    ['\u092C\u0948\u0902\u0915 \u0916\u093E\u0924\u093E']);
  // A vowel sign (combining mark) after the phrase is not a word boundary.
  assert.deepEqual(phrasesIn('BANK_ACCOUNT', '\u0916\u093E\u0924\u093E\u0947'), []);
});

test('containment suppression across positive lexicons', () => {
  const ms = lx.contextMatches('permanent account number ABCPE1234F');
  assert.equal(ms.length, 1);
  assert.equal(ms[0].entity, 'PAN');
  assert.equal(ms[0].phrase, 'permanent account number');
  const card = lx.contextMatches('aadhaar card 1');
  assert.deepEqual(card.map((m) => m.entity + ':' + m.phrase), ['AADHAAR:aadhaar card']);
});

test('suppressContained keeps identical spans and partial overlaps', () => {
  const out = lx.suppressContained([
    { start: 0, end: 10 }, { start: 2, end: 5 }, { start: 0, end: 10, x: 1 }, { start: 8, end: 14 }, { start: 10, end: 14 }
  ]);
  assert.deepEqual(out.map((m) => m.start + '-' + m.end), ['0-10', '0-10', '8-14']);
});

test('negative lexicons', () => {
  assert.deepEqual(lx.negativeMatches('NEG_NUMERIC', 'order id 5').map((m) => m.phrase), ['order id']);
  assert.deepEqual(lx.negativeMatches('NEG_CODE', 'SKU X').map((m) => m.phrase), ['sku']);
});

test('every TEST_CARDS entry passes Luhn', () => {
  assert.equal(lx.TEST_CARDS.length, 17);
  for (const c of lx.TEST_CARDS) assert.equal(v.luhnCheck(c), true, c);
});

test('no duplicate phrases or handles', () => {
  const lists = Object.keys(lx.CONTEXT).map((k) => lx.CONTEXT[k]).concat([lx.NEG_NUMERIC, lx.NEG_CODE, lx.UPI_HANDLES]);
  for (const list of lists) assert.equal(new Set(list).size, list.length);
  for (const list of lists) for (const p of list) assert.equal(p, p.toLowerCase());
  assert.equal(lx.UPI_HANDLES.length, 34);
});

test('BOOST values', () => {
  assert.deepEqual(lx.BOOST, {
    AADHAAR: 0.15, PHONE: 0.20, CARD: 0.10, BANK_ACCOUNT: 0.50,
    PAN: { upper: 0.10, mixed: 0.30 }, IFSC: { upper: 0.15, mixed: 0.35 }, GSTIN: 0.04,
    UPI: { known: 0.05, unknown: 0.40 }, EMAIL: 0
  });
});
