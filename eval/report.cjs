'use strict';
// Hash helpers, HISTORY parsing, gate assembly, EVAL-REPORT and README block rendering (SPEC 9.7, 9.8, 9.9).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lexicon = require('../js/lexicon.js');
const synth = require('../js/synth.js');
const gateMod = require('./gate.cjs');

const ENTITIES = lexicon.ENTITIES;
const DETECTOR_FILES = ['js/validators.js', 'js/lexicon.js', 'js/detector.js', 'js/redactor.js', 'js/guard.js'];
const SYNTHETIC_STATEMENT = 'All identifiers in samples, tests and evaluation data are randomly generated with valid ' +
  'structure and check digits. They are not linked to any person; any match with a real number would be coincidental. ' +
  'Card numbers are publicly documented test numbers. E-mail addresses use reserved example domains.';
const STALE_BROWSER = 'Browser latency was measured on a different detector build; re-run `npm run bench:browser`.';
const UNSEEN_SENTENCE = 'If any detector change after held-out run 1 cites an adversarial document (see Development ' +
  'history), the adversarial results are no longer unseen data.';
const README_INTRO = 'Measured on the synthetic held-out set (exact span match, Balanced threshold). See ' +
  'docs/EVAL-REPORT.md for method, failures and limitations.';
const SET_TITLES = { dev: 'Development', heldout: 'Held-out', adversarial: 'Adversarial' };

// Decode as UTF-8, strip one leading BOM, CRLF -> LF, encode as UTF-8.
function normaliseForHash(buffer) {
  let s = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return Buffer.from(s.replace(/\r\n/g, '\n'), 'utf8');
}

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function fileHash(p) { return sha256Hex(normaliseForHash(fs.readFileSync(p))); }

function detectorHash(root) {
  const bufs = DETECTOR_FILES.map((f) => normaliseForHash(fs.readFileSync(path.join(root, f))));
  return sha256Hex(Buffer.concat(bufs));
}

// ---- HISTORY.md ----

function frozenHashes(history) {
  const h = /^- Frozen held-out templates SHA-256: ([0-9a-f]{64})\s*$/m.exec(history || '');
  const a = /^- Frozen adversarial templates SHA-256: ([0-9a-f]{64})\s*$/m.exec(history || '');
  return { heldout: h ? h[1] : null, adversarial: a ? a[1] : null };
}

