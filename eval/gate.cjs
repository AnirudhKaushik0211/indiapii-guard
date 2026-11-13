'use strict';
// Release gate (SPEC 9.8), fixed before measurement. Never change these rows to fit a result;
// test/gate.test.cjs asserts they equal the table in docs/SPEC.md.

const ROWS = [
  { id: 'G01', set: 'heldout', metric: 'precision', entity: 'AADHAAR', op: '>=', threshold: 0.97 },
  { id: 'G02', set: 'heldout', metric: 'recall', entity: 'AADHAAR', op: '>=', threshold: 0.95 },
  { id: 'G03', set: 'heldout', metric: 'precision', entity: 'PAN', op: '>=', threshold: 0.95 },
  { id: 'G04', set: 'heldout', metric: 'recall', entity: 'PAN', op: '>=', threshold: 0.95 },
  { id: 'G05', set: 'heldout', metric: 'precision', entity: 'PHONE', op: '>=', threshold: 0.95 },
  { id: 'G06', set: 'heldout', metric: 'recall', entity: 'PHONE', op: '>=', threshold: 0.90 },
  { id: 'G07', set: 'heldout', metric: 'precision', entity: 'EMAIL', op: '>=', threshold: 0.98 },
  { id: 'G08', set: 'heldout', metric: 'recall', entity: 'EMAIL', op: '>=', threshold: 0.98 },
  { id: 'G09', set: 'heldout', metric: 'precision', entity: 'UPI', op: '>=', threshold: 0.95 },
  { id: 'G10', set: 'heldout', metric: 'recall', entity: 'UPI', op: '>=', threshold: 0.90 },
  { id: 'G11', set: 'heldout', metric: 'precision', entity: 'IFSC', op: '>=', threshold: 0.95 },
  { id: 'G12', set: 'heldout', metric: 'recall', entity: 'IFSC', op: '>=', threshold: 0.95 },
  { id: 'G13', set: 'heldout', metric: 'precision', entity: 'CARD', op: '>=', threshold: 0.97 },
  { id: 'G14', set: 'heldout', metric: 'recall', entity: 'CARD', op: '>=', threshold: 0.95 },
  { id: 'G15', set: 'heldout', metric: 'precision', entity: 'GSTIN', op: '>=', threshold: 0.97 },
  { id: 'G16', set: 'heldout', metric: 'recall', entity: 'GSTIN', op: '>=', threshold: 0.95 },
  { id: 'G17', set: 'heldout', metric: 'precision', entity: 'BANK_ACCOUNT', op: '>=', threshold: 0.90 },
  { id: 'G18', set: 'heldout', metric: 'recall', entity: 'BANK_ACCOUNT', op: '>=', threshold: 0.80 },
  { id: 'G19', set: 'heldout', metric: 'precision', entity: 'ALL', op: '>=', threshold: 0.95 },
  { id: 'G20', set: 'heldout', metric: 'recall', entity: 'ALL', op: '>=', threshold: 0.92 },
  { id: 'G21', set: 'adversarial', metric: 'decoy_hit_rate', entity: 'ALL', op: '<=', threshold: 0.05 },
  { id: 'G22', set: 'adversarial', metric: 'precision', entity: 'ALL', op: '>=', threshold: 0.85 },
  { id: 'G23', set: 'adversarial', metric: 'recall', entity: 'ALL', op: '>=', threshold: 0.70 },
  { id: 'G24', set: 'node-1KB', metric: 'p95_ms', entity: '-', op: '<=', threshold: 5 },
  { id: 'G25', set: 'node-10KB', metric: 'p95_ms', entity: '-', op: '<=', threshold: 50 },
  { id: 'G26', set: 'edge-10KB', metric: 'p95_ms', entity: '-', op: '<=', threshold: 100 },
  { id: 'G27', set: 'firefox-10KB', metric: 'p95_ms', entity: '-', op: '<=', threshold: 100 }
];

function isLatency(r) { return r.metric === 'p95_ms'; }

// One criterion: value undefined -> NOT MEASURED (a latency file is missing or stale, or the set was not built
// in a partial run); null -> FAIL (SPEC 9.8: a criterion whose value is null fails); otherwise compare.
function evaluateRow(r, value) {
  if (value === undefined) return { status: 'NOT MEASURED', pass: false };
  if (value === null || typeof value !== 'number' || !isFinite(value)) return { status: 'FAIL', pass: false };
  const pass = r.op === '>=' ? value >= r.threshold : value <= r.threshold;
  return { status: pass ? 'PASS' : 'FAIL', pass };
}

// statuses: array of 'PASS' | 'FAIL' | 'NOT MEASURED'. PASS if all pass; FAIL if any measured criterion fails;
// INCOMPLETE otherwise.
function overall(statuses) {
  if (statuses.length && statuses.every((s) => s === 'PASS')) return 'PASS';
  if (statuses.some((s) => s === 'FAIL')) return 'FAIL';
  return 'INCOMPLETE';
}

module.exports = { ROWS, isLatency, evaluateRow, overall };
