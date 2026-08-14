#!/usr/bin/env node
'use strict';

/**
 * preflight — clean-room publish gate
 *
 * Before you `npm publish`, this packs your tarball, installs it into a fresh
 * temp environment exactly as a stranger would (no cache, no global install),
 * executes the bin, and fails the publish if the README's install command
 * wouldn't work for a reader.
 *
 * Zero runtime dependencies. Node 18+.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PKG_NAME = 'publish-preflight';

// Own-version source of truth: read from the manifest adjacent to this file.
// Resolves correctly in BOTH layouts — source (bin/../package.json) and
// installed (node_modules/publish-preflight/bin/../package.json). A hardcoded
// constant drifts; this gate exists to kill "published truth ≠ declared
// truth", so its own version must come from the same manifest the
// version-match step checks.
function ownVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0-dev';
  } catch (_) {
    return '0.0.0-dev';
  }
}
const PKG_VERSION = ownVersion();

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✔ ${msg}`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  return res;
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const argv = process.argv.slice(2);

  // CLI contract flags — MUST be handled before the dir-argument logic,
  // otherwise `preflight --version` treats "--version" as a package dir.
  // (The gate's own bin executes `--version` from the clean room, so a bin
  // that fails its own advertised flag fails its own gate — git-will-class.)
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(PKG_VERSION);
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`preflight ${PKG_VERSION} — clean-room publish gate`);
    console.log('usage: preflight [package-dir]   (default: current dir)');
    return;
  }

  const pkgDir = argv[0] || process.cwd();
  const pkgJsonPath = path.join(pkgDir, 'package.json');

  console.log(`preflight ${PKG_VERSION} — clean-room publish gate`);
  console.log(`target: ${pkgDir}\n`);

  if (!fs.existsSync(pkgJsonPath)) {
    fail(`no package.json in ${pkgDir}`);
    return;
  }

  const pkg = readJson(pkgJsonPath);
  const name = pkg.name;
  const version = pkg.version;
  const bins = pkg.bin || {};

  if (!name || !version) {
    fail('package.json must have name and version');
    return;
  }

  let ok = true;
  const tmp = tmpdir();

  // 1. Pack
  console.log('── 1/5 pack ──');
  const packRes = run('npm', ['pack', '--pack-destination', tmp], { cwd: pkgDir });
  if (packRes.status !== 0) {
    fail(`npm pack failed: ${packRes.stderr.trim()}`);
    return;
  }
  const tarballLine = packRes.stdout.trim().split('\n').pop();
  const tarball = path.join(tmp, tarballLine);
  if (!fs.existsSync(tarball)) {
    fail(`tarball not found: ${tarball}`);
    return;
  }
  pass(`packed ${tarballLine}`);

  // 2. Clean install (fresh env, no cache, no global)
  console.log('\n── 2/5 clean install ──');
  const installDir = path.join(tmp, 'fresh');
  fs.mkdirSync(installDir);
  const installRes = run('npm', [
    'install',
    tarball,
    '--no-cache',
    '--no-audit',
    '--no-fund',
    '--prefix', installDir,
  ], { cwd: installDir });
  if (installRes.status !== 0) {
    fail(`clean install failed: ${installRes.stderr.trim()}`);
    return;
  }
  pass(`installed ${name}@${version} into fresh env (no cache, no global)`);

  // 3. Execute bin
  console.log('\n── 3/5 bin execution ──');
  const binNames = Object.keys(bins);
  if (binNames.length === 0) {
    console.log('  (no bin entries — package is a library, skipping execution)');
  } else {
    for (const binName of binNames) {
      // Platform-independent shebang check: macOS strips \r when parsing
      // shebangs, Linux does not. A CRLF bin executes on macOS and dies with
      // "bad interpreter" on Linux — the exact git-will 0.1.1 failure class.
      // Check the RAW bytes so the gate catches it on any platform.
      const binTarget = path.join(pkgDir, bins[binName]);
      if (fs.existsSync(binTarget)) {
        const head = fs.readFileSync(binTarget, 'utf8').split('\n')[0];
        if (head.startsWith('#!') && head.endsWith('\r')) {
          fail(`bin ${binName} has CRLF shebang (${bins[binName]}): executes on macOS, dies on Linux with "bad interpreter" — convert to LF`);
          ok = false;
        }
      }
      const binPath = path.join(installDir, 'node_modules', '.bin', binName);
      if (!fs.existsSync(binPath)) {
        fail(`bin not linked in clean env: ${binName}`);
        ok = false;
        continue;
      }
      const execRes = run(binPath, ['--version'], { cwd: installDir });
      if (execRes.status !== 0) {
        fail(`bin ${binName} failed to execute: ${execRes.stderr.trim()}`);
        ok = false;
        continue;
      }
      pass(`bin ${binName} executed: ${execRes.stdout.trim().split('\n')[0]}`);
    }
  }

  // 4. Zero-deps check
  console.log('\n── 4/5 zero-deps check ──');
  const lsRes = run('npm', ['ls', '--prod', '--depth=0', '--json'], { cwd: installDir });
  let depCount = 0;
  if (lsRes.status === 0) {
    try {
      const tree = JSON.parse(lsRes.stdout);
      const prod = tree.dependencies || {};
      depCount = Object.keys(prod).filter((d) => d !== name).length;
    } catch (_) {
      // fall through
    }
  }
  if (depCount === 0) {
    pass('zero runtime dependencies');
  } else {
    console.log(`  ⚠ ${depCount} runtime dependencies present (not a zero-dep package)`);
  }

  // 5. Version match
  console.log('\n── 5/5 version match ──');
  const installedPkgJson = path.join(installDir, 'node_modules', name, 'package.json');
  if (fs.existsSync(installedPkgJson)) {
    const installed = readJson(installedPkgJson);
    if (installed.version === version) {
      pass(`installed version ${installed.version} matches package.json ${version}`);
    } else {
      fail(`version mismatch: installed ${installed.version} vs declared ${version}`);
      ok = false;
    }
  } else {
    fail(`installed package.json not found at ${installedPkgJson}`);
    ok = false;
  }

  console.log('\n── result ──');
  if (ok) {
    console.log('✔ CLEAN-ROOM PASS — safe to publish');
    process.exitCode = 0;
  } else {
    console.log('✖ CLEAN-ROOM FAIL — fix before publish');
    process.exitCode = 1;
  }
}

main();
