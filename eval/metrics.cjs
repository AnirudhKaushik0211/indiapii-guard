'use strict';
// Matching and metrics (SPEC 9.5): exact and overlap matching, P/R/F1 with Wilson intervals, leak rate, decoy hits,
// FP/FN categories, confusion, recall by format/noise/language, threshold sweep by re-running detection,
// failure examples with masked excerpts, nearest-rank percentiles.
const lexicon = require('../js/lexicon.js');
const synth = require('../js/synth.js');
const dataset = require('./dataset.cjs');

const ENTITIES = lexicon.ENTITIES;
const Z = 1.959963985;
const SWEEP = [];
for (let k = 30; k <= 90; k += 5) SWEEP.push(k / 100);
const PRESETS = ['lenient', 'balanced', 'strict'];
const MAX_FAILURES = 10;
const EXCERPT_CONTEXT = 30;
const LETTER = /\p{L}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function overlapLen(a, b) { return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)); }
function overlaps(a, b) { return overlapLen(a, b) > 0; }

// Wilson score interval for k successes in n trials, clamped to [0, 1]; null when n is 0.
function wilson(k, n) {
  if (!n) return null;
  const p = k / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function prf(tp, fp, fn) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  let f1 = null;
  if (precision !== null && recall !== null) f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  return { precision, recall, f1 };
}

function row(c) {
  const m = prf(c.tp, c.fp, c.fn);
  return { tp: c.tp, fp: c.fp, fn: c.fn, precision: m.precision, recall: m.recall, f1: m.f1,
    precisionCi: wilson(c.tp, c.tp + c.fp), recallCi: wilson(c.tp, c.tp + c.fn) };
}

