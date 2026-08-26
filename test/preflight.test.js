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

  // 8. bin packed, but a required helper is omitted from files
  const omitHelperDir = path.join(TMP, 'omit-helper');
  writeFile(omitHelperDir, 'package.json', JSON.stringify({
    name: 'omit-helper-pkg',
    version: '1.0.0',
    bin: { 'omit-helper-pkg': './bin/cli.js' },
    files: ['bin/cli.js'],
  }, null, 2));
  writeFile(omitHelperDir, 'bin/cli.js', '#!/usr/bin/env node\nrequire("../lib/helper.js");\n', 0o755);
  writeFile(omitHelperDir, 'lib/helper.js', 'console.log("1.0.0");\n');
  r = runTool(omitHelperDir);
  assert(r.status === 1 && /failed \(exit/.test(r.out), 'bin missing required helper fails');

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

  // 13. init wires prepublishOnly and a Cursor skill
  const initDir = path.join(TMP, 'init-pkg');
  writeFile(initDir, 'package.json', JSON.stringify({
    name: 'init-pkg',
    version: '1.0.0',
    scripts: { test: 'node test.js' },
  }, null, 2));
  r = runTool(initDir, ['init']);
  const inited = JSON.parse(fs.readFileSync(path.join(initDir, 'package.json'), 'utf8'));
  assert(r.status === 0 && /publish-preflight is on the publish path/.test(r.out), 'init exits 0');
  assert(!/1\/3 pack/.test(r.out), 'init does not pack');
  assert(inited.scripts.prepublishOnly === 'npx --yes @ricardodevs/publish-preflight', 'init adds prepublishOnly');
  assert(fs.existsSync(path.join(initDir, '.cursor', 'skills', 'publish-preflight', 'SKILL.md')), 'init writes Cursor skill');

  // 14. init chains an existing prepublishOnly
  const chainDir = path.join(TMP, 'chain-pkg');
  writeFile(chainDir, 'package.json', JSON.stringify({
    name: 'chain-pkg',
    version: '1.0.0',
    scripts: { prepublishOnly: 'npm run build' },
  }, null, 2));
  r = runTool(chainDir, ['init']);
  const chained = JSON.parse(fs.readFileSync(path.join(chainDir, 'package.json'), 'utf8'));
  assert(r.status === 0, 'init chain exits 0');
  assert(
    chained.scripts.prepublishOnly === 'npm run build && npx --yes @ricardodevs/publish-preflight',
    'init appends to existing prepublishOnly',
  );

  // 15. init is idempotent
  r = runTool(chainDir, ['init']);
  const again = JSON.parse(fs.readFileSync(path.join(chainDir, 'package.json'), 'utf8'));
  assert(r.status === 0 && /already runs publish-preflight/.test(r.out), 'init reports already wired');
  assert(again.scripts.prepublishOnly === chained.scripts.prepublishOnly, 'init does not duplicate the hook');

  // 16. init uses the local bin name when the package is already a dependency
  const depDir = path.join(TMP, 'dep-pkg');
  writeFile(depDir, 'package.json', JSON.stringify({
    name: 'dep-pkg',
    version: '1.0.0',
    devDependencies: { '@ricardodevs/publish-preflight': '0.3.0' },
  }, null, 2));
  r = runTool(depDir, ['init']);
  const depped = JSON.parse(fs.readFileSync(path.join(depDir, 'package.json'), 'utf8'));
  assert(depped.scripts.prepublishOnly === 'publish-preflight', 'init uses local bin when installed');

  // 17. init --ci writes a workflow once
  const ciDir = path.join(TMP, 'ci-pkg');
  writeFile(ciDir, 'package.json', JSON.stringify({
    name: 'ci-pkg',
    version: '1.0.0',
  }, null, 2));
  r = runTool(ciDir, ['init', '--ci']);
  const wf = path.join(ciDir, '.github', 'workflows', 'publish-preflight.yml');
  assert(r.status === 0 && fs.existsSync(wf), 'init --ci writes GitHub Actions workflow');
  fs.writeFileSync(wf, 'stay\n');
  r = runTool(ciDir, ['init', '--ci']);
  assert(fs.readFileSync(wf, 'utf8') === 'stay\n', 'init --ci does not overwrite an existing workflow');

  // 18. --ci without init fails
  r = runTool(goodDir, ['--ci']);
  assert(r.status === 1 && /only valid with init/.test(r.out), '--ci without init fails');

  // 19. this package packs and smokes as a consumer would
  r = runTool(path.join(__dirname, '..'));
  assert(r.status === 0 && /pass — packed artifact/.test(r.out), 'this package passes its own preflight');
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
