/* IndiaPII Guard validators: Verhoeff, Luhn, PAN, IFSC, GSTIN and helpers (SPEC 4).
 * Pure functions; they never throw and return false or null for invalid input. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = {};
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.IndiaPIIGuard = root.IndiaPIIGuard || {}; root.IndiaPIIGuard.validators = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  // Verhoeff tables (dihedral group D5), as published (SPEC 4.1).
  var VD = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
  var VP = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
  var VINV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

  var DIGITS_RE = /^[0-9]+$/;

  function isDigits(s) { return typeof s === 'string' && s.length > 0 && DIGITS_RE.test(s); }

  function verhoeffCheck(digits) {
    if (!isDigits(digits)) return false;
    var c = 0;
    for (var i = 0; i < digits.length; i++) {
      var digit = digits.charCodeAt(digits.length - 1 - i) - 48;
      c = VD[c][VP[i % 8][digit]];
    }
    return c === 0;
  }

  function verhoeffDigit(digits) {
    if (!isDigits(digits)) return null;
    var c = 0;
    for (var i = 0; i < digits.length; i++) {
      var digit = digits.charCodeAt(digits.length - 1 - i) - 48;
      c = VD[c][VP[(i + 1) % 8][digit]];
    }
    return VINV[c];
  }

  function isAadhaar(digits) {
    return typeof digits === 'string' && /^[2-9][0-9]{11}$/.test(digits) && verhoeffCheck(digits);
  }

  function luhnSum(digits, doubleFirst) {
    var sum = 0;
    for (var i = 0; i < digits.length; i++) {
      var d = digits.charCodeAt(digits.length - 1 - i) - 48;
      if ((i % 2 === 1) !== doubleFirst) {
        d = d * 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return sum;
  }

  function luhnCheck(digits) {
    if (!isDigits(digits) || digits.length < 2) return false;
    return luhnSum(digits, false) % 10 === 0;
  }

  function luhnDigit(digits) {
    if (!isDigits(digits)) return null;
    // With a check digit appended, the rightmost existing digit is doubled.
    var sum = luhnSum(digits, true);
    return (10 - (sum % 10)) % 10;
  }

  var PAN_RE = /^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/;
  var PAN_HOLDERS = {
    A: 'association of persons', B: 'body of individuals', C: 'company', F: 'firm', G: 'government',
    H: 'Hindu undivided family', J: 'artificial juridical person', L: 'local authority', P: 'individual', T: 'trust'
  };

  function isPan(text) {
    return typeof text === 'string' && text.length === 10 && PAN_RE.test(text.toUpperCase());
  }

  function panHolderType(text) {
    if (!isPan(text)) return null;
    return PAN_HOLDERS[text.charAt(3).toUpperCase()];
  }

  function isIfsc(text) {
    return typeof text === 'string' && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(text.toUpperCase());
  }

  var GST_STATE_CODES = (function () {
    var out = [];
    for (var i = 1; i <= 38; i++) out.push(i < 10 ? '0' + i : String(i));
    out.push('97', '99');
    return out;
  })();

  var GST_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var GSTIN_RE = /^[0-9]{2}[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$/;

  function gstinCheckChar(first14) {
    if (typeof first14 !== 'string' || first14.length !== 14) return null;
    var sum = 0;
    for (var i = 0; i < 14; i++) {
      var v = GST_ALPHABET.indexOf(first14.charAt(i));
      if (v < 0) return null;
      var product = v * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(product / 36) + (product % 36);
    }
    return GST_ALPHABET.charAt((36 - (sum % 36)) % 36);
  }

  function gstinCheck(text) {
    if (typeof text !== 'string' || text.length !== 15 || text !== text.toUpperCase()) return false;
    var c = gstinCheckChar(text.slice(0, 14));
    return c !== null && c === text.charAt(14);
  }

  function isGstin(text) {
    return typeof text === 'string' && GSTIN_RE.test(text) &&
      GST_STATE_CODES.indexOf(text.slice(0, 2)) >= 0 && gstinCheck(text);
  }

  function isIndianMobile(digits10) {
    return typeof digits10 === 'string' && /^[6-9][0-9]{9}$/.test(digits10);
  }

  function isCardNumber(digits) {
    return typeof digits === 'string' && /^[2-6][0-9]{12,18}$/.test(digits) && luhnCheck(digits);
  }

  function digitsOnly(text) {
    if (typeof text !== 'string') return null;
    return text.replace(/[^0-9]/g, '');
  }

  return {
    verhoeffCheck: verhoeffCheck,
    verhoeffDigit: verhoeffDigit,
    isAadhaar: isAadhaar,
    luhnCheck: luhnCheck,
    luhnDigit: luhnDigit,
    isPan: isPan,
    panHolderType: panHolderType,
    isIfsc: isIfsc,
    GST_STATE_CODES: GST_STATE_CODES,
    gstinCheckChar: gstinCheckChar,
    gstinCheck: gstinCheck,
    isGstin: isGstin,
    isIndianMobile: isIndianMobile,
    isCardNumber: isCardNumber,
    digitsOnly: digitsOnly
  };
});
