'use strict';
// SPEC 6.1: public API surface in Node and in the browser-style global namespace.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const guard = require(path.join(ROOT, 'js', 'guard.js'));
const validators = require(path.join(ROOT, 'js', 'validators.js'));
const lexicon = require(path.join(ROOT, 'js', 'lexicon.js'));

test('public API surface', () => {
  assert.deepEqual(Object.keys(guard).sort(),
    ['CSP_META', 'ENTITIES', 'THRESHOLDS', 'VERSION', 'applyRedaction', 'detect', 'redact', 'validators']);
  assert.equal(guard.VERSION, '1.0.0');
  assert.equal(guard.CSP_META, true);
  assert.deepEqual(guard.ENTITIES, lexicon.ENTITIES);
  assert.deepEqual(guard.THRESHOLDS, { lenient: 0.35, balanced: 0.5, strict: 0.7 });
  assert.equal(guard.validators, validators);
  for (const k of ['detect', 'redact', 'applyRedaction']) assert.equal(typeof guard[k], 'function');
  const r = guard.redact('');
  assert.deepEqual(Object.keys(r).sort(), ['findings', 'mapping', 'redactedCount', 'stats', 'text']);
  assert.equal(r.text, '');
});

test('VERSION equals package.json version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(guard.VERSION, pkg.version);
  assert.equal(pkg.type, 'commonjs');
});

test('browser namespace: modules load as classic scripts and members are copied onto IndiaPIIGuard', () => {
  const ctx = { self: {} };
  ctx.self.self = ctx.self;
  vm.createContext(ctx);
  for (const f of ['validators', 'lexicon', 'detector', 'redactor', 'guard']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  }
  const ns = ctx.self.IndiaPIIGuard;
  for (const k of ['validators', 'lexicon', 'detector', 'redactor', 'guard']) assert.ok(ns[k], k);
  for (const k of ['detect', 'redact', 'applyRedaction', 'ENTITIES', 'THRESHOLDS', 'VERSION', 'CSP_META', 'validators']) {
    assert.equal(ns[k], ns.guard[k], k);
  }
  assert.equal(ns.validators, ns.guard.validators);
  const G1 = 'Aadhaar 2345 6789 0124, PAN ABCPE1234F';
  assert.equal(ns.redact(G1).text, guard.redact(G1).text);
});
