'use strict';
// Template validation and dataset builder (SPEC 9.1-9.3, 8.5 isUnsupported).
const fs = require('node:fs');
const path = require('node:path');
const prng = require('../js/prng.js');
const synth = require('../js/synth.js');
const lexicon = require('../js/lexicon.js');

const ROOT = path.join(__dirname, '..');
const ENTITIES = lexicon.ENTITIES;
const SET_NAMES = ['dev', 'heldout', 'adversarial'];
const DOMAINS = ['support', 'hr', 'chat', 'kyc', 'payments', 'ocr', 'logs', 'email', 'misc'];
const LANGS = ['en', 'hinglish', 'hi-mixed'];
const MAX_TEXT = 1000;

const SETS = {
  dev: { file: 'eval/templates-dev.cjs', seed: 1001, gold: 120, decoys: 5, negEvery: 5 },
  heldout: { file: 'eval/templates-heldout.cjs', seed: 2002, gold: 150, decoys: 5, negEvery: 5 },
  adversarial: { file: 'eval/templates-adversarial.cjs', seed: 3003, gold: 60, decoys: 20, negEvery: 3 }
};
const QUICK = { gold: 10, decoys: 1 };
const LATENCY_SEED = 4004;

const MIN_COUNTS = {
  dev: { positive: 45, negative: 10, decoy: 1 },
  heldout: { positive: 45, negative: 10, decoy: 1 },
  adversarial: { positive: 40, negative: 15, decoy: 2 }
};

// SPEC 8.5, exactly.
function isUnsupported(gold) {
  return gold.noise === 'ocr3' || gold.noise === 'obfuscated-email' || gold.noise === 'spaced-upi' ||
         (gold.noise === 'lower' && gold.entity === 'GSTIN') ||
         (gold.noise === 'irregular' && gold.entity === 'AADHAAR');
}

function templateError(file, id, problem) {
  return new Error('Template error in ' + file + ': ' + id + ': ' + problem);
}

// Skeleton: slots replaced by {}, lower-cased, whitespace runs collapsed (SPEC 9.2).
function skeleton(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if ((c === '{' && text.charAt(i + 1) === '{') || (c === '}' && text.charAt(i + 1) === '}')) {
      out += c; i += 2; continue;
    }
    if (c === '{') {
      const close = text.indexOf('}', i + 1);
      out += '{}';
      i = close < 0 ? text.length : close + 1;
      continue;
    }
    out += c; i++;
  }
  return out.toLowerCase().replace(/\s+/g, ' ');
}

