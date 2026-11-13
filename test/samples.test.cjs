'use strict';
// SPEC 8.6: the five samples, their stability and their detection.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const samples = require(path.join(ROOT, 'js', 'samples.js'));
const guard = require(path.join(ROOT, 'js', 'guard.js'));

test('five samples in order with the ids and titles of 8.6', () => {
  const s = samples.build();
  assert.deepEqual(s.map((x) => x.id), ['support-ticket', 'hr-form', 'chat-log', 'hinglish', 'ocr-noisy']);
  assert.deepEqual(s.map((x) => x.title),
    ['Support ticket', 'HR onboarding form', 'Chat log', 'Hinglish message', 'Noisy scanned text']);
  for (const x of s) {
    assert.equal(typeof x.note, 'string');
    assert.ok(x.note.length > 0);
    assert.ok(x.gold.length > 0);
    for (const g of x.gold) assert.deepEqual(Object.keys(g).sort(), ['end', 'entity', 'knownMiss', 'start']);
  }
  assert.ok(s[4].note.indexOf('missed on purpose') >= 0);
});

test('the same text on every build', () => {
  const a = samples.build();
  const b = samples.build();
  assert.deepEqual(a, b);
});

test('detection at defaults finds every non-knownMiss gold span exactly, misses knownMiss spans, no extras', () => {
  for (const s of samples.build()) {
    const findings = guard.detect(s.text).findings;
    const expected = s.gold.filter((g) => !g.knownMiss);
    for (const g of expected) {
      assert.ok(findings.some((f) => f.entity === g.entity && f.start === g.start && f.end === g.end),
        s.id + ': ' + g.entity + ' ' + g.start + '-' + g.end + ' not found');
    }
    for (const g of s.gold.filter((x) => x.knownMiss)) {
      assert.ok(!findings.some((f) => f.start < g.end && g.start < f.end), s.id + ': knownMiss span was found');
    }
    assert.equal(findings.length, expected.length, s.id + ': extra findings');
  }
  const knownMiss = samples.build().reduce((n, s) => n + s.gold.filter((g) => g.knownMiss).length, 0);
  assert.equal(knownMiss, 1);
});
