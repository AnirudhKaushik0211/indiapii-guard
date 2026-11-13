'use strict';
// Evaluation runner (SPEC 9.11). Module: runEval(options). CLI only when run directly.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const guard = require('../js/guard.js');
const dataset = require('../eval/dataset.cjs');
const metricsMod = require('../eval/metrics.cjs');
const report = require('../eval/report.cjs');

const ROOT = path.join(__dirname, '..');
const SET_NAMES = dataset.SET_NAMES;
const LATENCY_SIZES = [
  { label: '1KB', minChars: 1024, warmup: 50, runs: 500 },
  { label: '10KB', minChars: 10240, warmup: 50, runs: 200 }
];

const USAGE = 'Usage: node scripts/eval.cjs [--sets dev,heldout,adversarial] [--quick] [--no-latency] [--no-readme]\n' +
  '                      [--write-data] [--check-repro] [--strict-gate]\n' +
  '\n' +
  'Default (npm run eval): all sets, Node latency; writes eval/results/metrics.json, eval/results/latency-node.json,\n' +
  'docs/EVAL-REPORT.md and the README block. Partial (--sets), --quick and --check-repro runs write nothing.\n' +
  'Exit codes: 0 success, 1 runtime or template error, 2 invalid arguments, 4 gate not PASS with --strict-gate.\n';

class ArgError extends Error {}

const FLAGS = { '--quick': 'quick', '--no-latency': 'noLatency', '--no-readme': 'noReadme', '--write-data': 'writeData',
  '--check-repro': 'checkRepro', '--strict-gate': 'strictGate' };

