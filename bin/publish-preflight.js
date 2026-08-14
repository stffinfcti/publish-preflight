#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SMOKE_TIMEOUT_MS = 15_000;
const NPM_TIMEOUT_MS = 120_000;

function ownVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0-dev';
  } catch (_) {
    return '0.0.0-dev';
  }
}

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✔ ${msg}`);
}

function run(cmd, args, opts = {}) {
  const { timeout = NPM_TIMEOUT_MS, ...rest } = opts;
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    killSignal: 'SIGKILL',
    ...rest,
  });
}

function runError(res, label) {
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return `${label} timed out`;
    if (res.error.code === 'ENOENT') return `${label}: command not found`;
    return `${label}: ${res.error.message}`;
  }
  if (res.signal) return `${label} killed (${res.signal})`;
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    return `${label} failed (exit ${res.status})${detail ? `: ${detail}` : ''}`;
  }
  return null;
}

function parseArgs(argv) {
  const out = { cmd: ['--help'], dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version' || a === '-v') return { version: true };
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--cmd') {
      if (i + 1 >= argv.length) {
        return { error: '--cmd requires a value (use --cmd "" for no args)' };
      }
      const val = argv[++i];
      out.cmd = val.trim() === '' ? [] : val.trim().split(/\s+/);
      continue;
    }
    if (a.startsWith('-')) return { error: `unknown flag: ${a}` };
    if (out.dir) return { error: `unexpected extra argument: ${a}` };
    out.dir = a;
  }
  out.dir = path.resolve(out.dir || process.cwd());
  return out;
}

function printHelp(version) {
  console.log(`publish-preflight ${version}
pack, install, and smoke-test an npm package as a consumer would

usage: publish-preflight [package-dir]
       publish-preflight --cmd "--version" [package-dir]
       publish-preflight --cmd "" [package-dir]

--cmd <args>   arguments passed to each bin (default: --help)
               empty string runs the bin with no args`);
}

function normalizeBins(pkg) {
  if (!pkg.bin) return {};
  if (typeof pkg.bin === 'string') return { [pkg.name]: pkg.bin };
  if (typeof pkg.bin === 'object' && !Array.isArray(pkg.bin)) return { ...pkg.bin };
  return {};
}

function relFile(p) {
  return String(p).replace(/^\.\//, '').replace(/\\/g, '/');
}

function collectDeclaredFiles(pkg) {
  const out = [];
  const bins = normalizeBins(pkg);
  for (const [name, binPath] of Object.entries(bins)) {
    if (typeof binPath === 'string') out.push({ label: `bin ${name}`, rel: binPath });
  }
  for (const field of ['main', 'module', 'types', 'typings']) {
    if (typeof pkg[field] === 'string') out.push({ label: field, rel: pkg[field] });
  }
  walkExports(pkg.exports, '', out);
  return out;
}

function walkExports(exp, trail, out) {
  if (typeof exp === 'string') {
    if (exp.startsWith('.') && !exp.includes('*')) {
      out.push({ label: `exports${trail}`, rel: exp });
    }
    return;
  }
  if (Array.isArray(exp)) {
    exp.forEach((item, i) => walkExports(item, `${trail}[${i}]`, out));
    return;
  }
  if (exp && typeof exp === 'object') {
    for (const [key, val] of Object.entries(exp)) {
      walkExports(val, `${trail}["${key}"]`, out);
    }
  }
}

function parsePackJson(stdout) {
  const raw = stdout.trim();
  const bracket = raw.indexOf('[');
  const brace = raw.indexOf('{');
  let start = -1;
  if (bracket !== -1 && (brace === -1 || bracket < brace)) start = bracket;
  else start = brace;
  if (start === -1) throw new Error('npm pack --json produced no JSON');
  const data = JSON.parse(raw.slice(start));
  const info = Array.isArray(data) ? data[0] : data;
  if (!info || !info.filename) throw new Error('npm pack --json missing filename');
  return info;
}

function firstLine(text) {
  const nl = text.indexOf('\n');
  return nl === -1 ? text : text.slice(0, nl);
}

function checkInstalledBinFile(filePath, binName) {
  if (!fs.existsSync(filePath)) {
    return `bin ${binName} missing from installed package`;
  }
  if (!fs.statSync(filePath).isFile()) {
    return `bin ${binName} is not a file`;
  }
  const head = firstLine(fs.readFileSync(filePath, 'utf8'));
  if (head.startsWith('#!') && head.endsWith('\r')) {
    return `bin ${binName} has a CRLF shebang (dies on Linux with "bad interpreter")`;
  }
  if (!head.startsWith('#!')) {
    return `bin ${binName} has no shebang`;
  }
  return null;
}

function resolveBinShim(installDir, binName) {
  const base = path.join(installDir, 'node_modules', '.bin', binName);
  if (process.platform === 'win32') {
    const cmd = `${base}.cmd`;
    if (fs.existsSync(cmd)) return cmd;
  }
  return base;
}

function smokeLibrary(installDir, name) {
  const script = `
