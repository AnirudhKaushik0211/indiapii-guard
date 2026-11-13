'use strict';
// SPEC 6.3 and 10.1: scripts/redact.cjs, run as a child process with temporary files in os.tmpdir().
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'scripts', 'redact.cjs');
const G1 = 'Aadhaar 2345 6789 0124, PAN ABCPE1234F, mobile +91 98765 43210, email asha.samplekar@example.com, ' +
  'UPI asha.samplekar@okaxis, IFSC ABCD0123456, a/c 50100012345678, card 4111 1111 1111 1111, GSTIN 27ABCPE1234F1ZB.';
const TOKEN = 'Aadhaar [AADHAAR_1], PAN [PAN_1], mobile [PHONE_1], email [EMAIL_1], UPI [UPI_1], IFSC [IFSC_1], ' +
  'a/c [BANK_ACCOUNT_1], card [CARD_1], GSTIN [GSTIN_1].';
const MASK = 'Aadhaar XXXX XXXX XXXX, PAN XXXXXXXXXX, mobile +XX XXXXX XXXXX, email XXXX.XXXXXXXXX@XXXXXXX.XXX, ' +
  'UPI XXXX.XXXXXXXXX@XXXXXX, IFSC XXXXXXXXXXX, a/c XXXXXXXXXXXXXX, card XXXX XXXX XXXX XXXX, GSTIN XXXXXXXXXXXXXXX.';
const G1_TEXTS = ['2345 6789 0124', 'ABCPE1234F', '98765 43210', 'asha.samplekar@example.com', 'asha.samplekar@okaxis',
  'ABCD0123456', '50100012345678', '4111 1111 1111 1111', '27ABCPE1234F1ZB'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piig-cli-'));
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const g1File = path.join(tmp, 'g1.txt');
fs.writeFileSync(g1File, G1, 'utf8');
const missing = path.join(tmp, 'does-not-exist.txt');

function cli(args, input) {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    input: input === undefined ? '' : input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('--help prints usage to stdout and exits 0, before any other check', () => {
  for (const args of [['--help'], ['--blur', '--help'], ['--json', '--json', '--help', missing]]) {
    const r = cli(args);
    assert.equal(r.code, 0, args.join(' '));
    assert.match(r.stdout, /^Usage: node scripts\/redact\.cjs/);
    assert.match(r.stdout, /JSON output contains the original values/);
    assert.equal(r.stderr, '');
  }
});

test('G1 file: stdout equals the token output', () => {
  const r = cli([g1File]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, TOKEN);
  assert.equal(r.stderr, '');
});

test('--style mask', () => {
  const r = cli([g1File, '--style', 'mask']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, MASK);
});

test('--json shape', () => {
  const r = cli(['--json', g1File]);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j), ['version', 'findings', 'mapping', 'redactedText']);
  assert.equal(j.version, '1.0.0');
  assert.equal(j.redactedText, TOKEN);
  assert.equal(j.findings.length, 9);
  assert.equal(j.findings[0].text, '2345 6789 0124');
  assert.equal(j.mapping.length, 9);
  assert.ok(r.stdout.includes('\n  "version"'), 'pretty-printed with 2 spaces');
});

test('stdin -', () => {
  const r = cli(['-'], G1);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, TOKEN);
});

test('line endings are unchanged', () => {
  const f = path.join(tmp, 'crlf.txt');
  fs.writeFileSync(f, 'mobile 98765 43210\r\nnext\r\n', 'utf8');
  assert.equal(cli([f]).stdout, 'mobile [PHONE_1]\r\nnext\r\n');
});

test('--fail-on-find exits 3 and still writes the output', () => {
  const r = cli([g1File, '--fail-on-find']);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, TOKEN);
  assert.equal(r.stderr, '');
  const clean = path.join(tmp, 'clean.txt');
  fs.writeFileSync(clean, 'nothing here', 'utf8');
  assert.equal(cli([clean, '--fail-on-find']).code, 0);
});

test('--out writes the file; --out equal to the input exits 2', () => {
  const out = path.join(tmp, 'out.txt');
  const r = cli([g1File, '--out', out]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.equal(fs.readFileSync(out, 'utf8'), TOKEN);
  for (const o of [g1File, process.platform === 'win32' ? g1File.toUpperCase() : g1File]) {
    const e = cli([g1File, '--out', o]);
    assert.equal(e.code, 2);
    assert.match(e.stderr, /^--out must not be the input file\n/);
    assert.equal(fs.readFileSync(g1File, 'utf8'), G1);
  }
});

test('runtime errors exit 1', () => {
  const m = cli([missing]);
  assert.equal(m.code, 1);
  assert.match(m.stderr, /^Cannot read .*: ENOENT\n$/);
  assert.equal(m.stdout, '');
  const bad = path.join(tmp, 'bad.txt');
  fs.writeFileSync(bad, Buffer.from([0x61, 0xC3, 0x28, 0x62]));
  const b = cli([bad]);
  assert.equal(b.code, 1);
  assert.equal(b.stderr, bad + ' is not valid UTF-8 text\n');
  const badOut = cli([g1File, '--out', path.join(tmp, 'no-such-dir', 'x.txt')]);
  assert.equal(badOut.code, 1);
  assert.ok(!G1_TEXTS.some((t) => badOut.stderr.includes(t)));
});

test('a leading BOM is kept as part of the text', () => {
  const f = path.join(tmp, 'bom.txt');
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('PAN ABCPE1234F', 'utf8')]));
  assert.equal(cli([f]).stdout, '\uFEFFPAN [PAN_1]');
});

