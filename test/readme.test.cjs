'use strict';
// SPEC 10.1 readme row: eval block equals the rendering from committed results; self-scan passes; screenshots.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const report = require('../eval/report.cjs');
const selfscan = require('../scripts/selfscan.cjs');

const ROOT = path.resolve(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8'));

function screenshotsSection(md) {
  const a = md.indexOf('\n## Screenshots');
  assert.ok(a >= 0, 'README has a Screenshots section');
  const b = md.indexOf('\n## ', a + 5);
  return md.slice(a, b < 0 ? md.length : b);
}

test('README eval block equals the rendering from the committed metrics and latency files', () => {
  const metrics = readJson('eval/results/metrics.json');
  const latencyNode = fs.existsSync(path.join(ROOT, 'eval', 'results', 'latency-node.json')) ? readJson('eval/results/latency-node.json') : null;
  let browser = null;
  if (fs.existsSync(path.join(ROOT, 'eval', 'results', 'latency-browser.json'))) {
    const data = readJson('eval/results/latency-browser.json');
    const version = readJson('package.json').version;
    browser = { data, stale: data.version !== version || data.detectorHash !== report.detectorHash(ROOT), malformed: false };
  }
  const gate = report.gateResult(metrics, latencyNode, browser);
  const block = report.renderReadmeBlock(metrics, gate);
  const expected = report.replaceReadmeBlock(README, block);
  assert.ok(expected !== null, 'markers present');
  assert.equal(README, expected);
});

test('README passes the self-scan (only 11.5 examples as identifier-shaped values)', () => {
  assert.deepEqual(selfscan.scanString('README.md', README), []);
});

test('every screenshot is referenced, every reference exists, with alt text and the caption', () => {
  const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter((n) => /^screenshot-.*\.png$/.test(n)).sort();
  assert.equal(docs.length, 8);
  const section = screenshotsSection(README);
  const refs = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(section)) !== null) refs.push({ alt: m[1], src: m[2], end: m.index + m[0].length });
  assert.deepEqual(refs.map((r) => r.src.replace(/^docs\//, '')).sort(), docs, 'Screenshots section references every image');
  for (const r of refs) {
    assert.ok(r.alt.trim().length > 0, 'alt text for ' + r.src);
    assert.ok(fs.existsSync(path.join(ROOT, ...r.src.split('/'))), r.src + ' exists');
    const after = section.slice(r.end).replace(/^\s+/, '');
    assert.ok(after.startsWith('Synthetic sample data.'), 'caption after ' + r.src);
  }
  // Every image referenced anywhere in the README exists.
  const all = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  while ((m = all.exec(README)) !== null) assert.ok(fs.existsSync(path.join(ROOT, ...m[1].split('/'))), m[1]);
});