function mean(xs) {
  const v = xs.filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// counts: { ENTITY: { tp, fp, fn } } -> { perEntity, micro, macro }.
function summarise(counts) {
  const perEntity = {};
  const total = { tp: 0, fp: 0, fn: 0 };
  for (const e of ENTITIES) {
    const c = counts[e] || { tp: 0, fp: 0, fn: 0 };
    perEntity[e] = row(c);
    total.tp += c.tp; total.fp += c.fp; total.fn += c.fn;
  }
  const macro = {
    precision: mean(ENTITIES.map((e) => perEntity[e].precision)),
    recall: mean(ENTITIES.map((e) => perEntity[e].recall)),
    f1: mean(ENTITIES.map((e) => perEntity[e].f1))
  };
  return { perEntity, micro: row(total), macro };
}

function emptyCounts() {
  const c = {};
  for (const e of ENTITIES) c[e] = { tp: 0, fp: 0, fn: 0 };
  return c;
}

// Exact matching: same entity, start and end; one-to-one. Returns { goldMatch: [predIndex|-1], predMatch: [goldIndex|-1] }.
function matchExact(gold, preds) {
  const goldMatch = gold.map(() => -1);
  const predMatch = preds.map(() => -1);
  for (let p = 0; p < preds.length; p++) {
    for (let g = 0; g < gold.length; g++) {
      if (goldMatch[g] < 0 && gold[g].entity === preds[p].entity && gold[g].start === preds[p].start &&
          gold[g].end === preds[p].end) {
        goldMatch[g] = p; predMatch[p] = g; break;
      }
    }
  }
  return { goldMatch, predMatch };
}

// Greedy one-to-one pairing by overlap length desc, then gold start, then prediction start.
// sameEntity restricts pairs to equal entities (overlap matching); false gives the type-agnostic pairing.
function pairOverlap(gold, preds, sameEntity) {
  const pairs = [];
  for (let g = 0; g < gold.length; g++) {
    for (let p = 0; p < preds.length; p++) {
      if (sameEntity && gold[g].entity !== preds[p].entity) continue;
      const len = overlapLen(gold[g], preds[p]);
      if (len > 0) pairs.push({ g, p, len });
    }
  }
  pairs.sort((a, b) => (b.len - a.len) || (gold[a.g].start - gold[b.g].start) || (preds[a.p].start - preds[b.p].start));
  const goldMatch = gold.map(() => -1);
  const predMatch = preds.map(() => -1);
  for (const x of pairs) {
    if (goldMatch[x.g] >= 0 || predMatch[x.p] >= 0) continue;
    goldMatch[x.g] = x.p; predMatch[x.p] = x.g;
  }
  return { goldMatch, predMatch };
}

function countMatches(docs, predsList, matcher) {
  const counts = emptyCounts();
  for (let d = 0; d < docs.length; d++) {
    const gold = docs[d].gold;
    const preds = predsList[d];
    const m = matcher(gold, preds);
    for (let g = 0; g < gold.length; g++) {
      if (m.goldMatch[g] >= 0) counts[gold[g].entity].tp++; else counts[gold[g].entity].fn++;
    }
    for (let p = 0; p < preds.length; p++) if (m.predMatch[p] < 0) counts[preds[p].entity].fp++;
  }
  return counts;
}

function exactScores(docs, predsList) { return summarise(countMatches(docs, predsList, matchExact)); }
function overlapScores(docs, predsList) {
  return summarise(countMatches(docs, predsList, (g, p) => pairOverlap(g, p, true)));
}

function leak(docs, predsList) {
  let counted = 0;
  let leaked = 0;
  for (let d = 0; d < docs.length; d++) {
    const text = docs[d].text;
    for (const g of docs[d].gold) {
      for (let i = g.start; i < g.end; i++) {
        if (!LETTER_OR_DIGIT.test(text.charAt(i))) continue;
        counted++;
        if (!predsList[d].some((p) => p.start <= i && i < p.end)) leaked++;
      }
    }
  }
  return { counted, leaked, rate: counted ? leaked / counted : null };
}

function decoyHits(docs, predsList) {
  const byType = {};
  for (const t of synth.DECOY_TYPES) byType[t] = { total: 0, hit: 0, rate: null };
  const all = { total: 0, hit: 0, rate: null };
  for (let d = 0; d < docs.length; d++) {
    for (const dec of docs[d].decoys) {
      const hit = predsList[d].some((p) => overlaps(p, dec));
      byType[dec.type].total++; all.total++;
      if (hit) { byType[dec.type].hit++; all.hit++; }
    }
  }
  for (const t of synth.DECOY_TYPES) byType[t].rate = byType[t].total ? byType[t].hit / byType[t].total : null;
  all.rate = all.total ? all.hit / all.total : null;
  return { all, byType };
}

function fpCategory(doc, pred) {
  if (doc.decoys.some((x) => overlaps(x, pred))) return { category: 'decoy', gold: null };
  const same = doc.gold.find((g) => g.entity === pred.entity && overlaps(g, pred));
  if (same) return { category: 'boundary', gold: same };
  const other = doc.gold.find((g) => g.entity !== pred.entity && overlaps(g, pred));
  if (other) return { category: 'type', gold: other };
  return { category: 'spurious', gold: null };
}

function fnCategory(gold, preds) {
  const same = preds.find((p) => p.entity === gold.entity && overlaps(p, gold));
  if (same) return { category: 'boundary', pred: same };
  const other = preds.find((p) => p.entity !== gold.entity && overlaps(p, gold));
  if (other) return { category: 'type', pred: other };
  return { category: 'missed', pred: null };
}

function isUpper(ch) { return ch !== ch.toLowerCase() && ch === ch.toUpperCase(); }

// Masked excerpt (SPEC 9.5): 30 characters either side, newlines as U+23CE; (a) digits -> '#', (c) address local
// parts -> 'x' (and decoy domains), (b) other letters inside spans -> 'A' / 'a'.
function maskExcerpt(doc, predictions, start, end) {
  const text = doc.text;
  const from = Math.max(0, start - EXCERPT_CONTEXT);
  const to = Math.min(text.length, end + EXCERPT_CONTEXT);
  const spans = [];
  for (const g of doc.gold) spans.push({ start: g.start, end: g.end, address: g.entity === 'EMAIL' || g.entity === 'UPI', decoy: false });
  for (const p of predictions || []) spans.push({ start: p.start, end: p.end, address: p.entity === 'EMAIL' || p.entity === 'UPI', decoy: false });
  for (const x of doc.decoys || []) spans.push({ start: x.start, end: x.end, address: false, decoy: true });
  for (const s of spans) {
    const at = text.slice(s.start, s.end).indexOf('@');
    s.at = at < 0 ? -1 : s.start + at;
  }
  let out = '';
  for (let i = from; i < to; i++) {
    const ch = text.charAt(i);
    if (ch >= '0' && ch <= '9') { out += '#'; continue; }
    if (ch === '\n') { out += '\u23CE'; continue; }
    if (!LETTER.test(ch)) { out += ch; continue; }
    const inside = spans.filter((s) => s.start <= i && i < s.end);
    if (inside.length === 0) { out += ch; continue; }
    const withAt = inside.filter((s) => s.at >= 0);
    if (withAt.length) {
      const toX = withAt.some((s) => i < s.at || (i > s.at && !s.address));
      if (toX) { out += 'x'; continue; }
      const keep = withAt.some((s) => i > s.at && s.address);
      if (keep) { out += ch; continue; }
    }
    out += isUpper(ch) ? 'A' : 'a';
  }
  return out;
}

function recallTable(items) {
  const out = {};
  for (const k of Object.keys(items)) {
    const x = items[k];
    out[k] = { support: x.support, tp: x.tp, recall: x.support ? x.tp / x.support : null };
  }
  return out;
}

function confusion(docs, predsList) {
  const rows = ENTITIES.concat(['NONE']);
  const cols = ENTITIES.concat(['MISSED']);
  const counts = rows.map(() => cols.map(() => 0));
  for (let d = 0; d < docs.length; d++) {
    const gold = docs[d].gold;
    const preds = predsList[d];
    const m = pairOverlap(gold, preds, false);
    for (let g = 0; g < gold.length; g++) {
      const r = rows.indexOf(gold[g].entity);
      const c = m.goldMatch[g] >= 0 ? cols.indexOf(preds[m.goldMatch[g]].entity) : cols.length - 1;
      counts[r][c]++;
    }
    for (let p = 0; p < preds.length; p++) {
      if (m.predMatch[p] < 0) counts[rows.length - 1][cols.indexOf(preds[p].entity)]++;
    }
  }
  return { rows, cols, counts };
}

function detectAll(docs, detect, options) { return docs.map((d) => detect(d.text, options).findings); }

// Full metrics for one built set. detect(text, options) -> { findings } (guard.detect).
function evaluateSet(set, detect) {
  const docs = set.documents;
  const predsList = detectAll(docs, detect, undefined);
  const support = {};
  for (const e of ENTITIES) support[e] = 0;
  const decoys = {};
  for (const t of synth.DECOY_TYPES) decoys[t] = 0;
  let goldTotal = 0;
  let unsupported = 0;
  let characters = 0;
  let negativeDocuments = 0;
  for (const d of docs) {
    characters += d.text.length;
    if (d.gold.length === 0) negativeDocuments++;
    for (const g of d.gold) { support[g.entity]++; goldTotal++; if (dataset.isUnsupported(g)) unsupported++; }
    for (const x of d.decoys) decoys[x.type]++;
  }

  const fpCategories = { decoy: 0, boundary: 0, type: 0, spurious: 0 };
  const fnCategories = { boundary: 0, type: 0, missed: 0 };
  const byFormatRaw = {};
  const byNoiseRaw = {};
  const byLangRaw = {};
  const fnList = {};
  const fpList = {};
  for (const e of ENTITIES) { fnList[e] = []; fpList[e] = []; }

  function bump(table, key) {
    if (!table[key]) table[key] = { support: 0, tp: 0 };
    return table[key];
  }

  for (let di = 0; di < docs.length; di++) {
    const doc = docs[di];
    const preds = predsList[di];
    const m = matchExact(doc.gold, preds);
    for (let g = 0; g < doc.gold.length; g++) {
      const gold = doc.gold[g];
      const hit = m.goldMatch[g] >= 0;
      if (!byFormatRaw[gold.entity]) byFormatRaw[gold.entity] = {};
      const cells = [bump(byFormatRaw[gold.entity], gold.format), bump(byNoiseRaw, gold.noise || 'none'),
        bump(byLangRaw, gold.lang)];
      for (const c of cells) { c.support++; if (hit) c.tp++; }
      if (hit) continue;
      const cat = fnCategory(gold, preds);
      fnCategories[cat.category]++;
      if (fnList[gold.entity].length < MAX_FAILURES) {
        fnList[gold.entity].push({ kind: 'FN', entity: gold.entity,
          otherEntity: cat.category === 'type' ? cat.pred.entity : null, category: cat.category, docId: doc.id,
          templateId: doc.templateId, format: gold.format, noise: gold.noise, reasons: cat.pred ? cat.pred.reasons : null,
          excerpt: maskExcerpt(doc, preds, gold.start, gold.end) });
      }
    }
    for (let p = 0; p < preds.length; p++) {
      if (m.predMatch[p] >= 0) continue;
      const pred = preds[p];
      const cat = fpCategory(doc, pred);
      fpCategories[cat.category]++;
      if (fpList[pred.entity].length < MAX_FAILURES) {
        fpList[pred.entity].push({ kind: 'FP', entity: pred.entity,
          otherEntity: cat.category === 'type' ? cat.gold.entity : null, category: cat.category, docId: doc.id,
          templateId: doc.templateId, format: cat.gold ? cat.gold.format : null, noise: cat.gold ? cat.gold.noise : null,
          reasons: pred.reasons, excerpt: maskExcerpt(doc, preds, pred.start, pred.end) });
      }
    }
  }

  const byFormat = {};
  for (const e of ENTITIES) {
    if (!byFormatRaw[e]) continue;
    const sorted = {};
    for (const f of Object.keys(byFormatRaw[e]).sort()) sorted[f] = byFormatRaw[e][f];
    byFormat[e] = recallTable(sorted);
  }
  const noiseOrder = ['none'].concat(synth.NOISE_IDS);
  const byNoiseSorted = {};
  for (const n of noiseOrder) if (byNoiseRaw[n]) byNoiseSorted[n] = byNoiseRaw[n];
  const byLangSorted = {};
  for (const l of dataset.LANGS) if (byLangRaw[l]) byLangSorted[l] = byLangRaw[l];

  const sweep = SWEEP.map((t) => {
    const s = exactScores(docs, detectAll(docs, detect, { threshold: t }));
    return { threshold: t, precision: s.micro.precision, recall: s.micro.recall, f1: s.micro.f1 };
  });
  const presets = {};
  for (const name of PRESETS) {
    const s = exactScores(docs, detectAll(docs, detect, { threshold: name }));
    presets[name] = {};
    for (const e of ENTITIES) presets[name][e] = { precision: s.perEntity[e].precision, recall: s.perEntity[e].recall };
  }

  const failures = [];
  for (const e of ENTITIES) for (const f of fnList[e].concat(fpList[e])) failures.push(f);

  return {
    documents: docs.length,
    negativeDocuments,
    characters,
    support,
    decoys,
    unsupportedShare: goldTotal ? unsupported / goldTotal : 0,
    exact: exactScores(docs, predsList),
    overlap: overlapScores(docs, predsList),
    leak: leak(docs, predsList),
    decoyHits: decoyHits(docs, predsList),
    fpCategories,
    fnCategories,
    byFormat,
    byNoise: recallTable(byNoiseSorted),
    byLanguage: recallTable(byLangSorted),
    confusion: confusion(docs, predsList),
    sweep,
    presets,
    failures
  };
}

// Nearest-rank percentile on an ascending array: index ceil(q * n) - 1.
function percentile(sorted, q) {
  if (!sorted.length) return null;
  const idx = Math.max(0, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.min(idx, sorted.length - 1)];
}

module.exports = {
  Z, SWEEP, PRESETS, wilson, prf, summarise, matchExact, pairOverlap, exactScores, overlapScores, leak, decoyHits,
  fpCategory, fnCategory, maskExcerpt, confusion, evaluateSet, percentile
};
