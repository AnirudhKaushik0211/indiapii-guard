'use strict';
// PII self-scan (SPEC 11.4), module and CLI:
//   node scripts/selfscan.cjs [dir]
// Default dir: dist/indiapii-guard-public. Exit 0 = no hits, 1 = hits, 2 = bad arguments.
// Runs the project's own detector over every text file (the 11.3 text types) with threshold 0.35, all entities and
// OCR normalisation on. A finding is allowed only if it is a TEST_CARDS card, an e-mail at a reserved domain, a key
// listed in scripts/known-synthetic.json, or a masked placeholder (its text contains XXX). Anything else is a hit,
// printed as "file:line <ENTITY> <shape>" with the masked shape of SPEC 9.5, never the value.
const fs = require('fs');
const path = require('path');
const guard = require('../js/guard.js');
const lexicon = require('../js/lexicon.js');
const deny = require('./denylist.cjs');
const { readZip } = require('./zip.cjs');
const { maskExcerpt } = require('../eval/metrics.cjs');

const ROOT = path.resolve(__dirname, '..');
const THRESHOLD = 0.35;
const KNOWN = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'known-synthetic.json'), 'utf8')));
const TEST_CARDS = new Set(lexicon.TEST_CARDS);

function isTextName(name) {
  const base = path.posix.basename(String(name).replace(/\\/g, '/'));
  return deny.TEXT_NAMES.has(base) || deny.TEXT_EXT.has(path.extname(base).toLowerCase());
}

// SPEC 11.4 allow rules. spanText is the original text of the finding.
function isAllowed(f, spanText) {
  if (f.entity === 'CARD' && TEST_CARDS.has(f.value)) return true;
  if (f.entity === 'EMAIL') {
    const at = f.value.lastIndexOf('@');
    if (at >= 0 && deny.isReservedDomain(f.value.slice(at + 1))) return true;
  }
  if (KNOWN.has(f.entity + ':' + f.value)) return true;
  return /[Xx]{3}/.test(spanText);
}

// Masked shape of a finding (SPEC 9.5 rules applied to the span alone).
function shapeOf(f, spanText) {
  const doc = { text: spanText, gold: [], decoys: [] };
  return maskExcerpt(doc, [{ entity: f.entity, start: 0, end: spanText.length }], 0, spanText.length);
}

// Scans one text. Returns hit strings "label:line ENTITY shape".
function scanString(label, text) {
  const hits = [];
  if (!text.length) return hits;
  const r = guard.detect(text, { threshold: THRESHOLD, maxLength: Math.max(1, text.length) });
  let line = 1;
  let pos = 0;
  for (const f of r.findings) {
    const span = text.slice(f.start, f.end);
    if (isAllowed(f, span)) continue;
    while (pos < f.start) { if (text.charCodeAt(pos) === 10) line++; pos++; }
    hits.push(label + ':' + line + ' ' + f.entity + ' ' + shapeOf(f, span));
  }
  return hits;
}

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

function scanBuffer(label, buf) {
  let text;
  try { text = fatalUtf8.decode(buf); } catch (e) { return [label + ': undecodable text']; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return scanString(label, text);
}

function walk(dir, base, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = base ? base + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(abs, rel, out);
    else if (ent.isFile()) out.push({ abs, rel });
  }
  return out;
}

// Scans every text file under dir. Returns {files, hits} (files = text files scanned).
function scanDir(dir) {
  const hits = [];
  let files = 0;
  for (const e of walk(dir, '', [])) {
    if (!isTextName(e.rel)) continue;
    files++;
    for (const h of scanBuffer(e.rel, fs.readFileSync(e.abs))) hits.push(h);
  }
  return { files, hits };
}

// Scans the text entries of a zip buffer. Returns {files, hits}; an unreadable zip is a hit.
function scanZip(label, buf) {
  let entries;
  try { entries = readZip(buf); } catch (e) { return { files: 0, hits: [label + ': unparseable zip'] }; }
  const hits = [];
  let files = 0;
  for (const e of entries) {
    if (!isTextName(e.name)) continue;
    files++;
    for (const h of scanBuffer(label + '!' + e.name, e.data)) hits.push(h);
  }
  return { files, hits };
}

module.exports = { THRESHOLD, KNOWN, isAllowed, shapeOf, scanString, scanBuffer, scanDir, scanZip, isTextName };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((a) => a.startsWith('--')) || args.length > 1) {
    console.error('Usage: node scripts/selfscan.cjs [dir]');
    process.exit(2);
  }
  const dir = path.resolve(args[0] || path.join(ROOT, 'dist', 'indiapii-guard-public'));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('Not a folder: ' + (args[0] || 'dist/indiapii-guard-public')); process.exit(2); }
  const r = scanDir(dir);
  for (const h of r.hits) console.log('HIT: ' + h);
  console.log('Self-scanned ' + r.files + ' text files: ' + r.hits.length + ' self-scan hits.');
  process.exit(r.hits.length ? 1 : 0);
}