function historyEntries(history) {
  return (history || '').split(/^(?=## )/m).filter((s) => s.indexOf('## ') === 0);
}

function heldoutRunCount(history) {
  return historyEntries(history).filter((e) => /^## \d{4}-\d{2}-\d{2} - held-out run \d+/.test(e)).length;
}

// Detector changes after held-out run 1 whose justification names an adversarial document id. A Reason line
// that lists numbered changes "(1) ... (2) ..." counts each numbered change separately; otherwise the entry
// counts as one change.
function adversarialChangeCount(history) {
  let afterRun1 = false;
  let n = 0;
  for (const e of historyEntries(history)) {
    const run = /^## \d{4}-\d{2}-\d{2} - held-out run (\d+)/.exec(e);
    if (afterRun1) {
      const reason = /^- Reason:(.*)$/m.exec(e);
      if (reason) {
        const parts = reason[1].split(/\(\d+\)/);
        const numbered = parts.length > 1 ? parts.slice(1) : parts;
        n += numbered.filter((p) => /\badversarial-\d+/.test(p)).length;
      }
    }
    if (run && Number(run[1]) >= 1) afterRun1 = true;
  }
  return n;
}

// ---- gate ----

function latencyP95(sizes, label) {
  if (!Array.isArray(sizes)) return undefined;
  const s = sizes.find((x) => x && x.label === label);
  return s && typeof s.p95 === 'number' ? s.p95 : undefined;
}

// Assembles the 27 gate rows. metrics: rounded metrics object; latencyNode: parsed latency-node.json or null;
// browser: { data, stale } or null. Returns { rows: [{ ...row, value, status }], overall, met, total }.
function gateResult(metrics, latencyNode, browser) {
  const acc = {};
  for (const g of metrics.gateAccuracy || []) acc[g.id] = g;
  const rows = gateMod.ROWS.map((r) => {
    let value;
    if (gateMod.isLatency(r)) {
      if (r.set === 'node-1KB') value = latencyNode ? latencyP95(latencyNode.sizes, '1KB') : undefined;
      else if (r.set === 'node-10KB') value = latencyNode ? latencyP95(latencyNode.sizes, '10KB') : undefined;
      else {
        const name = r.set.split('-')[0];
        if (browser && browser.data && !browser.stale && Array.isArray(browser.data.browsers)) {
          const b = browser.data.browsers.find((x) => x && x.name === name && !x.error);
          value = b ? latencyP95(b.sizes, '10KB') : undefined;
        }
      }
    } else {
      // A set that was not built (partial run) is not measured; a built set's null value fails.
      value = metrics.sets[r.set] && acc[r.id] ? acc[r.id].value : undefined;
    }
    const ev = gateMod.evaluateRow(r, value);
    return Object.assign({}, r, { value: value === undefined ? null : value, status: ev.status });
  });
  const statuses = rows.map((r) => r.status);
  return { rows, overall: gateMod.overall(statuses), met: statuses.filter((s) => s === 'PASS').length, total: rows.length };
}

// gateAccuracy rows for metrics.json (SPEC 9.7): accuracy criteria only; latency is machine data.
function gateAccuracy(sets) {
  return gateMod.ROWS.filter((r) => !gateMod.isLatency(r)).map((r) => {
    const s = sets[r.set];
    let value;
    if (s) {
      if (r.metric === 'decoy_hit_rate') value = s.decoyHits.all.rate;
      else {
        const cell = r.entity === 'ALL' ? s.exact.micro : s.exact.perEntity[r.entity];
        value = cell[r.metric];
      }
    }
    const ev = gateMod.evaluateRow(r, value);
    return { id: r.id, set: r.set, metric: r.metric, entity: r.entity, op: r.op, threshold: r.threshold,
      value: value === undefined ? null : value, pass: ev.pass };
  });
}

// ---- formatting ----

function pct(x) { return x === null || x === undefined ? 'n/a' : (x * 100).toFixed(1) + '%'; }
function ci(c) { return c ? '[' + pct(c[0]) + ', ' + pct(c[1]) + ']' : 'n/a'; }
function num(x, d) { return x === null || x === undefined ? 'n/a' : x.toFixed(d); }
function ms(x) { return typeof x === 'number' ? x.toFixed(3) : 'n/a'; }

function table(header, rows) {
  const out = ['| ' + header.join(' | ') + ' |', '|' + header.map(() => '---').join('|') + '|'];
  for (const r of rows) out.push('| ' + r.join(' | ') + ' |');
  return out.join('\n');
}

function scoreTable(scores, support) {
  const rows = ENTITIES.map((e) => {
    const c = scores.perEntity[e];
    return [e, pct(c.precision), ci(c.precisionCi), pct(c.recall), ci(c.recallCi), pct(c.f1),
      String(support ? support[e] : c.tp + c.fn)];
  });
  const m = scores.micro;
  rows.push(['Micro', pct(m.precision), ci(m.precisionCi), pct(m.recall), ci(m.recallCi), pct(m.f1), String(m.tp + m.fn)]);
  rows.push(['Macro', pct(scores.macro.precision), '', pct(scores.macro.recall), '', pct(scores.macro.f1), '']);
  return table(['Entity', 'Precision', '95% CI', 'Recall', '95% CI', 'F1', 'Support'], rows);
}

function gateValue(r) {
  if (r.value === null) return r.status === 'NOT MEASURED' ? '-' : 'null';
  return gateMod.isLatency(r) ? ms(r.value) + ' ms' : num(r.value, 4);
}

function noiseSupport(id) {
  if (id === 'none') return 'yes';
  if (id === 'ocr3' || id === 'obfuscated-email' || id === 'spaced-upi') return 'no (expected miss)';
  if (id === 'lower') return 'PAN and IFSC yes; GSTIN no (expected miss)';
  if (id === 'irregular') return 'phone yes; Aadhaar no (expected miss)';
  return 'yes';
}

function recallRows(tableObj, labelFn) {
  return Object.keys(tableObj).map((k) => {
    const c = tableObj[k];
    return [labelFn ? labelFn(k) : k, String(c.support), String(c.tp), pct(c.recall)];
  });
}

// ---- README block ----

function renderReadmeBlock(metrics, gate) {
  const h = metrics.sets.heldout;
  const lines = [README_INTRO, ''];
  if (!h) {
    lines.push('Held-out results not measured in this run.');
  } else {
    const rows = ENTITIES.map((e) => {
      const c = h.exact.perEntity[e];
      return [e, pct(c.precision), pct(c.recall), pct(c.f1), String(h.support[e])];
    });
    const m = h.exact.micro;
    rows.push(['Micro average', pct(m.precision), pct(m.recall), pct(m.f1), String(m.tp + m.fn)]);
    lines.push(table(['Entity', 'Precision', 'Recall', 'F1', 'Support'], rows));
  }
  lines.push('');
  lines.push('Release gate: ' + gate.overall + ' (' + gate.met + ' of ' + gate.total + ' criteria met).');
  return lines.join('\n');
}

// Replaces the text between the markers; returns null if the markers are missing.
function replaceReadmeBlock(readme, block) {
  const start = '<!-- eval:start -->';
  const end = '<!-- eval:end -->';
  const a = readme.indexOf(start);
  const b = readme.indexOf(end);
  if (a < 0 || b < a) return null;
  const nl = readme.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  return readme.slice(0, a + start.length) + nl + block.split('\n').join(nl) + nl + readme.slice(b);
}

// ---- EVAL-REPORT ----

// ctx: { metrics, gate, latencyNode, browser: { data, stale, malformed } | null, history, templateHashes, version }
function renderReport(ctx) {
  const m = ctx.metrics;
  const out = [];
  const sets = Object.keys(m.sets);
  const push = (s) => out.push(s);

  push('# IndiaPII Guard evaluation report');
  push('');
  push('Version ' + ctx.version + '. Generated by `npm run eval`. Do not edit by hand.');
  push('');
  push(SYNTHETIC_STATEMENT);
  push('');

  push('## How to read this');
  push('');
  push('All numbers come from synthetic, self-constructed data. Labels come from the generator, so the evaluation ' +
    'measures agreement with the generator\'s conventions and cannot reveal formats the generator never produces. ' +
    'The templates were written by the same author as the detection rules. The held-out and adversarial templates ' +
    'were frozen before the first held-out run (see Development history). The numbers are not an estimate of ' +
    'accuracy on your data. Confidence intervals (Wilson, 95%) reflect sample size only. Card numbers come from a ' +
    'short public test list shared by all sets, so the held-out set tests card formats and contexts, not unseen ' +
    'card values. ' + UNSEEN_SENTENCE);
  const advChanges = adversarialChangeCount(ctx.history);
  if (advChanges > 0) {
    push('');
    push('This applies to this report: ' + advChanges + ' detector change(s) after held-out run 1 cite adversarial documents.');
  }
  push('');

  push('## Release gate');
  push('');
  push(table(['Id', 'Set', 'Metric', 'Entity', 'Op', 'Threshold', 'Measured', 'Result'], ctx.gate.rows.map((r) =>
    [r.id, r.set, r.metric, r.entity, r.op, r.threshold < 1 ? r.threshold.toFixed(2) : String(r.threshold), gateValue(r),
      r.status])));
  push('');
  push('Overall: ' + ctx.gate.overall + ' (' + ctx.gate.met + ' of ' + ctx.gate.total + ' criteria met).');
  const failing = ctx.gate.rows.filter((r) => r.status === 'FAIL').map((r) => r.id);
  if (failing.length) push('Failing criteria: ' + failing.join(', ') + '.');
  const notMeasured = ctx.gate.rows.filter((r) => r.status === 'NOT MEASURED').map((r) => r.id);
  if (notMeasured.length) push('Not measured: ' + notMeasured.join(', ') + '.');
  // Owner decision: publishing is held until every criterion passes; the gate is never changed to fit a result.
  if (ctx.gate.overall !== 'PASS') {
    push('');
    push('Release status: **HELD \u2014 gate ' + ctx.gate.overall + ' (' + ctx.gate.met + ' of ' + ctx.gate.total +
      ')**. Version ' + ctx.version + ' is not published until every criterion passes.');
  }
  push('');

  push('## Held-out results');
  push('');
  if (m.sets.heldout) {
    push('Exact span match, default options (threshold 0.50, OCR normalisation on, all entities).');
    push('');
    push(scoreTable(m.sets.heldout.exact, m.sets.heldout.support));
  } else push('Not measured in this run.');
  push('');

  push('## Development and adversarial results');
  push('');
  for (const s of ['dev', 'adversarial']) {
    push('### ' + SET_TITLES[s]);
    push('');
    push(m.sets[s] ? scoreTable(m.sets[s].exact, m.sets[s].support) : 'Not measured in this run.');
    push('');
  }

  push('## Overlap matching');
  push('');
  push('A prediction counts if it shares at least one character with a gold span of the same entity (one-to-one).');
  push('');
  for (const s of sets) {
    push('### ' + SET_TITLES[s]);
    push('');
    push(scoreTable(m.sets[s].overlap, m.sets[s].support));
    push('');
  }

  push('## Leakage and decoys');
  push('');
  push(table(['Set', 'Characters counted', 'Leaked', 'Leak rate', 'Decoys', 'Decoys hit', 'Decoy hit rate'], sets.map((s) => {
    const x = m.sets[s];
    return [SET_TITLES[s], String(x.leak.counted), String(x.leak.leaked), pct(x.leak.rate), String(x.decoyHits.all.total),
      String(x.decoyHits.all.hit), pct(x.decoyHits.all.rate)];
  })));
  push('');
  push('Decoy hit rate by type:');
  push('');
  push(table(['Type'].concat(sets.map((s) => SET_TITLES[s])), synth.DECOY_TYPES.map((t) => [t].concat(sets.map((s) => {
    const c = m.sets[s].decoyHits.byType[t];
    return c.total ? c.hit + '/' + c.total + ' (' + pct(c.rate) + ')' : '-';
  })))));
  push('');

  push('## Where it fails');
  push('');
  push(table(['Set', 'FP decoy', 'FP boundary', 'FP type', 'FP spurious', 'FN boundary', 'FN type', 'FN missed'], sets.map((s) => {
    const f = m.sets[s].fpCategories;
    const n = m.sets[s].fnCategories;
    return [SET_TITLES[s], f.decoy, f.boundary, f.type, f.spurious, n.boundary, n.type, n.missed].map(String);
  })));
  push('');
  for (const s of sets) {
    const x = m.sets[s];
    push('### ' + SET_TITLES[s] + ': recall by format');
    push('');
    const rows = [];
    for (const e of Object.keys(x.byFormat)) {
      for (const f of Object.keys(x.byFormat[e])) {
        const c = x.byFormat[e][f];
        rows.push([e, f, String(c.support), String(c.tp), pct(c.recall)]);
      }
    }
    push(table(['Entity', 'Format', 'Support', 'Found', 'Recall'], rows));
    push('');
    push('### ' + SET_TITLES[s] + ': recall by noise and language');
    push('');
    push(table(['Noise', 'Supported by v1', 'Support', 'Found', 'Recall'], Object.keys(x.byNoise).map((k) => {
      const c = x.byNoise[k];
      return [k, noiseSupport(k), String(c.support), String(c.tp), pct(c.recall)];
    })));
    push('');
    push(table(['Language', 'Support', 'Found', 'Recall'], recallRows(x.byLanguage)));
    push('');
  }
  for (const s of ['heldout', 'adversarial']) {
    if (!m.sets[s]) continue;
    const c = m.sets[s].confusion;
    push('### ' + SET_TITLES[s] + ': confusion (rows gold, columns predicted)');
    push('');
    push(table(['Gold \\ Predicted'].concat(c.cols), c.rows.map((r, i) => [r].concat(c.counts[i].map(String)))));
    push('');
  }

  push('## Threshold trade-off');
  push('');
  push('Each threshold is a separate detection run (the threshold applies before overlap resolution), not a filter on another run.');
  push('');
  for (const s of sets) {
    push('### ' + SET_TITLES[s]);
    push('');
    push(table(['Threshold', 'Precision', 'Recall', 'F1'], m.sets[s].sweep.map((r) =>
      [r.threshold.toFixed(2), pct(r.precision), pct(r.recall), pct(r.f1)])));
    push('');
    const p = m.sets[s].presets;
    push(table(['Entity', 'Lenient P', 'Lenient R', 'Balanced P', 'Balanced R', 'Strict P', 'Strict R'], ENTITIES.map((e) =>
      [e, pct(p.lenient[e].precision), pct(p.lenient[e].recall), pct(p.balanced[e].precision), pct(p.balanced[e].recall),
        pct(p.strict[e].precision), pct(p.strict[e].recall)])));
    push('');
  }

  push('## Failure examples');
  push('');
  push('The first 10 false negatives and 10 false positives per set and entity, in document order. Excerpts are ' +
    'masked: digits become #, address local parts become x, other letters inside labelled or predicted spans become A or a.');
  push('');
  for (const s of sets) {
    push('### ' + SET_TITLES[s]);
    push('');
    const fs2 = m.sets[s].failures;
    if (!fs2.length) { push('No failures.'); push(''); continue; }
    for (const e of ENTITIES) {
      const list = fs2.filter((f) => f.entity === e);
      if (!list.length) continue;
      push('#### ' + e);
      push('');
      for (const f of list) {
        const bits = [f.kind, f.category + (f.otherEntity ? ' (' + f.otherEntity + ')' : ''), f.docId, f.templateId];
        if (f.format) bits.push('format ' + f.format);
        if (f.noise) bits.push('noise ' + f.noise);
        if (f.reasons) bits.push('reasons ' + f.reasons.join(', '));
        push('- ' + bits.join('; ') + ': `' + f.excerpt.replace(/`/g, '\'') + '`');
      }
      push('');
    }
  }

  push('## Latency');
  push('');
  const ln = ctx.latencyNode;
  if (ln && Array.isArray(ln.sizes)) {
    push('Node ' + ln.node + ' on ' + ln.platform + ' (' + ln.cpu + '), measured on ' + ln.measuredOn + '. `guard.redact` with default options.');
    push('');
    push(table(['Input', 'Characters', 'Warm-up', 'Runs', 'Findings', 'p50 ms', 'p95 ms', 'max ms'], ln.sizes.map((x) =>
      [x.label, String(x.chars), String(x.warmup), String(x.runs), String(x.findings), ms(x.p50), ms(x.p95), ms(x.max)])));
  } else push('Node latency not measured.');
  push('');
  const br = ctx.browser;
  if (br && br.data && !br.malformed) {
    if (br.stale) { push(STALE_BROWSER); push(''); }
    push('Browser latency measured on ' + br.data.measuredOn + ' (version ' + br.data.version + ', detectorHash ' +
      br.data.detectorHash + ').');
    push('');
    const rows = [];
    for (const b of br.data.browsers || []) {
      if (b.error) { rows.push([b.name, '-', '-', '-', '-', '-', 'error: ' + b.error]); continue; }
      for (const x of b.sizes || []) rows.push([b.name + ' ' + (b.version || ''), x.label, String(x.chars), String(x.runs), ms(x.p50), ms(x.p95), ms(x.max)]);
    }
    push(table(['Browser', 'Input', 'Characters', 'Runs', 'p50 ms', 'p95 ms', 'max ms'], rows));
  } else push('Browser latency not measured.');
  push('');

  push('## Method');
  push('');
  const cfg = m.config;
  push('- Seeds: dev ' + cfg.seeds.dev + ', held-out ' + cfg.seeds.heldout + ', adversarial ' + cfg.seeds.adversarial +
    ', latency inputs ' + cfg.seeds.latency + ' (mulberry32). Quick build: ' + cfg.quick + '.');
  for (const s of sets) {
    const x = m.sets[s];
    const t = m.templates[s];
    push('- ' + SET_TITLES[s] + ': ' + x.documents + ' documents (' + x.negativeDocuments + ' negative), ' + x.characters +
      ' characters, ' + Object.keys(x.support).reduce((a, k) => a + x.support[k], 0) + ' gold spans, gold target ' +
      cfg.targets[s].gold + ' per entity, decoy target ' + cfg.targets[s].decoys + ' per type; templates `' + t.file +
      '` (' + t.positive + ' positive, ' + t.negative + ' negative), SHA-256 ' + t.sha256 + '. Unsupported share ' +
      pct(x.unsupportedShare) + '.');
  }
  push('- Exact match (primary, used by the gate): same entity, start and end. Overlap match (secondary): same entity, ' +
    'at least one shared character, one-to-one greedy pairing by overlap length.');
  push('- Precision = tp / (tp + fp), recall = tp / (tp + fn), F1 = 2PR / (P + R); null when undefined. Micro sums ' +
    'over all nine entities; macro is the mean of the non-null per-entity values. Wilson 95% intervals (z = 1.959963985).');
  push('- Leak rate: letters and digits inside gold spans not covered by any prediction. Decoy hit: any prediction ' +
    'overlapping a decoy.');
  push('- Reproduce: `npm run eval` (all sets, writes the results); `npm run eval -- --write-data` also writes the ' +
    'datasets to `dist/eval-data/` for inspection; `node scripts/eval.cjs --check-repro` checks determinism.');
  push('');

  push('## Development history');
  push('');
  const runs = heldoutRunCount(ctx.history);
  push('Held-out runs recorded: ' + runs + ' (at most 3 before release v1.0.0).');
  push('');
  const frozen = frozenHashes(ctx.history);
  const changed = [];
  if (frozen.heldout && ctx.templateHashes.heldout && frozen.heldout !== ctx.templateHashes.heldout) changed.push('held-out');
  if (frozen.adversarial && ctx.templateHashes.adversarial && frozen.adversarial !== ctx.templateHashes.adversarial) changed.push('adversarial');
  if (changed.length) {
    push('The ' + changed.join(' and ') + ' templates changed after they were frozen; see the history below.');
    push('');
  }
  // HISTORY headings are demoted by two levels so its entries sit under this section.
  push(ctx.history ? ctx.history.replace(/\r\n/g, '\n').replace(/\n+$/, '').replace(/^(#{1,4}) /gm, '$1## ') :
    '(no history file)');
  push('');
  return out.join('\n');
}

module.exports = {
  DETECTOR_FILES, SYNTHETIC_STATEMENT, STALE_BROWSER, normaliseForHash, fileHash, detectorHash, sha256Hex,
  frozenHashes, heldoutRunCount, adversarialChangeCount, gateResult, gateAccuracy, renderReadmeBlock,
  replaceReadmeBlock, renderReport
};
