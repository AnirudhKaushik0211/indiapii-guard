'use strict';
// SPEC 10.1 package row: packagePublic into a temporary folder outside the project, generic patterns only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packagePublic, pathProblem } = require('../scripts/package-public.cjs');
const { readZip } = require('../scripts/zip.cjs');
const v = require('../js/validators.js');

const ROOT = path.resolve(__dirname, '..');
const PREFIX = 'indiapii-guard-public/';

// Independent statement of the SPEC 11.1 allow-list (top level of each folder only).
function expectedFiles(root) {
  const out = [];
  for (const f of ['index.html', 'README.md', 'LICENSE', '.gitignore', '.nojekyll', 'package.json']) {
    if (fs.existsSync(path.join(root, f))) out.push(f);
  }
  const top = (dir, re) => {
    const abs = path.join(root, ...dir.split('/'));
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) if (e.isFile() && re.test(e.name)) out.push(dir + '/' + e.name);
  };
  top('css', /\.css$/);
  top('js', /\.js$/);
  top('docs', /\.(md|png)$/);
  top('test', /\.test\.cjs$/);
  top('scripts', /(\.cjs|^known-synthetic\.json)$/);
  top('eval', /(\.cjs|^HISTORY\.md)$/);
  top('eval/results', /\.json$/);
  return out.sort();
}

function filesUnder(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pg-pkg-')); }

function copyProject(dest) {
  fs.cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => { const r = path.relative(ROOT, src).split(path.sep); return r[0] !== 'dist' && r[0] !== '.denylist.local'; }
  });
}

test('pathProblem refusals of SPEC 11.1', () => {
  assert.equal(pathProblem('index.html'), null);
  assert.equal(pathProblem('.nojekyll'), null);
  assert.ok(pathProblem('dist/x.js'));
  assert.ok(pathProblem('js/node_modules/x.js'));
  assert.ok(pathProblem('.git/config'));
  assert.ok(pathProblem('docs/.hidden.md'));
  assert.ok(pathProblem('.denylist.local'));
  assert.ok(pathProblem('docs/run.log'));
});

test('packagePublic (generic-only) builds the folder and a matching zip', () => {
  const base = tmpDir();
  const out = path.join(base, 'indiapii-guard-public');
  try {
    const r = packagePublic({ out, genericOnly: true });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.deepEqual(r.hits, []);
    assert.deepEqual(r.selfHits, []);
    const want = expectedFiles(ROOT);
    assert.deepEqual(r.files, want);
    assert.deepEqual(filesUnder(out), want);
    assert.ok(fs.existsSync(out + '.zip'));
    const entries = readZip(fs.readFileSync(out + '.zip'));
    assert.deepEqual(entries.map((e) => e.name), want.map((f) => PREFIX + f));
    assert.ok(entries.every((e) => !e.name.includes('\\')), 'no backslashes');
    for (const e of entries) {
      const rel = e.name.slice(PREFIX.length);
      assert.ok(e.data.equals(fs.readFileSync(path.join(out, ...rel.split('/')))), rel);
    }
    for (const f of want) {
      assert.ok(!/(^|\/)dist\//.test(f) && !f.endsWith('.denylist.local') && !f.endsWith('.log'), f);
    }
    assert.ok(r.lines.includes('OK: ' + out));
    assert.ok(r.lines.includes('OK: ' + out + '.zip'));
    // A second run over a previous package replaces it.
    assert.equal(packagePublic({ out, genericOnly: true }).ok, true);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a planted deny-list term in a copy of the project fails the package and removes the outputs', () => {
  const base = tmpDir();
  const copy = path.join(base, 'project');
  const out = path.join(base, 'out', 'indiapii-guard-public');
  try {
    copyProject(copy);
    fs.writeFileSync(path.join(copy, 'docs', 'planted.md'), 'Contact: ' + 'someone' + '@' + 'mail' + 'box.co' + '\n');
    const r = packagePublic({ root: copy, out, genericOnly: true });
    assert.equal(r.ok, false);
    assert.ok(r.hits.some((h) => h.startsWith('docs/planted.md:1')));
    assert.ok(r.hits.every((h) => !h.includes('@')), 'locations only');
    assert.ok(r.lines.includes('REFUSED: package removed.'));
    assert.ok(!fs.existsSync(out));
    assert.ok(!fs.existsSync(out + '.zip'));
    // A private term from a .denylist.local in the copy also refuses.
    fs.rmSync(path.join(copy, 'docs', 'planted.md'));
    fs.writeFileSync(path.join(copy, '.denylist.local'), 'Fabri' + 'kam Ltd\n');
    fs.writeFileSync(path.join(copy, 'docs', 'planted.md'), 'Made at fabri' + 'kam_ltd.\n');
    const r2 = packagePublic({ root: copy, out, requireLocal: true });
    assert.equal(r2.ok, false);
    assert.ok(r2.hits.some((h) => h.startsWith('docs/planted.md:1')));
    assert.ok(!fs.existsSync(out) && !fs.existsSync(out + '.zip'));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a planted runtime-built identifier fails the self-scan and removes the outputs', () => {
  const base = tmpDir();
  const copy = path.join(base, 'project');
  const out = path.join(base, 'out', 'indiapii-guard-public');
  try {
    copyProject(copy);
    const b = '3456789' + '0123';
    const value = b + v.verhoeffDigit(b);
    fs.writeFileSync(path.join(copy, 'docs', 'planted.md'), 'Aadhaar ' + value + '\n');
    const r = packagePublic({ root: copy, out, genericOnly: true });
    assert.equal(r.ok, false);
    assert.deepEqual(r.hits, []);
    assert.equal(r.selfHits.length, 1);
    assert.ok(r.selfHits[0].startsWith('docs/planted.md:1 AADHAAR '));
    assert.ok(!r.lines.join('\n').includes(value), 'the value is never printed');
    assert.ok(r.lines.includes('REFUSED: package removed.'));
    assert.ok(!fs.existsSync(out));
    assert.ok(!fs.existsSync(out + '.zip'));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('refuses an --out that contains the project, an unrelated folder, and --require-local without the file', () => {
  const r1 = packagePublic({ out: path.dirname(ROOT), genericOnly: true });
  assert.equal(r1.ok, false);
  const base = tmpDir();
  try {
    fs.writeFileSync(path.join(base, 'keep.txt'), 'x');
    const r2 = packagePublic({ out: base, genericOnly: true });
    assert.equal(r2.ok, false);
    assert.ok(fs.existsSync(path.join(base, 'keep.txt')), 'an unrelated folder is never touched');
    const copy = path.join(base, 'project');
    copyProject(copy);
    const r3 = packagePublic({ root: copy, out: path.join(base, 'o', 'pkg'), requireLocal: true });
    assert.equal(r3.ok, false);
    assert.ok(r3.lines.some((l) => l.includes('.denylist.local is missing')));
    const r4 = packagePublic({ root: copy, out: path.join(base, 'o', 'pkg') });
    assert.equal(r4.ok, true, r4.lines.join('\n'));
    assert.ok(r4.lines.includes('WARNING: no .denylist.local; only generic patterns were scanned.'));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
