/* IndiaPII Guard public API: detect, redact, applyRedaction, constants (SPEC 6.1).
 * Owns argument validation; the library throws synchronously and never logs. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = isNode
    ? { detector: require('./detector.js'), redactor: require('./redactor.js'), lexicon: require('./lexicon.js'),
      validators: require('./validators.js') }
    : { detector: root.IndiaPIIGuard.detector, redactor: root.IndiaPIIGuard.redactor,
      lexicon: root.IndiaPIIGuard.lexicon, validators: root.IndiaPIIGuard.validators };
  var api = factory(deps);
  if (isNode) module.exports = api;
  else {
    root.IndiaPIIGuard = root.IndiaPIIGuard || {};
    root.IndiaPIIGuard.guard = api;
    for (var k in api) if (Object.prototype.hasOwnProperty.call(api, k)) root.IndiaPIIGuard[k] = api[k];
  }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';
  var D = deps.detector;
  var R = deps.redactor;
  var L = deps.lexicon;

  var VERSION = '1.0.0';
  var CSP_META = true;
  var THRESHOLDS = { lenient: 0.35, balanced: 0.5, strict: 0.7 };
  var DEFAULT_MAX_LENGTH = 1000000;
  var ENTITIES_MSG = 'entities must be an array of entity ids or an object of booleans';

  function isPlainObject(x) { return Object.prototype.toString.call(x) === '[object Object]'; }

  // Validates text and options in the order of SPEC 6.1 and returns normalised options.
  function normalise(text, options) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (options !== undefined && !isPlainObject(options)) throw new TypeError('options must be an object');
    var o = options || {};
    var out = { threshold: 0.5, entities: undefined, style: 'token', ocrNormalise: true, exclude: [],
      maxLength: DEFAULT_MAX_LENGTH };

    if (o.threshold !== undefined) {
      var t = o.threshold;
      if (typeof t === 'string' && Object.prototype.hasOwnProperty.call(THRESHOLDS, t)) out.threshold = THRESHOLDS[t];
      else if (typeof t === 'number' && isFinite(t) && t >= 0 && t <= 1) out.threshold = t;
      else throw new TypeError('threshold must be a number between 0 and 1 or a preset name');
    }

    if (o.entities !== undefined) {
      var e = o.entities;
      var i;
      if (Array.isArray(e)) {
        for (i = 0; i < e.length; i++) {
          if (typeof e[i] !== 'string') throw new TypeError(ENTITIES_MSG);
          if (L.ENTITIES.indexOf(e[i]) < 0) throw new TypeError('unknown entity: ' + e[i]);
        }
        out.entities = e.slice();
      } else if (isPlainObject(e)) {
        var keys = Object.keys(e);
        var obj = {};
        for (i = 0; i < keys.length; i++) {
          if (L.ENTITIES.indexOf(keys[i]) < 0) throw new TypeError('unknown entity: ' + keys[i]);
          if (typeof e[keys[i]] !== 'boolean') throw new TypeError(ENTITIES_MSG);
          obj[keys[i]] = e[keys[i]];
        }
        out.entities = obj;
      } else {
        throw new TypeError(ENTITIES_MSG);
      }
    }

    if (o.style !== undefined) {
      if (o.style !== 'token' && o.style !== 'mask' && o.style !== 'partial') {
        throw new TypeError('style must be token, mask or partial');
      }
      out.style = o.style;
    }

    if (o.ocrNormalise !== undefined) {
      if (typeof o.ocrNormalise !== 'boolean') throw new TypeError('ocrNormalise must be a boolean');
      out.ocrNormalise = o.ocrNormalise;
    }

    if (o.exclude !== undefined) {
      var bad = !Array.isArray(o.exclude);
      if (!bad) for (var x = 0; x < o.exclude.length; x++) if (typeof o.exclude[x] !== 'string') bad = true;
      if (bad) throw new TypeError('exclude must be an array of strings');
      out.exclude = o.exclude.slice();
    }

    if (o.maxLength !== undefined) {
      var m = o.maxLength;
      if (typeof m !== 'number' || !isFinite(m) || Math.floor(m) !== m || m < 1) {
        throw new TypeError('maxLength must be a positive integer');
      }
      out.maxLength = m;
    }

    if (text.length > out.maxLength) throw new RangeError('text is longer than ' + out.maxLength + ' characters');
    return out;
  }

  function detect(text, options) {
    var o = normalise(text, options);
    return D.detect(text, { threshold: o.threshold, entities: o.entities, ocrNormalise: o.ocrNormalise });
  }

  function redact(text, options) {
    var o = normalise(text, options);
    var det = D.detect(text, { threshold: o.threshold, entities: o.entities, ocrNormalise: o.ocrNormalise });
    var r = R.applyRedaction(text, det.findings, { style: o.style, exclude: o.exclude });
    return { text: r.text, findings: r.findings, mapping: r.mapping, redactedCount: r.redactedCount, stats: det.stats };
  }

  function applyRedaction(text, findings, options) {
    var o = normalise(text, options);
    return R.applyRedaction(text, findings, { style: o.style, exclude: o.exclude });
  }

  return {
    VERSION: VERSION,
    ENTITIES: L.ENTITIES.slice(),
    THRESHOLDS: THRESHOLDS,
    CSP_META: CSP_META,
    detect: detect,
    redact: redact,
    applyRedaction: applyRedaction,
    validators: deps.validators
  };
});
