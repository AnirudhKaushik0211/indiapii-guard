/* IndiaPII Guard synthetic data: identifier generators, fillers, decoys, noise and the template
 * slot renderer (SPEC 8.2-8.5, 9.2 slot grammar). Pure; all randomness comes from the rng argument. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode
    ? { prng: require('./prng.js'), validators: require('./validators.js'), lexicon: require('./lexicon.js') }
    : { prng: root.IndiaPIIGuard.prng, validators: root.IndiaPIIGuard.validators, lexicon: root.IndiaPIIGuard.lexicon };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.IndiaPIIGuard = root.IndiaPIIGuard || {}; root.IndiaPIIGuard.synth = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var P = deps.prng;
  var V = deps.validators;
  var L = deps.lexicon;

  var MAX_REDRAWS = 100;
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  // Fillers (SPEC 8.3): fictional names only.
  var FIRST_NAMES = ['Asha', 'Ravi', 'Priya', 'Arjun', 'Meera', 'Kabir', 'Neha', 'Rohan', 'Sana', 'Vikram', 'Divya',
    'Imran', 'Lakshmi', 'Farhan', 'Anjali', 'Suresh', 'Pooja', 'Rahul', 'Kavya', 'Nikhil'];
  var SURNAMES = ['Samplekar', 'Testwala', 'Demoraj', 'Mockerjee', 'Exampleton', 'Fictiva', 'Placeholdar', 'Dummyappa',
    'Notrealan', 'Specimenath'];
  var CITIES = ['Pune', 'Jaipur', 'Kochi', 'Indore', 'Lucknow', 'Mysuru'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];
  var FILLERS = ['NAME', 'NAME_UPPER', 'CITY', 'DATE', 'TIME', 'AMOUNT'];

  var EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.example.com', 'hr.example.org',
    'support.example.net'];
  var EMAIL_TAGS = ['work', 'kyc', 'test'];
  var UNKNOWN_HANDLES = ['okdemo', 'samplebank', 'fakepay', 'testupi'];

  // Format ids and weights per entity (SPEC 8.2).
  var PHONE_PREFIXES = [['none', 0.35], ['plus91-space', 0.25], ['plus91-hyphen', 0.10], ['plus91', 0.05],
    ['zero', 0.10], ['91-space', 0.05], ['paren-plus91', 0.05], ['0091-space', 0.05]];
  var PHONE_PREFIX_TEXT = { 'none': '', 'plus91-space': '+91 ', 'plus91-hyphen': '+91-', 'plus91': '+91', 'zero': '0',
    '91-space': '91 ', 'paren-plus91': '(+91) ', '0091-space': '0091 ' };
  var PHONE_GROUPINGS = [['10', 0.45], ['5-5', 0.35], ['3-3-4', 0.10], ['4-3-3', 0.05], ['2-4-4', 0.05]];
  var CARD_FORMATS_BY_LENGTH = {
    16: [['4-4-4-4-space', 0.5], ['contiguous', 0.3], ['4-4-4-4-hyphen', 0.2]],
    15: [['4-6-5', 0.7], ['contiguous', 0.3]],
    14: [['4-6-4', 0.7], ['contiguous', 0.3]],
    13: [['contiguous', 0.6], ['4-4-4-1', 0.4]]
  };

  var FORMAT_WEIGHTS = {
    AADHAAR: [['4-4-4-space', 0.5], ['contiguous', 0.3], ['4-4-4-hyphen', 0.2]],
    PAN: [['upper', 1.0]],
    EMAIL: [['plain', 1.0]],
    UPI: [['known', 0.85], ['unknown', 0.15]],
    IFSC: [['upper', 1.0]],
    GSTIN: [['standard', 1.0]],
    BANK_ACCOUNT: [['contiguous', 0.85], ['groups-of-4-space', 0.15]]
  };

  // Every valid format id per entity (used to validate fmt options).
  var FORMATS = (function () {
    var out = {
      AADHAAR: ['4-4-4-space', 'contiguous', '4-4-4-hyphen'],
      PHONE: [],
      CARD: ['4-4-4-4-space', 'contiguous', '4-4-4-4-hyphen', '4-6-5', '4-6-4', '4-4-4-1'],
      PAN: ['upper', 'lower'],
      EMAIL: ['plain'],
      UPI: ['known', 'unknown'],
      IFSC: ['upper'],
      GSTIN: ['standard'],
      BANK_ACCOUNT: ['contiguous', 'groups-of-4-space']
    };
    for (var i = 0; i < PHONE_PREFIXES.length; i++) {
      for (var j = 0; j < PHONE_GROUPINGS.length; j++) out.PHONE.push(PHONE_PREFIXES[i][0] + '/' + PHONE_GROUPINGS[j][0]);
    }
    return out;
  })();

  function hasFormat(entity, fmt) { return FORMATS[entity] !== undefined && FORMATS[entity].indexOf(fmt) >= 0; }

  function checkFormat(entity, fmt) {
    if (!hasFormat(entity, fmt)) throw new Error('unknown format ' + fmt + ' for ' + entity);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function letters(rng, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += P.pick(rng, ALPHA);
    return s;
  }

  // Splits a digit string into groups of the given lengths joined by sep.
  function groupDigits(d, lengths, sep) {
    var out = [];
    var at = 0;
    for (var i = 0; i < lengths.length; i++) {
      out.push(d.slice(at, at + lengths[i]));
      at += lengths[i];
    }
    return out.join(sep);
  }

  function lengthsOf(code) { return code.split('-').map(Number); }

  // Draws values until one is not in opts.avoid (first draw plus up to 100 redraws).
  function fresh(opts, draw) {
    var avoid = opts.avoid;
    for (var n = 0; n <= MAX_REDRAWS; n++) {
      var r = draw();
      if (!avoid || !avoid.has(r.value)) return r;
    }
    throw new Error('could not generate a fresh value');
  }

  function chooseFormat(rng, entity, opts) {
    if (opts.fmt !== undefined) { checkFormat(entity, opts.fmt); return opts.fmt; }
    return P.weighted(rng, FORMAT_WEIGHTS[entity]);
  }

  function genAADHAAR(rng, opts) {
    var o = opts || {};
    var fmt = chooseFormat(rng, 'AADHAAR', o);
    return fresh(o, function () {
      var d = String(P.int(rng, 2, 9)) + P.digits(rng, 10);
      d += String(V.verhoeffDigit(d));
      var text = fmt === 'contiguous' ? d : groupDigits(d, [4, 4, 4], fmt === '4-4-4-space' ? ' ' : '-');
      return { text: text, value: d, format: fmt };
    });
  }

  function genPHONE(rng, opts) {
    var o = opts || {};
    var prefix, grouping;
    if (o.fmt !== undefined) {
      checkFormat('PHONE', o.fmt);
      prefix = o.fmt.split('/')[0];
      grouping = o.fmt.split('/')[1];
    } else {
      prefix = P.weighted(rng, PHONE_PREFIXES);
      grouping = P.weighted(rng, PHONE_GROUPINGS);
    }
    var sep = grouping === '10' ? '' : P.weighted(rng, [[' ', 0.8], ['-', 0.2]]);
    var fmt = prefix + '/' + grouping;
    return fresh(o, function () {
      var d = String(P.int(rng, 6, 9)) + P.digits(rng, 9);
      return { text: PHONE_PREFIX_TEXT[prefix] + groupDigits(d, lengthsOf(grouping), sep), value: d, format: fmt };
    });
  }

  // Cards come from the public test list; CARD values are shared by all sets, so avoid is not applied.
  function genCARD(rng, opts) {
    var o = opts || {};
    var card, fmt;
    if (o.fmt !== undefined) {
      checkFormat('CARD', o.fmt);
      var pool = L.TEST_CARDS.filter(function (c) {
        var list = CARD_FORMATS_BY_LENGTH[c.length];
        return list !== undefined && list.some(function (f) { return f[0] === o.fmt; });
      });
      card = P.pick(rng, pool);
      fmt = o.fmt;
    } else {
      card = P.pick(rng, L.TEST_CARDS);
      fmt = P.weighted(rng, CARD_FORMATS_BY_LENGTH[card.length]);
    }
    var text;
    if (fmt === 'contiguous') text = card;
    else if (fmt === '4-4-4-4-space') text = groupDigits(card, [4, 4, 4, 4], ' ');
    else if (fmt === '4-4-4-4-hyphen') text = groupDigits(card, [4, 4, 4, 4], '-');
    else text = groupDigits(card, lengthsOf(fmt), ' ');
    return { text: text, value: card, format: fmt };
  }

  function panCore(rng, holderPairs) {
    return letters(rng, 3) + P.weighted(rng, holderPairs) + letters(rng, 1) + P.digits(rng, 4) + letters(rng, 1);
  }

  var PAN_HOLDERS = [['P', 0.85], ['C', 0.05], ['H', 0.03], ['F', 0.03], ['A', 0.02], ['T', 0.02]];
  var GSTIN_HOLDERS = [['C', 0.4], ['F', 0.2], ['P', 0.3], ['A', 0.05], ['T', 0.05]];

  function genPAN(rng, opts) {
    var o = opts || {};
    var fmt = chooseFormat(rng, 'PAN', o);
    return fresh(o, function () {
      var v = panCore(rng, PAN_HOLDERS);
      return { text: fmt === 'lower' ? v.toLowerCase() : v, value: v, format: fmt };
    });
  }

  function nameLocal(rng, styles) {
    var first = P.pick(rng, FIRST_NAMES).toLowerCase();
    var last = P.pick(rng, SURNAMES).toLowerCase();
    var style = P.weighted(rng, styles);
    if (style === 'first.last') return first + '.' + last;
    if (style === 'first_last') return first + '_' + last;
    if (style === 'first2') return first + P.digits(rng, 2);
    if (style === 'first.l') return first + '.' + last.charAt(0);
    return first + '+' + P.pick(rng, EMAIL_TAGS);
  }

  var EMAIL_STYLES = [['first.last', 0.4], ['first_last', 0.15], ['first2', 0.15], ['first.l', 0.15], ['first+tag', 0.15]];
  var UPI_NAME_STYLES = [['first.last', 0.4], ['first_last', 0.15], ['first2', 0.15], ['first.l', 0.15]];

  function genEMAIL(rng, opts) {
    var o = opts || {};
    var fmt = chooseFormat(rng, 'EMAIL', o);
    return fresh(o, function () {
      var v = nameLocal(rng, EMAIL_STYLES) + '@' + P.pick(rng, EMAIL_DOMAINS);
      return { text: v, value: v.toLowerCase(), format: fmt };
    });
  }

  function genUPI(rng, opts) {
    var o = opts || {};
    var fmt = chooseFormat(rng, 'UPI', o);
    return fresh(o, function () {
      var kind = P.weighted(rng, [['name', 0.6], ['mobile', 0.25], ['name3', 0.15]]);
      var local;
      if (kind === 'name') local = nameLocal(rng, UPI_NAME_STYLES);
      else if (kind === 'mobile') local = String(P.int(rng, 6, 9)) + P.digits(rng, 9);
      else local = P.pick(rng, FIRST_NAMES).toLowerCase() + P.digits(rng, 3);
      var handle = fmt === 'known' ? P.pick(rng, L.UPI_HANDLES) : P.pick(rng, UNKNOWN_HANDLES);
      var v = local + '@' + handle;
      return { text: v, value: v.toLowerCase(), format: fmt };
    });
  }

  function ifscCore(rng) {
    var s = letters(rng, 4) + '0';
    for (var i = 0; i < 6; i++) s += P.chance(rng, 0.8) ? String(P.int(rng, 0, 9)) : P.pick(rng, ALPHA);
    return s;
  }

  function genIFSC(rng, opts) {
    var o = opts || {};
    var fmt = chooseFormat(rng, 'IFSC', o);
    return fresh(o, function () {
      var v = ifscCore(rng);
      return { text: v, value: v, format: fmt };
    });
  }

  function genGSTIN(rng, opts) {
    var o = opts || {};
    var fmt = chooseFormat(rng, 'GSTIN', o);
    return fresh(o, function () {
      var s = P.pick(rng, V.GST_STATE_CODES) + panCore(rng, GSTIN_HOLDERS);
      s += P.chance(rng, 0.9) ? String(P.int(rng, 1, 9)) : P.pick(rng, ALPHA);
      s += 'Z';
      s += V.gstinCheckChar(s);
      return { text: s, value: s, format: fmt };
    });
  }

  // Groups of 4 separated by spaces; a last group of 1 or 2 digits is merged into the previous group.
  function bankGroups(d) {
    var groups = [];
    for (var i = 0; i < d.length; i += 4) groups.push(d.slice(i, i + 4));
    var last = groups[groups.length - 1];
    if (groups.length > 1 && last.length <= 2) {
      groups.pop();
      groups[groups.length - 1] += last;
    }
    return groups.join(' ');
  }

  function genBANK_ACCOUNT(rng, opts) {
    var o = opts || {};
    var fmt = chooseFormat(rng, 'BANK_ACCOUNT', o);
    return fresh(o, function () {
      var len = P.int(rng, 9, 18);
      var d = String(P.int(rng, 1, 9)) + P.digits(rng, len - 1);
      return { text: fmt === 'contiguous' ? d : bankGroups(d), value: d, format: fmt };
    });
  }

  var GENERATORS = {
    AADHAAR: genAADHAAR, PHONE: genPHONE, CARD: genCARD, PAN: genPAN, EMAIL: genEMAIL, UPI: genUPI, IFSC: genIFSC,
    GSTIN: genGSTIN, BANK_ACCOUNT: genBANK_ACCOUNT
  };

  // Indian comma grouping: last three digits, then groups of two.
  function indianGroup(s) {
    if (s.length <= 3) return s;
    var head = s.slice(0, s.length - 3);
    var tail = s.slice(s.length - 3);
    var parts = [];
    while (head.length > 2) {
      parts.unshift(head.slice(head.length - 2));
      head = head.slice(0, head.length - 2);
    }
    if (head.length) parts.unshift(head);
    return parts.join(',') + ',' + tail;
  }

  function genFiller(rng, kind) {
    if (kind === 'NAME' || kind === 'NAME_UPPER') {
      var name = P.pick(rng, FIRST_NAMES) + ' ' + P.pick(rng, SURNAMES);
      return kind === 'NAME' ? name : name.toUpperCase();
    }
    if (kind === 'CITY') return P.pick(rng, CITIES);
    if (kind === 'DATE') {
      var style = P.int(rng, 0, 2);
      var day = P.int(rng, 1, 28);
      var month = P.int(rng, 1, 12);
      if (style === 0) return pad2(day) + '-' + pad2(month) + '-2026';
      if (style === 1) return pad2(day) + '/' + pad2(month) + '/2026';
      return day + ' ' + MONTHS[month - 1] + ' 2026';
    }
    if (kind === 'TIME') return pad2(P.int(rng, 0, 23)) + ':' + pad2(P.int(rng, 0, 59));
    if (kind === 'AMOUNT') {
      var n = P.int(rng, 100, 99999);
      return (P.chance(rng, 0.5) ? 'Rs ' : '\u20B9') + indianGroup(String(n));
    }
    throw new Error('unknown filler ' + kind);
  }

  // Decoy types in the order of the SPEC 8.4 table.
  var DECOY_TYPES = ['order10', 'order16', 'utr12', 'invoice', 'timestamp', 'epoch10', 'epochms13', 'price', 'awb', 'pnr',
    'otp', 'pincode', 'sku-pan', 'coupon-ifsc', 'handle-local', 'version'];
  var HANDLE_WORDS = ['build', 'admin', 'deploy', 'root', 'intranet', 'localhost', 'server'];

  function genDecoy(rng, type) {
    var t;
    if (type === 'order10' || type === 'pnr') {
      t = String(P.int(rng, 6, 9)) + P.digits(rng, 9);
    } else if (type === 'order16') {
      var d15 = '4' + P.digits(rng, 14);
      var d16 = d15 + String(V.luhnDigit(d15));
      t = P.chance(rng, 0.5) ? d16 : groupDigits(d16, [4, 4, 4, 4], ' ');
    } else if (type === 'utr12') {
      var d11 = String(P.int(rng, 2, 9)) + P.digits(rng, 10);
      t = d11 + String(V.verhoeffDigit(d11));
    } else if (type === 'invoice') {
      t = 'INV-2026-' + P.digits(rng, 6);
    } else if (type === 'timestamp') {
      t = '2026-' + pad2(P.int(rng, 1, 12)) + '-' + pad2(P.int(rng, 1, 28)) + ' ' + pad2(P.int(rng, 0, 23)) + ':' +
        pad2(P.int(rng, 0, 59)) + ':' + pad2(P.int(rng, 0, 59));
    } else if (type === 'epoch10') {
      t = '17' + P.digits(rng, 8);
    } else if (type === 'epochms13') {
      t = '17' + P.digits(rng, 11);
    } else if (type === 'price') {
      var n = P.int(rng, 6, 9);
      t = indianGroup(String(P.int(rng, 1, 9)) + P.digits(rng, n - 1));
      if (P.chance(rng, 0.5)) t += '.00';
    } else if (type === 'awb') {
      var len = P.int(rng, 10, 12);
      t = String(len === 10 ? P.int(rng, 6, 9) : P.int(rng, 1, 9)) + P.digits(rng, len - 1);
    } else if (type === 'otp') {
      t = P.digits(rng, 6);
    } else if (type === 'pincode') {
      t = String(P.int(rng, 1, 8)) + P.digits(rng, 5);
    } else if (type === 'sku-pan') {
      t = panCore(rng, [['P', 1]]);
    } else if (type === 'coupon-ifsc') {
      t = ifscCore(rng);
    } else if (type === 'handle-local') {
      t = P.pick(rng, HANDLE_WORDS) + '@' + P.pick(rng, HANDLE_WORDS);
    } else if (type === 'version') {
      t = 'v' + P.int(rng, 1, 9) + '.' + P.int(rng, 0, 20) + '.' + P.int(rng, 0, 20);
    } else {
      throw new Error('unknown decoy type ' + type);
    }
    return { text: t, type: type };
  }

  // Noise (SPEC 8.5).
  var NOISE_IDS = ['ocr1', 'ocr2', 'ocr3', 'dspace', 'nbsp', 'spaced-hyphen', 'lower', 'irregular', 'obfuscated-email',
    'spaced-upi'];
  var NUMERIC_ENTITIES = ['AADHAAR', 'PHONE', 'CARD', 'BANK_ACCOUNT'];
  var NOISE_APPLIES_TO = {
    'ocr1': NUMERIC_ENTITIES, 'ocr2': NUMERIC_ENTITIES, 'ocr3': NUMERIC_ENTITIES,
    'dspace': NUMERIC_ENTITIES, 'nbsp': NUMERIC_ENTITIES, 'spaced-hyphen': NUMERIC_ENTITIES,
    'lower': ['PAN', 'IFSC', 'GSTIN'],
    'irregular': ['AADHAAR', 'PHONE'],
    'obfuscated-email': ['EMAIL'],
    'spaced-upi': ['UPI']
  };
  var OCR_COUNT = { ocr1: 1, ocr2: 2, ocr3: 3 };
  var SEPARATOR_NOISE = { 'dspace': '  ', 'nbsp': '\u00A0', 'spaced-hyphen': ' - ' };

  // True when the format renders at least one separator between two digit runs.
  function isGroupedFormat(entity, fmt) {
    if (entity === 'AADHAAR') return fmt === '4-4-4-space' || fmt === '4-4-4-hyphen';
    if (entity === 'PHONE') return typeof fmt === 'string' && hasFormat('PHONE', fmt) && fmt.split('/')[1] !== '10';
    if (entity === 'CARD') return hasFormat('CARD', fmt) && fmt !== 'contiguous';
    if (entity === 'BANK_ACCOUNT') return fmt === 'groups-of-4-space';
    return false;
  }

  function checkNoiseApplies(noise, entity) {
    var list = NOISE_APPLIES_TO[noise];
    if (list === undefined) throw new Error('unknown noise ' + noise);
    if (list.indexOf(entity) < 0) throw new Error('noise ' + noise + ' does not apply to ' + entity);
  }

  // Problem with a noise/fmt combination on an entity slot, or null (SPEC 8.5 applies-to matrix).
  function noiseProblem(entity, noise, fmt) {
    var list = NOISE_APPLIES_TO[noise];
    if (list === undefined) return 'unknown noise ' + noise;
    if (list.indexOf(entity) < 0) return 'noise ' + noise + ' does not apply to ' + entity;
    if (SEPARATOR_NOISE[noise] !== undefined && !isGroupedFormat(entity, fmt)) {
      return 'noise ' + noise + ' needs a grouped fmt for ' + entity;
    }
    if (noise === 'irregular' && entity === 'PHONE' && (typeof fmt !== 'string' || fmt.split('/')[0] !== 'none')) {
      return 'noise irregular on PHONE needs fmt with prefix none';
    }
    return null;
  }

  // OCR placement rule: replaces k eligible 0/1 digits, or returns null if k cannot be placed.
  function placeOcr(rng, text, k) {
    var groups = [];
    var re = /[0-9]+/g;
    var m;
    while ((m = re.exec(text)) !== null) groups.push({ start: m.index, length: m[0].length });
    var remaining = [];
    for (var g = 0; g < groups.length; g++) {
      if (groups[g].length < 3) continue;
      for (var i = groups[g].start; i < groups[g].start + groups[g].length; i++) {
        var c = text.charAt(i);
        if (c === '0' || c === '1') remaining.push({ pos: i, g: g });
      }
    }
    var used = {};
    var chosen = [];
    while (chosen.length < k && remaining.length > 0) {
      var cand = remaining.splice(P.int(rng, 0, remaining.length - 1), 1)[0];
      var count = used[cand.g] || 0;
      if (count + 1 > Math.floor(groups[cand.g].length / 2)) continue;
      used[cand.g] = count + 1;
      chosen.push(cand.pos);
    }
    if (chosen.length < k) return null;
    chosen.sort(function (a, b) { return a - b; });
    var chars = text.split('');
    for (var j = 0; j < chosen.length; j++) {
      chars[chosen[j]] = chars[chosen[j]] === '0' ? 'O' : P.pick(rng, ['l', 'I']);
    }
    return chars.join('');
  }

  function withText(item, text, format) {
    return { text: text, value: item.value, format: format === undefined ? item.format : format };
  }

  // Applies a non-OCR noise to a generated item { text, value, format }; returns a new item.
  function applyNoise(rng, noise, entity, item) {
    checkNoiseApplies(noise, entity);
    if (OCR_COUNT[noise] !== undefined) {
      var t = placeOcr(rng, item.text, OCR_COUNT[noise]);
      if (t === null) throw new Error('could not place OCR noise');
      return withText(item, t);
    }
    if (SEPARATOR_NOISE[noise] !== undefined) {
      if (!isGroupedFormat(entity, item.format)) throw new Error('noise ' + noise + ' needs a grouped fmt for ' + entity);
      var sep = SEPARATOR_NOISE[noise];
      return withText(item, item.text.replace(/([0-9])[ \-](?=[0-9])/g, function (all, d) { return d + sep; }));
    }
    if (noise === 'lower') return withText(item, item.text.toLowerCase());
    if (noise === 'irregular') {
      if (entity === 'AADHAAR') {
        var code = P.pick(rng, ['4-3-5', '3-4-5']);
        return withText(item, groupDigits(item.value, lengthsOf(code), ' '), code);
      }
      if (item.format.split('/')[0] !== 'none') throw new Error('noise irregular on PHONE needs fmt with prefix none');
      return withText(item, groupDigits(item.value, [3, 2, 5], ' '), 'none/3-2-5');
    }
    var at = item.text.indexOf('@');
    var local = item.text.slice(0, at);
    var domain = item.text.slice(at + 1);
    if (noise === 'obfuscated-email') return withText(item, local + ' [at] ' + domain.split('.').join(' [dot] '));
    return withText(item, local + ' @ ' + domain);
  }

  // Generates one entity value with optional fmt, noise and avoid. OCR noise redraws the value
  // (same fmt and avoid) until k replacements can be placed (SPEC 8.5).
  function genValue(rng, entity, opts) {
    var o = opts || {};
    var gen = GENERATORS[entity];
    if (!gen) throw new Error('unknown entity ' + entity);
    if (o.noise === undefined) return gen(rng, { fmt: o.fmt, avoid: o.avoid });
    checkNoiseApplies(o.noise, entity);
    if (OCR_COUNT[o.noise] === undefined) return applyNoise(rng, o.noise, entity, gen(rng, { fmt: o.fmt, avoid: o.avoid }));
    var fmt = o.fmt;
    for (var n = 0; n <= MAX_REDRAWS; n++) {
      var item = gen(rng, { fmt: fmt, avoid: o.avoid });
      fmt = item.format;
      var t = placeOcr(rng, item.text, OCR_COUNT[o.noise]);
      if (t !== null) return withText(item, t);
    }
    throw new Error('could not place OCR noise');
  }

  // Template slot grammar (SPEC 9.2). Returns [{ type: 'text', text } | { type: 'slot', kind, entity, filler,
  // decoy, fmt, noise, knownMiss }]. Throws Error(problem) on a malformed template.
  function parseTemplate(text) {
    var parts = [];
    var buf = '';
    var i = 0;
    while (i < text.length) {
      var c = text.charAt(i);
      if (c === '{' && text.charAt(i + 1) === '{') { buf += '{'; i += 2; continue; }
      if (c === '}' && text.charAt(i + 1) === '}') { buf += '}'; i += 2; continue; }
      if (c === '}') throw new Error('unmatched } at ' + i);
      if (c !== '{') { buf += c; i++; continue; }
      var close = text.indexOf('}', i + 1);
      if (close < 0) throw new Error('unclosed slot at ' + i);
      var body = text.slice(i + 1, close);
      if (body.indexOf('{') >= 0) throw new Error('unclosed slot at ' + i);
      if (buf) { parts.push({ type: 'text', text: buf }); buf = ''; }
      parts.push(parseSlot(body));
      i = close + 1;
    }
    if (buf) parts.push({ type: 'text', text: buf });
    return parts;
  }

  function parseSlot(body) {
    var bar = body.indexOf('|');
    var kind = bar < 0 ? body : body.slice(0, bar);
    var slot = { type: 'slot', kind: kind, entity: null, filler: null, decoy: null, fmt: undefined, noise: undefined,
      knownMiss: false };
    if (L.ENTITIES.indexOf(kind) >= 0) slot.entity = kind;
    else if (FILLERS.indexOf(kind) >= 0) slot.filler = kind;
    else if (kind.indexOf('DECOY:') === 0 && DECOY_TYPES.indexOf(kind.slice(6)) >= 0) slot.decoy = kind.slice(6);
    else if (kind.indexOf('DECOY:') === 0) throw new Error('unknown decoy type ' + kind.slice(6));
    else throw new Error('unknown slot kind ' + (kind || '(empty)'));
    if (bar >= 0) {
      var opts = body.slice(bar + 1).split(',');
      var seen = {};
      for (var k = 0; k < opts.length; k++) {
        var eq = opts[k].indexOf('=');
        var key = eq < 0 ? opts[k] : opts[k].slice(0, eq);
        var val = eq < 0 ? undefined : opts[k].slice(eq + 1);
        if (seen[key]) throw new Error('option ' + key + ' given twice');
        seen[key] = true;
        if (key === 'knownMiss' && val === undefined) slot.knownMiss = true;
        else if ((key === 'fmt' || key === 'noise') && val) slot[key] = val;
        else throw new Error('invalid option ' + (opts[k] || '(empty)'));
      }
    }
    if (slot.fmt !== undefined) {
      if (!slot.entity) throw new Error('fmt is only allowed on entity slots');
      if (!hasFormat(slot.entity, slot.fmt)) throw new Error('unknown format ' + slot.fmt + ' for ' + slot.entity);
    }
    if (slot.noise !== undefined) {
      if (!slot.entity) throw new Error('noise is only allowed on entity slots');
      var problem = noiseProblem(slot.entity, slot.noise, slot.fmt);
      if (problem) throw new Error(problem);
    }
    return slot;
  }

  // Renders parsed template parts left to right. Every labelled slot records its span from the output
  // length before and after appending. Non-CARD canonical values are added to avoid.
  // Returns { text, gold: [{ entity, start, end, format, noise, knownMiss, value }], decoys: [{ type, start, end }] }.
  function renderTemplate(rng, parts, avoid) {
    var out = '';
    var gold = [];
    var decoys = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type === 'text') { out += p.text; continue; }
      var start = out.length;
      if (p.entity) {
        var item = genValue(rng, p.entity, { fmt: p.fmt, noise: p.noise, avoid: avoid });
        out += item.text;
        gold.push({ entity: p.entity, start: start, end: out.length, format: item.format,
          noise: p.noise === undefined ? null : p.noise, knownMiss: p.knownMiss, value: item.value });
        if (avoid && p.entity !== 'CARD') avoid.add(item.value);
      } else if (p.decoy) {
        out += genDecoy(rng, p.decoy).text;
        decoys.push({ type: p.decoy, start: start, end: out.length });
      } else {
        out += genFiller(rng, p.filler);
      }
    }
    return { text: out, gold: gold, decoys: decoys };
  }

  return {
    FIRST_NAMES: FIRST_NAMES,
    SURNAMES: SURNAMES,
    CITIES: CITIES,
    FILLERS: FILLERS,
    EMAIL_DOMAINS: EMAIL_DOMAINS,
    UNKNOWN_HANDLES: UNKNOWN_HANDLES,
    FORMATS: FORMATS,
    DECOY_TYPES: DECOY_TYPES,
    NOISE_IDS: NOISE_IDS,
    NOISE_APPLIES_TO: NOISE_APPLIES_TO,
    GENERATORS: GENERATORS,
    genAADHAAR: genAADHAAR,
    genPHONE: genPHONE,
    genCARD: genCARD,
    genPAN: genPAN,
    genEMAIL: genEMAIL,
    genUPI: genUPI,
    genIFSC: genIFSC,
    genGSTIN: genGSTIN,
    genBANK_ACCOUNT: genBANK_ACCOUNT,
    genFiller: genFiller,
    genDecoy: genDecoy,
    indianGroup: indianGroup,
    isGroupedFormat: isGroupedFormat,
    noiseProblem: noiseProblem,
    placeOcr: placeOcr,
    applyNoise: applyNoise,
    genValue: genValue,
    parseTemplate: parseTemplate,
    renderTemplate: renderTemplate
  };
});
