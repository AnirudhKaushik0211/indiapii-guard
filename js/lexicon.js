/* IndiaPII Guard lexicon: entity metadata, context phrase lists, UPI handles, test cards and the
 * phrase compiler with containment suppression (SPEC 3.1, 3.6, 3.7, 7.5, 8.2). Data plus pure helpers. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = {};
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.IndiaPIIGuard = root.IndiaPIIGuard || {}; root.IndiaPIIGuard.lexicon = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  // Fixed priority order (SPEC 3.1); used for tie-breaks.
  var ENTITIES = ['GSTIN', 'CARD', 'AADHAAR', 'EMAIL', 'UPI', 'PAN', 'IFSC', 'PHONE', 'BANK_ACCOUNT'];

  var LABELS = {
    GSTIN: 'GSTIN', CARD: 'Card number', AADHAAR: 'Aadhaar number', EMAIL: 'E-mail address', UPI: 'UPI ID',
    PAN: 'PAN', IFSC: 'IFSC', PHONE: 'Mobile number', BANK_ACCOUNT: 'Bank account number'
  };

  var PLURAL_LABELS = {
    GSTIN: 'GSTIN', CARD: 'Card numbers', AADHAAR: 'Aadhaar numbers', EMAIL: 'E-mail addresses', UPI: 'UPI IDs',
    PAN: 'PAN', IFSC: 'IFSC', PHONE: 'Mobile numbers', BANK_ACCOUNT: 'Bank account numbers'
  };

  var KINDS = {
    GSTIN: 'code', CARD: 'numeric', AADHAAR: 'numeric', EMAIL: 'address', UPI: 'address',
    PAN: 'code', IFSC: 'code', PHONE: 'numeric', BANK_ACCOUNT: 'numeric'
  };

  var PRIORITY = {};
  for (var pi = 0; pi < ENTITIES.length; pi++) PRIORITY[ENTITIES[pi]] = pi + 1;

  // Devanagari phrases with a nukta appear in precomposed and decomposed form (SPEC 3.6).
  var PHONE_HI_PRECOMPOSED = '\u095E\u094B\u0928';
  var PHONE_HI_DECOMPOSED = '\u092B\u093C\u094B\u0928';

  var CONTEXT = {
    AADHAAR: ['aadhaar', 'aadhar', 'adhar', 'adhaar', 'aadhaar no', 'aadhar no', 'aadhaar number', 'aadhar number',
      'aadhaar card', 'aadhar card', 'aadhaar sankhya', 'uid', 'uid no', 'uidai',
      '\u0906\u0927\u093E\u0930', '\u0906\u0927\u093E\u0930 \u0928\u0902\u092C\u0930',
      '\u0906\u0927\u093E\u0930 \u0938\u0902\u0916\u094D\u092F\u093E'],
    PHONE: ['mobile', 'mobile no', 'mobile number', 'mob', 'mob no', 'phone', 'phone no', 'phone number', 'ph', 'ph no',
      'contact', 'contact no', 'contact number', 'cell', 'cell no', 'whatsapp', 'whatsapp no', 'call', 'call karo',
      'call karna', 'call kar', 'number pe', 'fone', 'tel', 'telephone',
      '\u092E\u094B\u092C\u093E\u0907\u0932', PHONE_HI_PRECOMPOSED, PHONE_HI_DECOMPOSED, '\u092B\u094B\u0928'],
    CARD: ['card', 'card no', 'card number', 'credit card', 'debit card', 'cc', 'visa', 'mastercard', 'rupay', 'amex',
      'cvv', 'expiry'],
    BANK_ACCOUNT: ['account', 'account no', 'account number', 'a/c', 'a/c no', 'ac no', 'acc', 'acc no', 'acct',
      'acct no', 'bank account', 'savings account', 'current account', 'khata', 'khata no', 'khata number',
      'khata sankhya', '\u0916\u093E\u0924\u093E', '\u0916\u093E\u0924\u093E \u0938\u0902\u0916\u094D\u092F\u093E',
      '\u092C\u0948\u0902\u0915 \u0916\u093E\u0924\u093E'],
    PAN: ['pan', 'pan no', 'pan number', 'pan card', 'permanent account number', '\u092A\u0948\u0928',
      '\u092A\u0948\u0928 \u0915\u093E\u0930\u094D\u0921'],
    IFSC: ['ifsc', 'ifsc code', 'ifs code', 'branch code', 'neft', 'rtgs', 'imps'],
    GSTIN: ['gst', 'gstin', 'gst no', 'gst number', 'gstn'],
    // Last five (pay, paid, settlement, bhej, bhejo): v1.0 deviation from SPEC 3.6, see eval/HISTORY.md held-out run 2.
    UPI: ['upi', 'upi id', 'upi address', 'vpa', 'gpay', 'google pay', 'phonepe', 'paytm', 'bhim', 'upi pe', 'upi se',
      'pay', 'paid', 'settlement', 'bhej', 'bhejo'],
    EMAIL: []
  };

  // Last two (complaint, Devanagari "order"): v1.0 deviation from SPEC 3.6, see eval/HISTORY.md held-out run 2.
  var NEG_NUMERIC = ['order', 'order id', 'order no', 'order number', 'invoice', 'inv', 'bill', 'bill no', 'receipt',
    'txn', 'txn id', 'transaction', 'transaction id', 'utr', 'ref', 'ref no', 'reference', 'ticket no', 'ticket id',
    'ticket number', 'case id', 'case no', 'case number', 'tracking', 'tracking id', 'awb', 'consignment', 'pnr', 'otp',
    'pin code', 'pincode', 'serial', 'sr no', 's/n', 'sku', 'batch no', 'qty', 'quantity', 'amount', 'amt', 'rs', 'inr',
    '\u20B9', 'price', 'total', 'mrp', 'paise', 'complaint', '\u0911\u0930\u094D\u0921\u0930'];

  var NEG_CODE = ['sku', 'model', 'model no', 'part no', 'part number', 'product code', 'item code', 'coupon', 'voucher',
    'promo', 'promo code', 'serial', 'batch no'];

  var UPI_HANDLES = ['ybl', 'ibl', 'axl', 'okaxis', 'okhdfcbank', 'okicici', 'oksbi', 'paytm', 'ptyes', 'ptaxis', 'pthdfc',
    'ptsbi', 'upi', 'apl', 'yapl', 'axisbank', 'icici', 'hdfcbank', 'sbi', 'kotak', 'freecharge', 'airtel', 'jio',
    'idfcbank', 'indus', 'federal', 'pnb', 'barodampay', 'aubank', 'yesbank', 'waaxis', 'wahdfcbank', 'wasbi', 'waicici'];

  // Public payment-gateway test numbers (SPEC 8.2); not issued to anyone, all pass Luhn.
  var TEST_CARDS = ['4111111111111111', '4012888888881881', '4222222222222', '4242424242424242', '4000056655665556',
    '5555555555554444', '5105105105105100', '5200828282828210', '2223003122003222', '378282246310005',
    '371449635398431', '6011111111111117', '6011000990139424', '30569309025904', '38520000023237',
    '3530111333300000', '3566002020360505'];

  // Context boost per entity (SPEC 3.7). PAN and IFSC depend on case, UPI on the handle.
  var BOOST = {
    AADHAAR: 0.15, PHONE: 0.20, CARD: 0.10, BANK_ACCOUNT: 0.50,
    PAN: { upper: 0.10, mixed: 0.30 }, IFSC: { upper: 0.15, mixed: 0.35 }, GSTIN: 0.04,
    UPI: { known: 0.05, unknown: 0.40 }, EMAIL: 0
  };

  var JOINER = '[\\s.:_\\-/]{1,3}';
  var WORDY_RE = /[\p{L}\p{N}]/u;

  // Escapes the regex syntax characters (valid identity escapes under the u flag).
  function escapeToken(token) { return token.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&'); }

  // One phrase -> regex fragment: tokens split on spaces, escaped, joined by the joiner class.
  function compilePhrase(phrase) {
    var tokens = phrase.split(' ').filter(function (t) { return t.length > 0; });
    return tokens.map(escapeToken).join(JOINER);
  }

  function isWordPhrase(phrase) { return WORDY_RE.test(phrase); }

  function byLengthDesc(list) {
    var indexed = list.map(function (p, i) { return { p: p, i: i }; });
    indexed.sort(function (a, b) { return (b.p.length - a.p.length) || (a.i - b.i); });
    return indexed.map(function (x) { return x.p; });
  }

  // Compiles a phrase list into { re, phrases } where capture group k + 1 matches phrases[k].
  // Returns null for an empty list.
  function compileLexicon(list) {
    if (!list || list.length === 0) return null;
    var words = byLengthDesc(list.filter(isWordPhrase));
    var symbols = byLengthDesc(list.filter(function (p) { return !isWordPhrase(p); }));
    var phrases = words.concat(symbols);
    var wordPart = words.map(function (p) { return '(' + compilePhrase(p) + ')'; }).join('|');
    var symbolPart = symbols.map(function (p) { return '(' + compilePhrase(p) + ')'; }).join('|');
    var alts = [];
    if (words.length) alts.push('(?<![\\p{L}\\p{M}\\p{N}])(?:' + wordPart + ')(?![\\p{L}\\p{M}\\p{N}])');
    if (symbols.length) alts.push('(?:' + symbolPart + ')');
    return { re: new RegExp('(?:' + alts.join('|') + ')', 'giu'), phrases: phrases };
  }

  // All non-overlapping matches of one compiled lexicon: [{ phrase, start, end }] sorted by start.
  function findMatches(compiled, text) {
    var out = [];
    if (!compiled) return out;
    var re = compiled.re;
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      var phrase = null;
      for (var g = 1; g < m.length; g++) {
        if (m[g] !== undefined) { phrase = compiled.phrases[g - 1]; break; }
      }
      out.push({ phrase: phrase, start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
    re.lastIndex = 0;
    return out;
  }

  // Drops every match whose span lies entirely inside a strictly longer match. Input in any order;
  // output sorted by start (then end descending). Matches with identical spans are all kept.
  function suppressContained(matches) {
    var sorted = matches.slice().sort(function (a, b) { return (a.start - b.start) || (b.end - a.end); });
    var out = [];
    var maxEnd = -1;
    var maxEndStart = -1;
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      var contained = maxEnd > m.end || (maxEnd === m.end && maxEndStart < m.start);
      if (!contained) out.push(m);
      if (m.end > maxEnd) { maxEnd = m.end; maxEndStart = m.start; }
    }
    return out;
  }

  var COMPILED = { CONTEXT: {}, NEG_NUMERIC: compileLexicon(NEG_NUMERIC), NEG_CODE: compileLexicon(NEG_CODE) };
  for (var ci = 0; ci < ENTITIES.length; ci++) COMPILED.CONTEXT[ENTITIES[ci]] = compileLexicon(CONTEXT[ENTITIES[ci]]);

  // Positive context matches of every entity over the text, with cross-lexicon containment suppression.
  function contextMatches(text) {
    var all = [];
    for (var i = 0; i < ENTITIES.length; i++) {
      var ms = findMatches(COMPILED.CONTEXT[ENTITIES[i]], text);
      for (var j = 0; j < ms.length; j++) { ms[j].entity = ENTITIES[i]; all.push(ms[j]); }
    }
    return suppressContained(all);
  }

  // Matches of one negative lexicon ('NEG_NUMERIC' or 'NEG_CODE'), with containment suppression.
  function negativeMatches(name, text) {
    return suppressContained(findMatches(COMPILED[name], text));
  }

  return {
    ENTITIES: ENTITIES,
    LABELS: LABELS,
    PLURAL_LABELS: PLURAL_LABELS,
    KINDS: KINDS,
    PRIORITY: PRIORITY,
    CONTEXT: CONTEXT,
    NEG_NUMERIC: NEG_NUMERIC,
    NEG_CODE: NEG_CODE,
    UPI_HANDLES: UPI_HANDLES,
    TEST_CARDS: TEST_CARDS,
    BOOST: BOOST,
    compilePhrase: compilePhrase,
    compileLexicon: compileLexicon,
    findMatches: findMatches,
    suppressContained: suppressContained,
    contextMatches: contextMatches,
    negativeMatches: negativeMatches
  };
});