function parseArgs(argv) {
  if (argv.indexOf('--help') >= 0 || argv.indexOf('-h') >= 0) return { help: true };
  const out = { sets: SET_NAMES.slice(), quick: false, noLatency: false, noReadme: false, writeData: false,
    checkRepro: false, strictGate: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let val;
    const eq = a.indexOf('=');
    if (a.indexOf('--') === 0 && eq > 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
    if (seen.has(a)) throw new ArgError(a + ' given twice');
    seen.add(a);
    if (a === '--sets') {
      if (val === undefined) {
        val = argv[i + 1];
        if (val === undefined || val.indexOf('--') === 0) throw new ArgError('--sets needs a value');
        i++;
      }
      const list = val.split(',');
      for (const s of list) if (SET_NAMES.indexOf(s) < 0) throw new ArgError('unknown set: ' + s);
      if (new Set(list).size !== list.length) throw new ArgError('--sets lists a set twice');
      out.sets = list;
    } else if (FLAGS[a] && val === undefined) {
      out[FLAGS[a]] = true;
    } else {
      throw new ArgError('unknown option: ' + argv[i]);
    }
  }
  return out;
}

function roundDeep(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6;
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = roundDeep(v[k]);
    return o;
  }
  return v;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function localDate() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

// Node latency (SPEC 9.6): guard.redact with defaults, timed with process.hrtime.bigint, nearest-rank percentiles.
function measureNodeLatency(heldoutTemplates) {
  const sizes = LATENCY_SIZES.map((s) => {
    const text = dataset.latencyInput(heldoutTemplates, s.minChars);
    for (let i = 0; i < s.warmup; i++) guard.redact(text);
    const durations = [];
    let findings = 0;
    for (let i = 0; i < s.runs; i++) {
      const t0 = process.hrtime.bigint();
      const r = guard.redact(text);
      const t1 = process.hrtime.bigint();
      durations.push(Number(t1 - t0) / 1e6);
      findings = r.findings.length;
    }
    durations.sort((a, b) => a - b);
    const r3 = (x) => Math.round(x * 1000) / 1000;
    return { label: s.label, chars: text.length, warmup: s.warmup, runs: s.runs, findings,
      p50: r3(metricsMod.percentile(durations, 0.5)), p95: r3(metricsMod.percentile(durations, 0.95)),
      max: r3(durations[durations.length - 1]) };
  });
  const cpus = os.cpus();
  return { schema: 1, measuredOn: localDate(), node: process.version, platform: process.platform + ' ' + process.arch,
    cpu: cpus.length ? cpus[0].model.trim() : 'unknown', sizes };
}

function computeMetrics(templates, sets, quick, version, templateInfo) {
  const built = dataset.buildAll({ sets, quick, templates });
  const evaluated = {};
  for (const name of sets) evaluated[name] = metricsMod.evaluateSet(built[name], guard.detect);
  const targets = {};
  for (const name of SET_NAMES) {
    targets[name] = quick ? { gold: dataset.QUICK.gold, decoys: dataset.QUICK.decoys }
      : { gold: dataset.SETS[name].gold, decoys: dataset.SETS[name].decoys };
  }
  const metrics = roundDeep({
    tool: 'indiapii-guard',
    version,
    schema: 1,
    config: {
      threshold: 0.5, ocrNormalise: true, quick,
      seeds: { dev: dataset.SETS.dev.seed, heldout: dataset.SETS.heldout.seed, adversarial: dataset.SETS.adversarial.seed,
        latency: dataset.LATENCY_SEED },
      targets
    },
    templates: templateInfo,
    sets: evaluated,
    gateAccuracy: report.gateAccuracy(evaluated)
  });
  return { built, metrics, metricsJson: JSON.stringify(metrics, null, 2) + '\n' };
}

// runEval({ sets, quick, latency, readme, write, writeData, checkRepro, root })
//   -> { metrics, metricsJson, reportMd, readmeBlock, gate, written, publishing, repro, warnings }
function runEval(options) {
  const o = Object.assign({ sets: SET_NAMES, quick: false, latency: true, readme: true, write: true, writeData: false,
    checkRepro: false, root: ROOT }, options || {});
  const root = o.root;
  const sets = SET_NAMES.filter((s) => o.sets.indexOf(s) >= 0);
  const publishing = sets.length === SET_NAMES.length && !o.quick && !o.checkRepro;
  const write = Boolean(o.write) && publishing;
  const warnings = [];
  const version = readJson(path.join(root, 'package.json')).version;

  const templates = dataset.loadTemplates(root);
  const templateInfo = {};
  const templateHashes = {};
  for (const name of SET_NAMES) {
    const file = dataset.SETS[name].file;
    templateHashes[name] = report.fileHash(path.join(root, file));
    templateInfo[name] = { file, sha256: templateHashes[name], positive: templates[name].filter((t) => t.positive).length,
      negative: templates[name].filter((t) => !t.positive).length };
  }

  const first = computeMetrics(templates, sets, Boolean(o.quick), version, templateInfo);
  let repro = null;
  if (o.checkRepro) repro = computeMetrics(templates, sets, Boolean(o.quick), version, templateInfo).metricsJson === first.metricsJson;
  const metrics = first.metrics;

  const resultsDir = path.join(root, 'eval', 'results');
  let latencyNode = null;
  let latencyMeasured = false;
  if (publishing && o.latency) {
    latencyNode = measureNodeLatency(templates.heldout);
    latencyMeasured = true;
  } else {
    const p = path.join(resultsDir, 'latency-node.json');
    if (fs.existsSync(p)) {
      try { latencyNode = readJson(p); } catch (e) { warnings.push('latency-node.json is malformed; Node latency counts as not measured.'); }
      if (latencyNode && !Array.isArray(latencyNode.sizes)) latencyNode = null;
    }
  }

  let browser = null;
  const bp = path.join(resultsDir, 'latency-browser.json');
  if (fs.existsSync(bp)) {
    try {
      const data = readJson(bp);
      if (!data || !Array.isArray(data.browsers)) throw new Error('bad shape');
      const stale = data.version !== version || data.detectorHash !== report.detectorHash(root);
      if (stale) warnings.push(report.STALE_BROWSER);
      browser = { data, stale, malformed: false };
    } catch (e) {
      warnings.push('latency-browser.json is malformed; browser latency counts as not measured.');
      browser = { data: null, stale: false, malformed: true };
    }
  }

  const gate = report.gateResult(metrics, latencyNode, browser);
  const histPath = path.join(root, 'eval', 'HISTORY.md');
  const history = fs.existsSync(histPath) ? fs.readFileSync(histPath, 'utf8') : '';
  const reportMd = report.renderReport({ metrics, gate, latencyNode, browser, history, templateHashes, version });
  const readmeBlock = report.renderReadmeBlock(metrics, gate);

  const written = [];
  if (write) {
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, 'metrics.json'), first.metricsJson, 'utf8');
    written.push('eval/results/metrics.json');
    if (latencyMeasured) {
      fs.writeFileSync(path.join(resultsDir, 'latency-node.json'), JSON.stringify(latencyNode, null, 2) + '\n', 'utf8');
      written.push('eval/results/latency-node.json');
    }
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'EVAL-REPORT.md'), reportMd, 'utf8');
    written.push('docs/EVAL-REPORT.md');
    if (o.readme) {
      const rp = path.join(root, 'README.md');
      const updated = report.replaceReadmeBlock(fs.readFileSync(rp, 'utf8'), readmeBlock);
      if (updated === null) throw new Error('README.md has no <!-- eval:start --> / <!-- eval:end --> markers');
      fs.writeFileSync(rp, updated, 'utf8');
      written.push('README.md');
    }
  }
  if (o.writeData) for (const p of dataset.writeData(root, first.built)) written.push(p);

  return { metrics, metricsJson: first.metricsJson, reportMd, readmeBlock, gate, written, publishing, repro, warnings };
}

