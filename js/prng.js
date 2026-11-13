/* IndiaPII Guard seeded PRNG: mulberry32 and helpers (SPEC 8.1).
 * All randomness in the project comes from here; the same seed gives the same output everywhere. */
(function (root, factory) {
  'use strict';
  var isNode = typeof module === 'object' && module && module.exports;
  var deps = {};
  var api = factory(deps);
  if (isNode) module.exports = api;
  else { root.IndiaPIIGuard = root.IndiaPIIGuard || {}; root.IndiaPIIGuard.prng = api; }
})(typeof self !== 'undefined' ? self : this, function (deps) {
  'use strict';

  // mulberry32 with the state kept as an unsigned 32-bit integer (SPEC 8.1, exactly).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Inclusive integer in [lo, hi].
  function int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

  function pick(rng, array) { return array[int(rng, 0, array.length - 1)]; }

  // pairs: [[value, weight], ...]; returns the first value with rng() * total < cumulative.
  function weighted(rng, pairs) {
    var total = 0;
    var i;
    for (i = 0; i < pairs.length; i++) total += pairs[i][1];
    var r = rng() * total;
    var cumulative = 0;
    for (i = 0; i < pairs.length; i++) {
      cumulative += pairs[i][1];
      if (r < cumulative) return pairs[i][0];
    }
    return pairs[pairs.length - 1][0];
  }

  function chance(rng, p) { return rng() < p; }

  // n random decimal digits as a string.
  function digits(rng, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += String(int(rng, 0, 9));
    return s;
  }

  return {
    mulberry32: mulberry32,
    int: int,
    pick: pick,
    weighted: weighted,
    chance: chance,
    digits: digits
  };
});
