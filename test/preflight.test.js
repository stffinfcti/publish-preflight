'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', 'bin', 'publish-preflight.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-preflight-test-'));

function writeFile(dir, rel, body, mode = 0o644) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, { mode });
}

function runTool(dir, extra = []) {
  const res = spawnSync('node', [BIN, ...extra, dir], { encoding: 'utf8' });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

let passCount = 0;
let failCount = 0;
function assert(cond, name) {
  if (cond) {
    console.log(`  ✔ ${name}`);
    passCount++;
  } else {
    console.log(`  ✖ ${name}`);
    failCount++;
  }
}

const CLI = '#!/usr/bin/env node\nconsole.log("1.0.0");\n';

console.log('publish-preflight self-test\n');

try {
  // 1. Object-bin LF package passes (default --help is ignored by this bin)
  const goodDir = path.join(TMP, 'good');
  writeFile(goodDir, 'package.json', JSON.stringify({
    name: 'test-pkg',
    version: '1.0.0',
    bin: { 'test-pkg': './bin/test-pkg.js' },
  }, null, 2));
  writeFile(goodDir, 'bin/test-pkg.js', CLI, 0o755);
  let r = runTool(goodDir);
  assert(r.status === 0 && /pass — packed artifact/.test(r.out), 'LF object-bin package passes');

  // 2. CRLF shebang on the packed file fails
  const badDir = path.join(TMP, 'bad');
  writeFile(badDir, 'package.json', JSON.stringify({
    name: 'test-pkg-crlf',
    version: '1.0.0',
    bin: { 'test-pkg-crlf': './bin/test-pkg.js' },
  }, null, 2));
  writeFile(badDir, 'bin/test-pkg.js', CLI.replace(/\n/g, '\r\n'), 0o755);
  r = runTool(badDir);
  assert(r.status === 1 && /CRLF shebang/.test(r.out), 'CRLF bin fails');
  assert(/fail — not safe to publish/.test(r.out), 'reports fail');

  // 3. Missing package.json
  const noDir = path.join(TMP, 'nopkg');
  fs.mkdirSync(noDir);
  r = runTool(noDir);
  assert(r.status === 1 && /no package.json/.test(r.out), 'missing package.json fails');

  // 4. String bin (the shape that used to crash with EISDIR)
  const strDir = path.join(TMP, 'strbin');
  writeFile(strDir, 'package.json', JSON.stringify({
    name: 'strbin-pkg',
    version: '1.0.0',
    bin: './cli.js',
  }, null, 2));
  writeFile(strDir, 'cli.js', CLI, 0o755);
  r = runTool(strDir);
  assert(r.status === 0 && /bin strbin-pkg --help/.test(r.out), 'string bin passes');

  // 5. Library require
  const libDir = path.join(TMP, 'lib');
  writeFile(libDir, 'package.json', JSON.stringify({
    name: 'lib-pkg',
    version: '1.0.0',
    main: './index.js',
  }, null, 2));
  writeFile(libDir, 'index.js', 'module.exports = { ok: true };\n');
  r = runTool(libDir);
  assert(r.status === 0 && /require\/import lib-pkg succeeded/.test(r.out), 'CJS library require passes');

  // 6. ESM library (require fails, import must work)
  const esmDir = path.join(TMP, 'esm');
  writeFile(esmDir, 'package.json', JSON.stringify({
    name: 'esm-pkg',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './index.js' },
  }, null, 2));
  writeFile(esmDir, 'index.js', 'export const ok = true;\n');
  r = runTool(esmDir);
  assert(r.status === 0 && /require\/import esm-pkg succeeded/.test(r.out), 'ESM library import passes');

  // 7. files field omits main
  const omitDir = path.join(TMP, 'omit');
  writeFile(omitDir, 'package.json', JSON.stringify({
    name: 'omit-pkg',
    version: '1.0.0',
    main: './index.js',
    files: ['README.md'],
  }, null, 2));
  writeFile(omitDir, 'index.js', 'module.exports = 1;\n');
  writeFile(omitDir, 'README.md', 'hi\n');
  r = runTool(omitDir);
  assert(r.status === 1 && /not in the tarball/.test(r.out), 'omitted main fails');

  // 8. files field omits bin
  const omitBinDir = path.join(TMP, 'omit-bin');
  writeFile(omitBinDir, 'package.json', JSON.stringify({
    name: 'omit-bin-pkg',
    version: '1.0.0',
    bin: { 'omit-bin-pkg': './bin/cli.js' },
    files: ['README.md'],
  }, null, 2));
  writeFile(omitBinDir, 'bin/cli.js', CLI, 0o755);
  writeFile(omitBinDir, 'README.md', 'hi\n');
  r = runTool(omitBinDir);
  assert(r.status === 1 && /not in the tarball/.test(r.out), 'omitted bin fails');

  // 9. Missing shebang
  const noshDir = path.join(TMP, 'noshebang');
  writeFile(noshDir, 'package.json', JSON.stringify({
    name: 'nosh-pkg',
    version: '1.0.0',
    bin: { 'nosh-pkg': './bin/cli.js' },
  }, null, 2));
  writeFile(noshDir, 'bin/cli.js', 'console.log("1.0.0");\n', 0o755);
  r = runTool(noshDir);
  assert(r.status === 1 && /no shebang/.test(r.out), 'missing shebang fails');

  // 10. --cmd override; --version reads the installed manifest
  const selfDir = path.join(TMP, 'self');
  writeFile(selfDir, 'package.json', JSON.stringify({
    name: 'preflight-under-test',
    version: '9.9.9-test',
    bin: './bin/publish-preflight.js',
  }, null, 2));
  fs.mkdirSync(path.join(selfDir, 'bin'), { recursive: true });
  fs.copyFileSync(BIN, path.join(selfDir, 'bin', 'publish-preflight.js'));
  r = runTool(selfDir, ['--cmd', '--version']);
  assert(r.status === 0 && /packed artifact/.test(r.out), 'self-dogfood with --cmd --version passes');
  assert(/bin preflight-under-test --version exited 0: 9\.9\.9-test/.test(r.out), '--version reflects fixture manifest');

  // 11. Direct --version on a copied layout (no pack)
  const ver = spawnSync('node', [path.join(selfDir, 'bin', 'publish-preflight.js'), '--version'], { encoding: 'utf8' });
  assert(ver.status === 0 && ver.stdout.trim() === '9.9.9-test', 'own --version reads adjacent package.json');

  // 12. Temp dirs from the tool are removed
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('publish-preflight-')));
  runTool(goodDir);
  const leaked = fs.readdirSync(os.tmpdir())
    .filter((n) => n.startsWith('publish-preflight-'))
    .filter((n) => !before.has(n));
  assert(leaked.length === 0, 'does not leak temp directories');
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