test('valid options exit 0', () => {
  assert.equal(cli([g1File, '--threshold', '0.7']).code, 0);
  assert.equal(cli([g1File, '--threshold', 'strict']).code, 0);
  assert.equal(cli([g1File, '--threshold', '1.0']).code, 0);
  assert.equal(cli([g1File, '--no-ocr']).stdout, TOKEN);
  const r = cli(['--entities', 'pan,aadhaar', g1File]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('+91 98765 43210'), 'phone stays');
  assert.ok(!r.stdout.includes('ABCPE1234F,'), 'PAN redacted');
  assert.ok(!r.stdout.includes('2345 6789 0124'), 'Aadhaar redacted');
  assert.ok(r.stdout.startsWith('Aadhaar [AADHAAR_1], PAN [PAN_1], mobile +91'));
  assert.equal(cli(['--entities', ' PAN , pan ', g1File]).code, 0);
});

test('invalid arguments exit 2, print the message and the usage, write nothing to stdout, read nothing', () => {
  const cases = [
    [[missing, '--blur'], 'unknown option: --blur'],
    [[missing, '-x'], 'unknown option: -x'],
    [[missing, '--style=mask'], 'unknown option: --style=mask'],
    [[missing, '--threshold', '2'], 'threshold must be a number between 0 and 1 or a preset name'],
    [[missing, '--threshold', '0.5abc'], 'threshold must be a number between 0 and 1 or a preset name'],
    [[missing, '--threshold', ''], 'threshold must be a number between 0 and 1 or a preset name'],
    [[missing, '--threshold', '.5'], 'threshold must be a number between 0 and 1 or a preset name'],
    [[missing, '--threshold', '-0'], 'threshold must be a number between 0 and 1 or a preset name'],
    [[missing, '--threshold', 'Strict'], 'threshold must be a number between 0 and 1 or a preset name'],
    [[missing, '--entities', 'FOO'], 'unknown entity: FOO'],
    [[missing, '--entities', 'PAN,'], 'unknown entity: '],
    [[missing, '--style'], '--style needs a value'],
    [[missing, '--style', '--json'], '--style needs a value'],
    [[missing, '--style', 'blur'], 'style must be token, mask or partial'],
    [[missing, '--style', 'Mask'], 'style must be token, mask or partial'],
    [[missing, '--json', '--json'], '--json given twice'],
    [[missing, '--json', '--json', '--blur'], '--json given twice'],
    [[missing, '--style', 'mask', '--style', 'token'], '--style given twice'],
    [[], 'expected one input file (or - for stdin)'],
    [['--json'], 'expected one input file (or - for stdin)'],
    [[missing, missing], 'expected one input file (or - for stdin)'],
    [[missing, '-', '--style', 'blur'], 'expected one input file (or - for stdin)'],
    [[missing, '--style', 'blur', '--threshold', '2'], 'style must be token, mask or partial'],
    [[missing, '--entities', 'FOO', '--out', missing], 'unknown entity: FOO'],
    [[missing, '--out', missing], '--out must not be the input file']
  ];
  for (const [args, message] of cases) {
    const r = cli(args);
    const label = JSON.stringify(args.map((a) => (a === missing ? '<missing>' : a)));
    assert.equal(r.code, 2, label);
    assert.equal(r.stdout, '', label);
    assert.ok(r.stderr.startsWith(message + '\n'), label + ' -> ' + r.stderr.split('\n')[0]);
    assert.ok(r.stderr.includes('Usage: node scripts/redact.cjs'), label);
  }
});

test('a 1,500,000-character file exits 0 and leaks no G1 identifier text', () => {
  let big = '';
  const line = G1 + '\n';
  big = line.repeat(Math.ceil(1500000 / line.length)).slice(0, 1500000);
  big = big.slice(0, big.lastIndexOf('\n') + 1);
  big = big + 'x'.repeat(1500000 - big.length);
  assert.equal(big.length, 1500000);
  const f = path.join(tmp, 'big.txt');
  fs.writeFileSync(f, big, 'utf8');
  const r = cli([f]);
  assert.equal(r.code, 0);
  for (const t of G1_TEXTS) assert.ok(!r.stdout.includes(t), t);
});

test('a file of 10,485,761 bytes exits 1 with the 10 MB message', () => {
  const f = path.join(tmp, 'huge.txt');
  fs.writeFileSync(f, Buffer.alloc(10485761, 0x61));
  const r = cli([f]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, f + ' is larger than 10 MB\n');
  assert.equal(r.stdout, '');
  const s = cli(['-'], Buffer.alloc(10485761, 0x61));
  assert.equal(s.code, 1);
  assert.equal(s.stderr, 'stdin is larger than 10 MB\n');
});