// Validates one template file's module. Returns [{ id, domain, lang, text, parts, positive, entities, decoys,
// noises }]. seenIds (a Map id -> file) is shared across files.
function validateFile(file, mod, expectedSet, seenIds) {
  if (!mod || typeof mod !== 'object') throw templateError(file, '(file)', 'module must export an object');
  if (mod.set !== expectedSet) throw templateError(file, '(file)', 'set must be ' + expectedSet);
  if (!Array.isArray(mod.templates)) throw templateError(file, '(file)', 'templates must be an array');
  const out = [];
  for (let k = 0; k < mod.templates.length; k++) {
    const t = mod.templates[k];
    const id = t && typeof t.id === 'string' && t.id ? t.id : '(template ' + (k + 1) + ')';
    if (!t || typeof t !== 'object') throw templateError(file, id, 'template must be an object');
    if (typeof t.id !== 'string' || !t.id) throw templateError(file, id, 'id must be a non-empty string');
    if (seenIds.has(t.id)) throw templateError(file, id, 'duplicate id (also in ' + seenIds.get(t.id) + ')');
    seenIds.set(t.id, file);
    if (DOMAINS.indexOf(t.domain) < 0) throw templateError(file, id, 'unknown domain ' + t.domain);
    if (LANGS.indexOf(t.lang) < 0) throw templateError(file, id, 'unknown lang ' + t.lang);
    if (typeof t.text !== 'string' || t.text.length === 0) throw templateError(file, id, 'text must be a non-empty string');
    if (t.text.length > MAX_TEXT) throw templateError(file, id, 'text is longer than ' + MAX_TEXT + ' characters');
    let parts;
    try { parts = synth.parseTemplate(t.text); } catch (e) { throw templateError(file, id, e.message); }
    const entities = new Set();
    const decoys = new Set();
    const noises = new Set();
    for (const p of parts) {
      if (p.type !== 'slot') continue;
      if (p.entity) entities.add(p.entity);
      if (p.decoy) decoys.add(p.decoy);
      if (p.noise) noises.add(p.noise);
    }
    out.push({ id: t.id, domain: t.domain, lang: t.lang, text: t.text, parts, positive: entities.size > 0,
      entities, decoys, noises });
  }
  const min = MIN_COUNTS[expectedSet];
  const pos = out.filter((t) => t.positive);
  const neg = out.filter((t) => !t.positive);
  if (pos.length < min.positive) {
    throw templateError(file, '(file)', 'needs at least ' + min.positive + ' positive templates, has ' + pos.length);
  }
  if (neg.length < min.negative) {
    throw templateError(file, '(file)', 'needs at least ' + min.negative + ' negative templates, has ' + neg.length);
  }
  for (const e of ENTITIES) {
    const n = pos.filter((t) => t.entities.has(e)).length;
    if (n < 5) throw templateError(file, '(file)', 'entity ' + e + ' is in ' + n + ' positive templates, needs 5');
  }
  for (const d of synth.DECOY_TYPES) {
    const n = out.filter((t) => t.decoys.has(d)).length;
    if (n < min.decoy) throw templateError(file, '(file)', 'decoy ' + d + ' is in ' + n + ' templates, needs ' + min.decoy);
  }
  const mixed = out.filter((t) => t.lang === 'hinglish' || t.lang === 'hi-mixed').length;
  if (mixed * 5 < out.length) {
    throw templateError(file, '(file)', 'needs at least 20% hinglish or hi-mixed templates, has ' + mixed + ' of ' + out.length);
  }
  if (expectedSet === 'adversarial') {
    for (const n of synth.NOISE_IDS) {
      if (!out.some((t) => t.noises.has(n))) throw templateError(file, '(file)', 'noise ' + n + ' is not used');
    }
  }
  return out;
}

// Loads a template module from disk without the require cache (so a changed file is always re-read).
function loadModule(abs) {
  const resolved = require.resolve(abs);
  delete require.cache[resolved];
  return require(resolved);
}

// Loads and validates all three files, including cross-file id uniqueness and skeleton disjointness.
// Returns { dev: [...], heldout: [...], adversarial: [...] }.
function loadTemplates(root) {
  const r = root || ROOT;
  const seenIds = new Map();
  const out = {};
  const skeletons = new Map();
  for (const name of SET_NAMES) {
    const file = SETS[name].file;
    let mod;
    try { mod = loadModule(path.join(r, file)); } catch (e) {
      throw templateError(file, '(file)', 'cannot load: ' + e.message);
    }
    out[name] = validateFile(file, mod, name, seenIds);
    for (const t of out[name]) {
      const sk = skeleton(t.text);
      if (skeletons.has(sk) && skeletons.get(sk).file !== file) {
        throw templateError(file, t.id, 'skeleton also used by ' + skeletons.get(sk).id + ' in ' + skeletons.get(sk).file);
      }
      if (!skeletons.has(sk)) skeletons.set(sk, { file, id: t.id });
    }
  }
  return out;
}

function pad4(n) { return String(n).padStart(4, '0'); }

function lowestKey(keys, counts) {
  let best = keys[0];
  for (const k of keys) if (counts[k] < counts[best]) best = k;
  return best;
}