'use strict';
const name = ${JSON.stringify(name)};
try {
  require(name);
} catch (e) {
  if (e.code !== 'ERR_REQUIRE_ESM' && e.code !== 'ERR_REQUIRE_ASYNC_MODULE') {
    console.error(e);
    process.exit(1);
  }
  import(name).then(() => {}, (err) => {
    console.error(err);
    process.exit(1);
  });
}
`;
  return run('node', ['-e', script], { cwd: installDir, timeout: SMOKE_TIMEOUT_MS });
}

function resultBanner(ok) {
  console.log('\n── result ──');
  if (ok) {
    console.log('✔ pass — packed artifact installed and loaded');
    process.exitCode = 0;
  } else {
    console.log('✖ fail — not safe to publish');
    process.exitCode = 1;
  }
}

function main() {
  const version = ownVersion();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp(version);
    return;
  }
  if (args.version) {
    console.log(version);
    return;
  }
  if (args.error) {
    fail(args.error);
    return;
  }

  const pkgDir = args.dir;
  const pkgJsonPath = path.join(pkgDir, 'package.json');

  console.log(`publish-preflight ${version}`);
  console.log(`target: ${pkgDir}\n`);

  if (!fs.existsSync(pkgJsonPath)) {
    fail(`no package.json in ${pkgDir}`);
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  } catch (e) {
    fail(`invalid package.json: ${e.message}`);
    return;
  }

  if (!pkg.name || !pkg.version) {
    fail('package.json must have name and version');
    return;
  }

  const bins = normalizeBins(pkg);
  let ok = true;
  let tmp;

  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-preflight-'));

    console.log('── 1/3 pack ──');
    const packRes = run('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: pkgDir });
    const packErr = runError(packRes, 'npm pack');
    if (packErr) {
      fail(packErr);
      resultBanner(false);
      return;
    }

    let info;
    try {
      info = parsePackJson(packRes.stdout);
    } catch (e) {
      fail(e.message);
      resultBanner(false);
      return;
    }

    const tarball = path.join(tmp, info.filename);
    if (!fs.existsSync(tarball)) {
      fail(`tarball not found: ${tarball}`);
      resultBanner(false);
      return;
    }
    pass(`packed ${info.filename}`);

    const packed = new Set((info.files || []).map((f) => relFile(f.path || f)));
    const declared = collectDeclaredFiles(pkg);
    if (declared.length === 0) {
      console.log('  (no bin/main/exports paths to check)');
    } else {
      let filesOk = true;
      for (const { label, rel } of declared) {
        if (!packed.has(relFile(rel))) {
          fail(`${label} path "${rel}" is not in the tarball — check the "files" field`);
          ok = false;
          filesOk = false;
        }
      }
      if (filesOk) pass('declared bin/main/exports paths are in the tarball');
    }

    console.log('\n── 2/3 install ──');
    const installDir = path.join(tmp, 'fresh');
    fs.mkdirSync(installDir);
    const installRes = run('npm', [
      'install',
      tarball,
      '--no-cache',
      '--no-audit',
      '--no-fund',
      '--prefix',
      installDir,
    ], { cwd: installDir });
    const instErr = runError(installRes, 'npm install');
    if (instErr) {
      fail(instErr);
      resultBanner(false);
      return;
    }
    pass(`installed ${pkg.name}@${pkg.version}`);

    console.log('\n── 3/3 smoke ──');
    const binNames = Object.keys(bins);
    if (binNames.length === 0) {
      const smoke = smokeLibrary(installDir, pkg.name);
      const err = runError(smoke, `require/import ${pkg.name}`);
      if (err) {
        fail(err);
        ok = false;
      } else {
        pass(`require/import ${pkg.name} succeeded`);
      }
    } else {
      for (const binName of binNames) {
        const rel = bins[binName];
        if (typeof rel !== 'string') {
          fail(`bin ${binName} is not a string path`);
          ok = false;
          continue;
        }

        const installed = path.join(installDir, 'node_modules', pkg.name, relFile(rel));
        const shebangErr = checkInstalledBinFile(installed, binName);
        if (shebangErr) {
          fail(shebangErr);
          ok = false;
          if (!fs.existsSync(installed) || !fs.statSync(installed).isFile()) continue;
        }

        const shim = resolveBinShim(installDir, binName);
        if (!fs.existsSync(shim)) {
          fail(`bin not linked: ${binName}`);
          ok = false;
          continue;
        }

        const execOpts = { cwd: installDir, timeout: SMOKE_TIMEOUT_MS };
        if (process.platform === 'win32') execOpts.shell = true;
        const execRes = run(shim, args.cmd, execOpts);
        const invoked = args.cmd.length ? `${binName} ${args.cmd.join(' ')}` : binName;
        const err = runError(execRes, `bin ${invoked}`);
        if (err) {
          fail(err);
          ok = false;
          continue;
        }
        const first = (execRes.stdout || '').trim().split('\n')[0] || '(no output)';
        pass(`bin ${invoked} exited 0: ${first}`);
      }
    }

    resultBanner(ok);
  } catch (e) {
    fail(e.message || String(e));
    resultBanner(false);
  } finally {
    if (tmp) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  }
}

main();