function fmt3(x) { return x === null || x === undefined ? 'n/a' : x.toFixed(3); }

function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (e) {
    if (e instanceof ArgError) { process.stderr.write(e.message + '\n' + USAGE); return 2; }
    throw e;
  }
  if (args.help) { process.stdout.write(USAGE); return 0; }
  let r;
  try {
    r = runEval({ sets: args.sets, quick: args.quick, latency: !args.noLatency, readme: !args.noReadme, write: true,
      writeData: args.writeData, checkRepro: args.checkRepro });
  } catch (e) {
    process.stderr.write(e.message + '\n');
    return 1;
  }
  for (const w of r.warnings) process.stdout.write('Warning: ' + w + '\n');
  for (const name of Object.keys(r.metrics.sets)) {
    const m = r.metrics.sets[name].exact.micro;
    process.stdout.write(name + ': micro precision ' + fmt3(m.precision) + ', recall ' + fmt3(m.recall) + ', F1 ' +
      fmt3(m.f1) + ' (' + r.metrics.sets[name].documents + ' documents)\n');
  }
  // SPEC 9.8 applies the gate to the full build only, so quick and partial runs print no gate result.
  if (args.quick || Object.keys(r.metrics.sets).length < 3) {
    process.stdout.write('Release gate: not applicable (' + (args.quick ? 'quick' : 'partial') + ' build)\n');
  } else {
    process.stdout.write('Release gate: ' + r.gate.overall + ' (' + r.gate.met + ' of ' + r.gate.total + ' criteria met)\n');
    const failing = r.gate.rows.filter((x) => x.status === 'FAIL').map((x) => x.id);
    if (failing.length) process.stdout.write('Failing: ' + failing.join(', ') + '\n');
  }
  if (args.checkRepro) {
    process.stdout.write('check-repro: ' + (r.repro ? 'identical' : 'DIFFERENT') + '\n');
    if (!r.repro) return 1;
  }
  process.stdout.write(r.written.length ? 'Wrote: ' + r.written.join(', ') + '\n' : 'Wrote nothing (not a publishing run).\n');
  if (args.strictGate && r.gate.overall !== 'PASS') return 4;
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { runEval, parseArgs, main, USAGE, roundDeep, measureNodeLatency };