// buildSet(name, { quick, avoid, templates, root, seed }) -> { name, seed, documents, values } (SPEC 9.3).
// templates: the validated list for this set (loaded from root when omitted). seed overrides the set seed (tests).
function buildSet(name, options) {
  const o = options || {};
  const cfg = SETS[name];
  if (!cfg) throw new Error('unknown set ' + name);
  const templates = o.templates || loadTemplates(o.root)[name];
  const seed = o.seed !== undefined ? o.seed : cfg.seed;
  const goldTarget = o.quick ? QUICK.gold : cfg.gold;
  const decoyTarget = o.quick ? QUICK.decoys : cfg.decoys;
  const cap = 20 * 9 * goldTarget;
  const rng = prng.mulberry32(seed);
  const avoid = new Set(o.avoid || []);
  const values = [];
  const positives = templates.filter((t) => t.positive);
  const negatives = templates.filter((t) => !t.positive);
  const withEntity = {};
  for (const e of ENTITIES) withEntity[e] = positives.filter((t) => t.entities.has(e));
  const withDecoy = {};
  for (const d of synth.DECOY_TYPES) withDecoy[d] = templates.filter((t) => t.decoys.has(d));
  const gold = {};
  for (const e of ENTITIES) gold[e] = 0;
  const decoys = {};
  for (const d of synth.DECOY_TYPES) decoys[d] = 0;
  const documents = [];
  let i = 0;

  function render(t) {
    const r = synth.renderTemplate(rng, t.parts, avoid);
    const doc = {
      id: name + '-' + pad4(i), templateId: t.id, domain: t.domain, lang: t.lang, text: r.text,
      gold: r.gold.map((g) => ({ entity: g.entity, start: g.start, end: g.end, format: g.format, noise: g.noise, lang: t.lang })),
      decoys: r.decoys
    };
    for (const g of r.gold) {
      gold[g.entity]++;
      if (g.entity !== 'CARD') values.push(g.value);
    }
    for (const d of r.decoys) decoys[d.type]++;
    documents.push(doc);
    if (documents.length > cap) throw new Error('generator could not reach the targets for ' + name);
  }

  while (ENTITIES.some((e) => gold[e] < goldTarget)) {
    i++;
    if (i % cfg.negEvery === 0) render(prng.pick(rng, negatives));
    else render(prng.pick(rng, withEntity[lowestKey(ENTITIES, gold)]));
  }
  while (synth.DECOY_TYPES.some((d) => decoys[d] < decoyTarget)) {
    i++;
    render(prng.pick(rng, withDecoy[lowestKey(synth.DECOY_TYPES, decoys)]));
  }
  return { name, seed, documents, values };
}

// Builds the requested sets in the order dev, heldout, adversarial; each avoids the earlier sets' values.
// Sets that are not requested are still built when a later requested set needs their values.
function buildAll(options) {
  const o = options || {};
  const wanted = o.sets || SET_NAMES;
  const templates = o.templates || loadTemplates(o.root);
  const out = {};
  const avoid = [];
  let last = -1;
  for (let k = 0; k < SET_NAMES.length; k++) if (wanted.indexOf(SET_NAMES[k]) >= 0) last = k;
  for (let k = 0; k <= last; k++) {
    const name = SET_NAMES[k];
    const seed = o.seeds && o.seeds[name] !== undefined ? o.seeds[name] : undefined;
    const set = buildSet(name, { quick: o.quick, avoid, templates: templates[name], seed });
    for (const v of set.values) avoid.push(v);
    if (wanted.indexOf(name) >= 0) out[name] = set;
  }
  return out;
}

// Writes dist/eval-data/<set>.jsonl (one document per line). Returns the paths written (relative to root).
function writeData(root, sets) {
  const dir = path.join(root, 'dist', 'eval-data');
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const name of Object.keys(sets)) {
    const lines = sets[name].documents.map((d) => JSON.stringify(d)).join('\n') + '\n';
    fs.writeFileSync(path.join(dir, name + '.jsonl'), lines, 'utf8');
    written.push('dist/eval-data/' + name + '.jsonl');
  }
  return written;
}

// Latency inputs (SPEC 9.6): held-out templates round-robin from mulberry32(4004), joined with blank lines
// until at least minChars characters; a fresh generator per size.
function latencyInput(templates, minChars) {
  const rng = prng.mulberry32(LATENCY_SEED);
  const avoid = new Set();
  const docs = [];
  let len = 0;
  let k = 0;
  while (len < minChars) {
    const t = templates[k % templates.length];
    k++;
    const text = synth.renderTemplate(rng, t.parts, avoid).text;
    len += (docs.length ? 2 : 0) + text.length;
    docs.push(text);
  }
  return docs.join('\n\n');
}

module.exports = {
  SET_NAMES, SETS, QUICK, LATENCY_SEED, DOMAINS, LANGS, MIN_COUNTS,
  isUnsupported, skeleton, validateFile, loadTemplates, buildSet, buildAll, writeData, latencyInput, templateError
};
