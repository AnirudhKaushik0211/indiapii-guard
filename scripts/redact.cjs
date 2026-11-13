#!/usr/bin/env node
'use strict';
// IndiaPII Guard CLI (SPEC 6.3). Argument checks run before any input is read; messages go to stderr and
// never contain finding values. Exit codes: 0 ok, 1 runtime error, 2 invalid arguments, 3 --fail-on-find.

const fs = require('node:fs');
const path = require('node:path');
const guard = require(path.join(__dirname, '..', 'js', 'guard.js'));

const MAX_BYTES = 10485760;

const USAGE = [
  'Usage: node scripts/redact.cjs <file|-> [options]',
  '',
  'Detects and redacts Indian personal data in a UTF-8 text file (- reads stdin).',
  'Runs locally; nothing is sent anywhere.',
  '',
  'Options:',
  '  --style token|mask|partial   redaction style (default token)',
  '  --threshold <0..1>|lenient|balanced|strict',
  '                               confidence threshold (default balanced = 0.5)',
  '  --entities AADHAAR,PAN,...   only detect these entities (comma-separated)',
  '  --no-ocr                     turn off OCR lookalike normalisation (O->0, I/l->1)',
  '  --json                       write JSON { version, findings, mapping, redactedText }',
  '                               WARNING: JSON output contains the original values',
  '  --out <file>                 write to a file instead of stdout (never the input file)',
  '  --fail-on-find               exit 3 when at least one finding was redacted',
  '  --help                       show this help',
  '',
  'Exit codes: 0 success, 1 runtime error, 2 invalid arguments, 3 found (with --fail-on-find).',
  ''
].join('\n');

const VALUE_FLAGS = ['--style', '--threshold', '--entities', '--out'];
const BOOL_FLAGS = ['--no-ocr', '--json', '--fail-on-find'];

class UsageError extends Error {}

// One left-to-right pass over argv (design-review NIT 1), then the value checks in SPEC order.
function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-') { positionals.push(a); continue; }
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.includes(a)) {
        if (Object.prototype.hasOwnProperty.call(flags, a)) throw new UsageError(a + ' given twice');
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) throw new UsageError(a + ' needs a value');
        flags[a] = next;
        i++;
        continue;
      }
      if (BOOL_FLAGS.includes(a)) {
        if (Object.prototype.hasOwnProperty.call(flags, a)) throw new UsageError(a + ' given twice');
        flags[a] = true;
        continue;
      }
      throw new UsageError('unknown option: ' + a);
    }
    if (a.startsWith('-')) throw new UsageError('unknown option: ' + a);
    positionals.push(a);
  }

  if (positionals.length !== 1) throw new UsageError('expected one input file (or - for stdin)');
  const input = positionals[0];
  const options = {};

  if (flags['--style'] !== undefined) {
    const s = flags['--style'];
    if (s !== 'token' && s !== 'mask' && s !== 'partial') throw new UsageError('style must be token, mask or partial');
    options.style = s;
  }
  if (flags['--threshold'] !== undefined) {
    const t = flags['--threshold'];
    if (t === 'lenient' || t === 'balanced' || t === 'strict') options.threshold = t;
    else if (/^(0(\.\d+)?|1(\.0+)?)$/.test(t)) options.threshold = Number(t);
    else throw new UsageError('threshold must be a number between 0 and 1 or a preset name');
  }
  if (flags['--entities'] !== undefined) {
    const list = [];
    for (const raw of flags['--entities'].split(',')) {
      const item = raw.trim();
      const id = item.toUpperCase();
      if (item === '' || !guard.ENTITIES.includes(id)) throw new UsageError('unknown entity: ' + item);
      if (!list.includes(id)) list.push(id);
    }
    options.entities = list;
  }
  if (flags['--out'] !== undefined && input !== '-') {
    let a = path.resolve(flags['--out']);
    let b = path.resolve(input);
    if (process.platform === 'win32') { a = a.toLowerCase(); b = b.toLowerCase(); }
    if (a === b) throw new UsageError('--out must not be the input file');
  }
  if (flags['--no-ocr']) options.ocrNormalise = false;
  return { input, options, out: flags['--out'], json: flags['--json'] === true, failOnFind: flags['--fail-on-find'] === true };
}

function fail(code, message) {
  process.stderr.write(message + '\n');
  process.exitCode = code;
}

function readStdin() {
  const chunks = [];
  let total = 0;
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      if (err.code === 'EOF') break;
      throw err;
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_BYTES) return null;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

function main(argv) {
  if (argv.includes('--help')) { process.stdout.write(USAGE); process.exitCode = 0; return; }
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) { process.stderr.write(err.message + '\n\n' + USAGE); process.exitCode = 2; return; }
    throw err;
  }
  const name = args.input === '-' ? 'stdin' : args.input;

  let bytes;
  if (args.input === '-') {
    try {
      bytes = readStdin();
    } catch (err) {
      return fail(1, 'Cannot read ' + name + ': ' + (err.code || 'EIO'));
    }
    if (bytes === null) return fail(1, name + ' is larger than 10 MB');
  } else {
    let size;
    try {
      size = fs.statSync(args.input).size;
    } catch (err) {
      return fail(1, 'Cannot read ' + name + ': ' + (err.code || 'EIO'));
    }
    if (size > MAX_BYTES) return fail(1, name + ' is larger than 10 MB');
    try {
      bytes = fs.readFileSync(args.input);
    } catch (err) {
      return fail(1, 'Cannot read ' + name + ': ' + (err.code || 'EIO'));
    }
    if (bytes.length > MAX_BYTES) return fail(1, name + ' is larger than 10 MB');
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (err) {
    return fail(1, name + ' is not valid UTF-8 text');
  }

  let result;
  try {
    result = guard.redact(text, Object.assign({}, args.options, { maxLength: MAX_BYTES }));
  } catch (err) {
    return fail(1, err.message);
  }

  let output = result.text;
  if (args.json) {
    output = JSON.stringify({
      version: guard.VERSION,
      findings: result.findings,
      mapping: result.mapping,
      redactedText: result.text
    }, null, 2) + '\n';
  }

  if (args.out !== undefined) {
    try {
      fs.writeFileSync(args.out, output, 'utf8');
    } catch (err) {
      return fail(1, 'Cannot write ' + args.out + ': ' + (err.code || 'EIO'));
    }
  } else {
    process.stdout.write(output);
  }
  process.exitCode = args.failOnFind && result.redactedCount > 0 ? 3 : 0;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseArgs, USAGE, main };
