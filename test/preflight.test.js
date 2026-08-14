'use strict';
// preflight self-test — verifies the gate against the real failure class.
// Usage: npm test  (runs from the project root)

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', 'bin', 'preflight.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));

function makePkg(dir, { crlf = false } = {}) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'test-pkg',
    version: '1.0.0',
    bin: { 'test-pkg': './bin/test-pkg.js' },
  }, null, 2));
  let bin = '#!/usr/bin/env node\nconsole.log("1.0.0");\n';
  if (crlf) bin = bin.replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(dir, 'bin', 'test-pkg.js'), bin, { mode: 0o755 });
}

function runPreflight(dir) {
  const res = spawnSync('node', [BIN, dir], { encoding: 'utf8' });
  return { status: res.status, out: res.stdout + res.stderr };
}

let passCount = 0, failCount = 0;
function assert(cond, name) {
  if (cond) { console.log(`  ✔ ${name}`); passCount++; }
  else { console.log(`  ✖ ${name}`); failCount++; }
}

console.log('preflight self-test\n');

// 1. A well-formed package must PASS
const goodDir = path.join(TMP, 'good');
makePkg(goodDir);
let r = runPreflight(goodDir);
assert(r.status === 0 && /CLEAN-ROOM PASS/.test(r.out), 'LF package passes clean-room');
assert(!/CRLF/.test(r.out), 'no CRLF warning on LF package');

// 2. The git-will 0.1.1 failure class must FAIL
const badDir = path.join(TMP, 'bad');
makePkg(badDir, { crlf: true });
r = runPreflight(badDir);
assert(r.status === 1 && /CRLF shebang/.test(r.out), 'CRLF bin fails the gate');
assert(/CLEAN-ROOM FAIL/.test(r.out), 'reports CLEAN-ROOM FAIL');

// 3. Missing package.json must FAIL
const noDir = path.join(TMP, 'nopkg');
fs.mkdirSync(noDir);
r = runPreflight(noDir);
assert(r.status === 1 && /no package.json/.test(r.out), 'missing package.json fails');

// 4. The INSTALLED bin's CLI contract: --version must work when invoked
//    from the clean room — the exact call the gate makes on every bin it
//    verifies. (Regression for the self-dogfood failure: the gate verified
//    bins execute, and its own bin failed its own --version flag.)
//    Fixture version is DELIBERATELY NOT the package's real version — the
//    test asserts --version reflects the manifest, proving the hardcoded
//    PKG_VERSION is dead (a stale constant would print 0.1.0 and fail).
const selfDir = path.join(TMP, 'self');
fs.mkdirSync(selfDir, { recursive: true });
fs.writeFileSync(path.join(selfDir, 'package.json'), JSON.stringify({
  name: 'preflight-under-test',
  version: '9.9.9-test',
  bin: { preflight: './bin/preflight.js' },
}, null, 2));
fs.mkdirSync(path.join(selfDir, 'bin'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'bin', 'preflight.js'), path.join(selfDir, 'bin', 'preflight.js'));
r = runPreflight(selfDir);
assert(r.status === 0 && /CLEAN-ROOM PASS/.test(r.out), 'self-dogfood: preflight passes its own gate');
assert(r.status === 0 && /bin preflight executed: 9\.9\.9-test/.test(r.out), 'installed bin --version reflects manifest, not a hardcoded constant');

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
