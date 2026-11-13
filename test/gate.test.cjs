'use strict';
// SPEC 9.8: eval/gate.cjs equals the gate table in docs/SPEC.md; overall-result logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const gate = require(path.join(ROOT, 'eval', 'gate.cjs'));

function specRows() {
  const spec = fs.readFileSync(path.join(ROOT, 'docs', 'SPEC.md'), 'utf8').replace(/\r\n/g, '\n');
  const a = spec.indexOf('<!-- gate:start -->');
  const b = spec.indexOf('<!-- gate:end -->');
  assert.ok(a >= 0 && b > a, 'gate markers missing in docs/SPEC.md');
  const lines = spec.slice(a, b).split('\n').filter((l) => l.indexOf('|') === 0);
  const header = lines[0].split('|').slice(1, -1).map((s) => s.trim());
  assert.deepEqual(header, ['Id', 'Set', 'Metric', 'Entity', 'Op', 'Threshold']);
  assert.match(lines[1], /^\|(---\|)+$/);
  return lines.slice(2).map((l) => {
    const c = l.split('|').slice(1, -1).map((s) => s.trim());
    return { id: c[0], set: c[1], metric: c[2], entity: c[3], op: c[4], thresholdText: c[5] };
  });
}

test('the SPEC gate table equals eval/gate.cjs exactly', () => {
  const rows = specRows();
  assert.equal(rows.length, 27);
  assert.equal(gate.ROWS.length, rows.length);
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const g = gate.ROWS[i];
    assert.deepEqual(Object.keys(g), ['id', 'set', 'metric', 'entity', 'op', 'threshold']);
    assert.deepEqual({ id: g.id, set: g.set, metric: g.metric, entity: g.entity, op: g.op },
      { id: s.id, set: s.set, metric: s.metric, entity: s.entity, op: s.op }, s.id);
    assert.match(s.thresholdText, /^\d+(\.\d+)?$/);
    assert.equal(g.threshold, Number(s.thresholdText), s.id);
  }
});

test('criterion evaluation: comparison, null fails, missing is NOT MEASURED', () => {
  const ge = gate.ROWS[0];
  const le = gate.ROWS.find((r) => r.id === 'G21');
  const lat = gate.ROWS.find((r) => r.id === 'G26');
  assert.equal(gate.evaluateRow(ge, 0.97).status, 'PASS');
  assert.equal(gate.evaluateRow(ge, 0.9699).status, 'FAIL');
  assert.equal(gate.evaluateRow(le, 0.05).status, 'PASS');
  assert.equal(gate.evaluateRow(le, 0.0501).status, 'FAIL');
  assert.equal(gate.evaluateRow(ge, null).status, 'FAIL');
  assert.equal(gate.evaluateRow(lat, undefined).status, 'NOT MEASURED');
  assert.equal(gate.evaluateRow(lat, 99.9).status, 'PASS');
  assert.equal(gate.evaluateRow(lat, NaN).status, 'FAIL');
});

test('overall result: PASS, FAIL, INCOMPLETE', () => {
  assert.equal(gate.overall(['PASS', 'PASS']), 'PASS');
  assert.equal(gate.overall(['PASS', 'FAIL', 'NOT MEASURED']), 'FAIL');
  assert.equal(gate.overall(['PASS', 'NOT MEASURED']), 'INCOMPLETE');
  assert.equal(gate.overall(['FAIL']), 'FAIL');
});
