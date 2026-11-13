/* IndiaPII Guard detector: OCR shadow string, digit chains, candidates, context, confidence and
 * resolution (SPEC 3.2-3.9). Pure; assumes options were validated by guard.js. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode
    ? { validators: require('./validators.js'), lexicon: require('./lexicon.js') }
    : { validators: root.IndiaPIIGuard.validators, lexicon: root.IndiaPIIGuard.lexicon };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.IndiaPIIGuard = root.IndiaPIIGuard || {}; root.IndiaPIIGuard.detector = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var V = deps.validators;
  var L = deps.lexicon;

  var THRESHOLDS = { lenient: 0.35, balanced: 0.5, strict: 0.7 };
  var DEFAULT_THRESHOLD = 0.5;
  var RUPEE = '\u20B9';
  var POS_BEFORE = 48, POS_AFTER = 24, NEG_BEFORE = 24, NEG_AFTER = 12;
  var NUMERIC = { AADHAAR: true, PHONE: true, CARD: true, BANK_ACCOUNT: true };
  var NEG_LEXICON = { AADHAAR: 'NEG_NUMERIC', PHONE: 'NEG_NUMERIC', CARD: 'NEG_NUMERIC', BANK_ACCOUNT: 'NEG_NUMERIC',
    PAN: 'NEG_CODE', IFSC: 'NEG_CODE', GSTIN: 'NEG_CODE' };

  var LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
  var LETTER = /\p{L}/u;
  var HANDLES = {};
  for (var hi = 0; hi < L.UPI_HANDLES.length; hi++) HANDLES[L.UPI_HANDLES[hi]] = true;

  function round2(x) { return Math.round(x * 100) / 100; }

  function isAsciiDigit(c) { return c >= '0' && c <= '9'; }
  function isSpaceLike(c) { return c === ' ' || c === '\u00A0'; }
  function isHyphen(c) { return c === '-' || c === '\u2010' || c === '\u2011' || c === '\u2013'; }
  function isLookalikeChar(c) { return c === 'O' || c === 'o' || c === 'I' || c === 'l'; }
  function isOcrGroupChar(c) { return isAsciiDigit(c) || isLookalikeChar(c); }

  // The character at index i as a full code point (so astral letters are classified correctly).
  function charAt(str, i) {
    if (i < 0 || i >= str.length) return '';
    var c = str.charCodeAt(i);
    if (c >= 0xDC00 && c <= 0xDFFF && i > 0) {
      var h = str.charCodeAt(i - 1);
      if (h >= 0xD800 && h <= 0xDBFF) return str.slice(i - 1, i + 1);
    }
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      var lo = str.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) return str.slice(i, i + 2);
    }
    return str.charAt(i);
  }
  function isLetterOrDigit(ch) { return ch !== '' && LETTER_OR_DIGIT.test(ch); }
  function isLetter(ch) { return ch !== '' && LETTER.test(ch); }

  // Length of a separator (SPEC 3.3) starting at i and followed by a group character, or 0.
  function separatorLength(str, i, isGroupChar) {
    var c = str.charAt(i);
    if (isSpaceLike(c)) {
      if (isGroupChar(str.charAt(i + 1))) return 1;
      if (isSpaceLike(str.charAt(i + 1)) && isGroupChar(str.charAt(i + 2))) return 2;
    }
    var k = i;
    if (str.charAt(k) === ' ') k++;
    if (!isHyphen(str.charAt(k))) return 0;
    k++;
    if (isGroupChar(str.charAt(k))) return k - i;
    if (str.charAt(k) === ' ' && isGroupChar(str.charAt(k + 1))) return k + 1 - i;
    return 0;
  }

  // Single left-to-right pass: maximal chains of groups joined by separators. Each chain is a list of
  // groups { start, end } (end exclusive). Linear in the length of str.
  function scanChains(str, isGroupChar) {
    var chains = [];
    var n = str.length;
    var i = 0;
    while (i < n) {
      if (!isGroupChar(str.charAt(i))) { i++; continue; }
      var groups = [];
      for (;;) {
        var gs = i;
        while (i < n && isGroupChar(str.charAt(i))) i++;
        groups.push({ start: gs, end: i });
        var sep = separatorLength(str, i, isGroupChar);
        if (sep === 0) break;
        i += sep;
      }
      chains.push(groups);
    }
    return chains;
  }

  // OCR shadow string S (SPEC 3.4): same length as T, lookalikes replaced in surviving groups.
  function buildShadow(T) {
    var chains = scanChains(T, isOcrGroupChar);
    var out = null;
    for (var c = 0; c < chains.length; c++) {
      var groups = chains[c];
      var keep = [];
      for (var g = 0; g < groups.length; g++) {
        var gr = groups[g];
        var digits = 0, looks = 0;
        for (var k = gr.start; k < gr.end; k++) {
          if (isAsciiDigit(T.charAt(k))) digits++; else looks++;
        }
        keep.push(digits > 0 && looks * 2 <= gr.end - gr.start ? digits : -1);
      }
      // Sub-chains of consecutive surviving groups.
      var g0 = 0;
      while (g0 < groups.length) {
        if (keep[g0] < 0) { g0++; continue; }
        var g1 = g0, total = 0;
        while (g1 < groups.length && keep[g1] >= 0) { total += keep[g1]; g1++; }
        var s = groups[g0].start, e = groups[g1 - 1].end;
        if (total >= 6 && !isLetter(charAt(T, s - 1)) && !isLetter(charAt(T, e))) {
          for (var x = g0; x < g1; x++) {
            for (var y = groups[x].start; y < groups[x].end; y++) {
              var ch = T.charAt(y);
              if (isLookalikeChar(ch)) {
                if (out === null) out = T.split('');
                out[y] = (ch === 'O' || ch === 'o') ? '0' : '1';
              }
            }
          }
        }
        g0 = g1;
      }
    }
    return out === null ? T : out.join('');
  }

  // Boundary rules on the edges of a maximal chain (SPEC 3.3), with characters from T.
  function chainDiscarded(T, start, end) {
    var p1 = charAt(T, start - 1);
    var p2 = p1 === '' ? '' : charAt(T, start - 1 - p1.length);
    var n1 = charAt(T, end);
    var n2 = n1 === '' ? '' : charAt(T, end + n1.length);
    if (isLetterOrDigit(p1) || p1 === '_' || p1 === '@') return true;
    if ((p1 === '.' || p1 === ',' || p1 === ':') && isAsciiDigit(p2)) return true;
    if ((p1 === '-' || p1 === '/' || p1 === '#') && isLetterOrDigit(p2)) return true;
    if (p1 === RUPEE || (isSpaceLike(p1) && p2 === RUPEE)) return true;
    if (isLetterOrDigit(n1) || n1 === '_' || n1 === '@') return true;
    if ((n1 === '.' || n1 === ',' || n1 === ':') && isAsciiDigit(n2)) return true;
    return false;
  }

  // Digit chains on S after splitting and boundary rules: [{ start, end, groups: [digit strings] }].
  function digitChains(T, S) {
    var raw = scanChains(S, isAsciiDigit);
    var out = [];
    for (var c = 0; c < raw.length; c++) {
      var groups = raw[c];
      if (chainDiscarded(T, groups[0].start, groups[groups.length - 1].end)) continue;
      var from = 0;
      for (var g = 0; g < groups.length; g++) {
        var last = g === groups.length - 1;
        var split = !last && groups[g].end - groups[g].start >= 8 && groups[g + 1].end - groups[g + 1].start >= 8;
        if (last || split) {
          var part = groups.slice(from, g + 1);
          out.push({
            start: part[0].start,
            end: part[part.length - 1].end,
            groups: part.map(function (p) { return S.slice(p.start, p.end); })
          });
          from = g + 1;
        }
      }
    }
    return out;
  }

  function groupingCode(lengths) { return lengths.join('-'); }

  function aadhaarCandidate(chain, digits, lengths) {
    var code = groupingCode(lengths);
    if (code !== '12' && code !== '4-4-4') return null;
    if (!V.isAadhaar(digits)) return null;
    return { entity: 'AADHAAR', start: chain.start, end: chain.end, base: 0.80, value: digits,
      reasons: ['checksum:verhoeff', 'grouping:' + code] };
  }

  var CANONICAL_PHONE = { '10': true, '5-5': true, '3-3-4': true, '4-3-3': true, '2-4-4': true };

  function phoneCandidate(T, chain, digits, lengths) {
    var groups = chain.groups;
    var total = digits.length;
    var plusDirect = T.charAt(chain.start - 1) === '+';
    var prefix = null;
    var rem = lengths.slice();
    var remDigits = digits;
    if (groups.length >= 2 && (groups[0] === '0' || groups[0] === '91' || groups[0] === '0091')) {
      prefix = groups[0];
      rem = lengths.slice(1);
      remDigits = digits.slice(groups[0].length);
    } else if (total === 11 && digits.charAt(0) === '0') {
      if (lengths[0] - 1 >= 2) { prefix = '0'; rem[0] -= 1; remDigits = digits.slice(1); }
    } else if (total === 12 && digits.slice(0, 2) === '91') {
      var ok = plusDirect
        ? lengths[0] - 2 >= 2
        : (lengths.length <= 2 && lengths[0] - 2 >= 4 && !(lengths.length === 1 && V.isAadhaar(digits)));
      if (ok) { prefix = '91'; rem[0] -= 2; remDigits = digits.slice(2); }
    } else if (total === 14 && digits.slice(0, 4) === '0091') {
      if (lengths.length <= 2 && lengths[0] - 4 >= 4) { prefix = '0091'; rem[0] -= 4; remDigits = digits.slice(4); }
    }
    if (remDigits.length !== 10 || !V.isIndianMobile(remDigits)) return null;
    if (rem.length > 5) return null;
    for (var i = 0; i < rem.length; i++) if (rem[i] < 2) return null;
    var start = chain.start;
    var before = T.slice(Math.max(0, start - 2), start);
    var plus = /\+[ ]?$/.exec(before);
    if (prefix === '91') {
      if (plus) start -= plus[0].length;
    } else if (plus) {
      return null;
    }
    if (prefix === null) {
      var win = T.slice(Math.max(0, start - 12), start);
      var paren = /\(\s?\+?\s?91\s?\)[ \u00A0]{0,2}$/.exec(win);
      if (paren) { start = start - win.length + paren.index; prefix = '(+91)'; }
    }
    var code = groupingCode(rem);
    var canonical = CANONICAL_PHONE[code] === true;
    var base = canonical ? (prefix !== null ? 0.85 : 0.70) : (prefix !== null ? 0.70 : 0.45);
    var reasons = [];
    if (prefix !== null) reasons.push('prefix:' + prefix);
    reasons.push(canonical ? 'grouping:' + code : 'grouping:non-canonical');
    return { entity: 'PHONE', start: start, end: chain.end, base: base, value: remDigits, reasons: reasons };
  }

  function cardGroupingOk(lengths) {
    var n = lengths.length;
    if (n === 1) return true;
    var code = groupingCode(lengths);
    if (code === '4-6-5' || code === '4-6-4') return true;
    if (n < 3) return false;
    for (var i = 0; i < n - 1; i++) if (lengths[i] !== 4) return false;
    return lengths[n - 1] >= 1 && lengths[n - 1] <= 4;
  }

  function cardCandidate(chain, digits, lengths) {
    if (digits.length < 13 || digits.length > 19) return null;
    var f = digits.charAt(0);
    if (f < '2' || f > '6') return null;
    if (!cardGroupingOk(lengths)) return null;
    if (!V.luhnCheck(digits)) return null;
    return { entity: 'CARD', start: chain.start, end: chain.end, base: 0.85, value: digits,
      reasons: ['checksum:luhn', 'grouping:' + groupingCode(lengths)] };
  }

  function bankCandidate(chain, digits, lengths) {
    if (digits.length < 9 || digits.length > 18) return null;
    if (lengths.length > 1) {
      for (var i = 0; i < lengths.length; i++) if (lengths[i] < 3 || lengths[i] > 6) return null;
    }
    return { entity: 'BANK_ACCOUNT', start: chain.start, end: chain.end, base: 0.30, value: digits,
      reasons: ['grouping:' + groupingCode(lengths)] };
  }

  function ocrCount(T, S, start, end) {
    if (S === T) return 0;
    var n = 0;
    for (var i = start; i < end; i++) if (S.charCodeAt(i) !== T.charCodeAt(i)) n++;
    return n;
  }

  function numericCandidates(T, S) {
    var out = [];
    var chains = digitChains(T, S);
    for (var c = 0; c < chains.length; c++) {
      var chain = chains[c];
      var digits = chain.groups.join('');
      var lengths = chain.groups.map(function (g) { return g.length; });
      var list = [aadhaarCandidate(chain, digits, lengths), phoneCandidate(T, chain, digits, lengths),
        cardCandidate(chain, digits, lengths), bankCandidate(chain, digits, lengths)];
      for (var k = 0; k < list.length; k++) {
        var cand = list[k];
        if (!cand) continue;
        var oc = ocrCount(T, S, cand.start, cand.end);
        if (oc > 2) continue;
        cand.ocr = oc;
        out.push(cand);
      }
    }
    return out;
  }

  function caseOf(s) { return s === s.toUpperCase() ? 'upper' : 'mixed'; }

  var PAN_RE = /(?<![\p{L}\p{N}])[A-Za-z]{3}[ABCFGHLJPTabcfghljpt][A-Za-z][0-9]{4}[A-Za-z](?![\p{L}\p{N}])/gu;
  var IFSC_RE = /(?<![\p{L}\p{N}])[A-Za-z]{4}0[A-Za-z0-9]{6}(?![\p{L}\p{N}])/gu;
  var GSTIN_RE = /(?<![\p{L}\p{N}])[0-9]{2}[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z](?![\p{L}\p{N}])/gu;
  var ADDRESS_RE = /(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?){0,8}(?![A-Za-z0-9\-]|\.[A-Za-z0-9])/gu;

  function eachMatch(re, T, fn) {
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(T)) !== null) {
      fn(m[0], m.index);
      if (m[0].length === 0) re.lastIndex++;
    }
    re.lastIndex = 0;
  }

  function codeAndAddressCandidates(T) {
    var out = [];
    eachMatch(PAN_RE, T, function (s, i) {
      var cs = caseOf(s);
      out.push({ entity: 'PAN', start: i, end: i + s.length, base: cs === 'upper' ? 0.85 : 0.40,
        value: s.toUpperCase(), variant: cs, ocr: 0,
        reasons: ['structure:pan', 'holder:' + s.charAt(3).toUpperCase(), 'case:' + cs] });
    });
    eachMatch(IFSC_RE, T, function (s, i) {
      var cs = caseOf(s);
      out.push({ entity: 'IFSC', start: i, end: i + s.length, base: cs === 'upper' ? 0.80 : 0.35,
        value: s.toUpperCase(), variant: cs, ocr: 0, reasons: ['structure:ifsc', 'case:' + cs] });
    });
    eachMatch(GSTIN_RE, T, function (s, i) {
      var state = s.slice(0, 2);
      if (V.GST_STATE_CODES.indexOf(state) < 0 || !V.gstinCheck(s)) return;
      var z = s.charAt(13) === 'Z';
      var reasons = ['checksum:gstin', 'state:' + state];
      if (!z) reasons.push('gstin:14th-not-Z');
      out.push({ entity: 'GSTIN', start: i, end: i + s.length, base: z ? 0.95 : 0.85, value: s, ocr: 0,
        reasons: reasons });
    });
    eachMatch(ADDRESS_RE, T, function (s, i) {
      var at = s.indexOf('@');
      var local = s.slice(0, at);
      var domain = s.slice(at + 1);
      if (domain.indexOf('.') >= 0) {
        var lastLabel = domain.slice(domain.lastIndexOf('.') + 1);
        if (!/^[A-Za-z]{2,63}$/.test(lastLabel)) return;
        out.push({ entity: 'EMAIL', start: i, end: i + s.length, base: 0.95, value: s.toLowerCase(), ocr: 0,
          reasons: ['structure:email'] });
      } else {
        if (!/^[A-Za-z0-9._\-]{2,64}$/.test(local) || !/^[A-Za-z][A-Za-z0-9]{1,63}$/.test(domain)) return;
        var known = HANDLES[domain.toLowerCase()] === true;
        out.push({ entity: 'UPI', start: i, end: i + s.length, base: known ? 0.90 : 0.45, value: s.toLowerCase(),
          variant: known ? 'known' : 'unknown', ocr: 0, reasons: [known ? 'handle:known' : 'handle:unknown'] });
      }
    });
    return out;
  }

  // Sorted match list with a binary-searchable start index and the longest match length.
  function indexMatches(matches) {
    var maxLen = 0;
    for (var i = 0; i < matches.length; i++) {
      var len = matches[i].end - matches[i].start;
      if (len > maxLen) maxLen = len;
    }
    return { list: matches, maxLen: maxLen };
  }

  function lowerBound(list, start) {
    var lo = 0, hi = list.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (list[mid].start < start) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // Nearest counting match for [s, e): up to 'before' units before, up to 'after' units after; 'accept' filters.
  function nearest(T, idx, s, e, before, after, accept) {
    var list = idx.list;
    var best = null, bestDist = Infinity;
    for (var i = lowerBound(list, s - before - idx.maxLen); i < list.length; i++) {
      var m = list[i];
      if (m.start > e + after) break;
      var dist;
      if (m.end <= s && s - m.end <= before) dist = s - m.end;
      else if (m.start >= e && m.start - e <= after) dist = m.start - e;
      else continue;
      if (accept && !accept(m)) continue;
      if (dist < bestDist) { best = m; bestDist = dist; }
    }
    return best;
  }

  function noLineBreakBetween(T, m, s, e) {
    var gap = m.end <= s ? T.slice(m.end, s) : T.slice(e, m.start);
    return gap.indexOf('\n') < 0;
  }

  function boostFor(cand) {
    var b = L.BOOST[cand.entity];
    if (typeof b === 'number') return b;
    return b[cand.variant];
  }

  function score(T, cand, pos, neg) {
    var s = cand.start, e = cand.end, ent = cand.entity;
    var negative = null;
    var negativeBefore = false;
    if (NEG_LEXICON[ent]) {
      negative = nearest(T, neg[NEG_LEXICON[ent]], s, e, NEG_BEFORE, NEG_AFTER, null);
      negativeBefore = negative !== null &&
        nearest(T, neg[NEG_LEXICON[ent]], s, e, NEG_BEFORE, NEG_AFTER, function (m) { return m.end <= s; }) !== null;
    }
    // v1.0 deviation from SPEC 3.7 (eval/HISTORY.md, held-out run 2): when a negative phrase precedes the
    // candidate, an own-context phrase after it labels the next value, so only own phrases before it count.
    var own = nearest(T, pos, s, e, POS_BEFORE, POS_AFTER, function (m) {
      return m.entity === ent && (!negativeBefore || m.end <= s);
    });
    var competing = null;
    if (NUMERIC[ent] && !own) {
      competing = nearest(T, pos, s, e, POS_BEFORE, POS_AFTER, function (m) {
        return m.entity !== ent && NUMERIC[m.entity] === true && noLineBreakBetween(T, m, s, e);
      });
    }
    var raw = cand.base + (own ? boostFor(cand) : 0) - (negative ? 0.40 : 0) - (competing ? 0.15 : 0) -
      (cand.ocr > 0 ? 0.10 : 0);
    var reasons = cand.reasons.slice();
    if (own) reasons.push('context:' + own.phrase);
    if (negative) reasons.push('negative:' + negative.phrase);
    if (competing) reasons.push('competing:' + competing.entity);
    if (cand.ocr > 0) reasons.push('ocr:' + cand.ocr);
    cand.reasons = reasons;
    cand.confidence = round2(Math.min(0.99, Math.max(0, raw)));
  }

  function resolveThreshold(t) {
    if (typeof t === 'string') return THRESHOLDS[t];
    if (typeof t === 'number') return t;
    return DEFAULT_THRESHOLD;
  }

  function enabledSet(entities) {
    var out = {};
    var i;
    if (entities === undefined) {
      for (i = 0; i < L.ENTITIES.length; i++) out[L.ENTITIES[i]] = true;
    } else if (Array.isArray(entities)) {
      for (i = 0; i < L.ENTITIES.length; i++) out[L.ENTITIES[i]] = false;
      for (i = 0; i < entities.length; i++) out[entities[i]] = true;
    } else {
      for (i = 0; i < L.ENTITIES.length; i++) out[L.ENTITIES[i]] = entities[L.ENTITIES[i]] !== false;
    }
    return out;
  }

  // detect(text, options) -> { findings, stats } (SPEC 3.8). Options: threshold (number or preset),
  // entities (array or object), ocrNormalise (boolean). Options are assumed valid.
  function detect(text, options) {
    var opts = options || {};
    var T = text;
    var threshold = resolveThreshold(opts.threshold);
    var enabled = enabledSet(opts.entities);
    var S = opts.ocrNormalise === false ? T : buildShadow(T);

    var cands = numericCandidates(T, S).concat(codeAndAddressCandidates(T));
    var stats = { candidates: cands.length, belowThreshold: 0, overlapping: 0, disabled: 0 };
    if (cands.length === 0) return { findings: [], stats: stats };

    var pos = indexMatches(L.contextMatches(T));
    var neg = { NEG_NUMERIC: indexMatches(L.negativeMatches('NEG_NUMERIC', T)),
      NEG_CODE: indexMatches(L.negativeMatches('NEG_CODE', T)) };
    for (var i = 0; i < cands.length; i++) score(T, cands[i], pos, neg);

    var kept = [];
    for (i = 0; i < cands.length; i++) {
      if (cands[i].confidence < threshold) stats.belowThreshold++; else kept.push(cands[i]);
    }

    kept.sort(function (a, b) {
      return ((b.end - b.start) - (a.end - a.start)) || (b.confidence - a.confidence) ||
        (L.PRIORITY[a.entity] - L.PRIORITY[b.entity]) || (a.start - b.start);
    });
    var covered = new Uint8Array(T.length);
    var accepted = [];
    for (i = 0; i < kept.length; i++) {
      var c = kept[i];
      var clash = false;
      for (var k = c.start; k < c.end; k++) if (covered[k]) { clash = true; break; }
      if (clash) { stats.overlapping++; continue; }
      for (k = c.start; k < c.end; k++) covered[k] = 1;
      accepted.push(c);
    }

    var findings = [];
    for (i = 0; i < accepted.length; i++) {
      if (!enabled[accepted[i].entity]) stats.disabled++; else findings.push(accepted[i]);
    }
    findings.sort(function (a, b) { return a.start - b.start; });
    var out = findings.map(function (f, n) {
      return { id: 'f' + (n + 1), entity: f.entity, start: f.start, end: f.end, text: T.slice(f.start, f.end),
        value: f.value, confidence: f.confidence, reasons: f.reasons, normalised: f.ocr > 0 };
    });
    return { findings: out, stats: stats };
  }

  return {
    THRESHOLDS: THRESHOLDS,
    detect: detect,
    buildShadow: buildShadow,
    digitChains: digitChains
  };
});
