/* IndiaPII Guard redactor: token, mask and partial styles, per-entity token numbering and the
 * mapping (SPEC 5). Pure. Validates caller-built findings; style and exclude are validated by guard.js. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode
    ? { lexicon: require('./lexicon.js') }
    : { lexicon: root.IndiaPIIGuard.lexicon };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.IndiaPIIGuard = root.IndiaPIIGuard || {}; root.IndiaPIIGuard.redactor = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var L = deps.lexicon;
  var ALNUM_G = /[\p{L}\p{N}]/gu;

  function isPlainObject(x) { return Object.prototype.toString.call(x) === '[object Object]'; }
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }

  // Throws TypeError for wrong types or unknown entities, RangeError for bad offsets or overlaps.
  function validateFindings(text, findings) {
    if (!Array.isArray(findings)) throw new TypeError('findings must be an array');
    var prevEnd = 0;
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      if (!isPlainObject(f)) throw new TypeError('finding ' + i + ' must be an object');
      if (typeof f.entity !== 'string' || L.ENTITIES.indexOf(f.entity) < 0) {
        throw new TypeError('finding ' + i + ' has an unknown entity');
      }
      if (!isInt(f.start) || !isInt(f.end)) throw new TypeError('finding ' + i + ' start and end must be integers');
      if (f.start < 0 || f.end > text.length || f.start >= f.end) {
        throw new RangeError('finding ' + i + ' is out of range');
      }
      if (typeof f.value !== 'string') throw new TypeError('finding ' + i + ' value must be a string');
      if (f.start < prevEnd) throw new RangeError('findings must be sorted by start and must not overlap');
      prevEnd = f.end;
    }
  }

  function keyOf(f) { return f.entity + ':' + f.value; }

  function mask(span) { return span.replace(ALNUM_G, 'X'); }

  // Keeps the last 'keep' letters or digits; earlier ones become X; other characters stay.
  function keepLast(span, keep) {
    var m = span.match(ALNUM_G);
    var total = m ? m.length : 0;
    var n = 0;
    return span.replace(ALNUM_G, function (ch) {
      n++;
      return n > total - keep ? ch : 'X';
    });
  }

  function partial(entity, span) {
    if (entity === 'EMAIL' || entity === 'UPI') {
      var at = span.indexOf('@');
      var local = at < 0 ? span : span.slice(0, at);
      var rest = at < 0 ? '' : span.slice(at);
      if (local.length === 0) return span;
      var first = local.charAt(0);
      var tail = local.slice(1);
      var c0 = local.charCodeAt(0);
      if (c0 >= 0xD800 && c0 <= 0xDBFF && local.length > 1) { first = local.slice(0, 2); tail = local.slice(2); }
      return first + mask(tail) + rest;
    }
    return keepLast(span, 4);
  }

  // applyRedaction(text, findings, { style, exclude }) -> { text, findings, mapping, redactedCount }.
  function applyRedaction(text, findings, options) {
    validateFindings(text, findings);
    var opts = options || {};
    var style = opts.style || 'token';
    var excluded = {};
    var ex = opts.exclude || [];
    for (var e = 0; e < ex.length; e++) excluded[ex[e]] = true;

    var counters = {};
    var byKey = {};
    var mapping = [];
    var out = [];
    var redactedCount = 0;
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      var key = keyOf(f);
      var orig = text.slice(f.start, f.end);
      var copy = {};
      for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) copy[k] = f[k];
      if (excluded[key] === true) {
        copy.excluded = true;
        copy.replacement = orig;
        out.push(copy);
        continue;
      }
      redactedCount++;
      var entry = byKey[key];
      if (!entry) {
        var token = null;
        if (style === 'token') {
          counters[f.entity] = (counters[f.entity] || 0) + 1;
          token = '[' + f.entity + '_' + counters[f.entity] + ']';
        }
        entry = { key: key, entity: f.entity, token: token, text: orig, count: 0 };
        byKey[key] = entry;
        mapping.push(entry);
      }
      entry.count++;
      var replacement;
      if (style === 'token') replacement = entry.token;
      else if (style === 'mask') replacement = mask(orig);
      else replacement = partial(f.entity, orig);
      copy.excluded = false;
      copy.replacement = replacement;
      out.push(copy);
    }

    // Replace from the last finding to the first, so earlier offsets stay valid; the pieces are
    // collected and joined once to stay linear on long texts.
    var parts = [];
    var tailStart = text.length;
    for (i = out.length - 1; i >= 0; i--) {
      parts.push(text.slice(out[i].end, tailStart));
      parts.push(out[i].replacement);
      tailStart = out[i].start;
    }
    parts.push(text.slice(0, tailStart));
    parts.reverse();
    return { text: parts.join(''), findings: out, mapping: mapping, redactedCount: redactedCount };
  }

  return {
    applyRedaction: applyRedaction,
    validateFindings: validateFindings,
    findingKey: keyOf
  };
});
