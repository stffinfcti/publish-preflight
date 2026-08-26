'use strict';

const fs = require('fs');
const path = require('path');

const NPX = 'npx --yes @ricardodevs/publish-preflight';
const LOCAL = 'publish-preflight';

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✔ ${msg}`);
}

function alreadyWired(script) {
  return typeof script === 'string' && /publish-preflight/.test(script);
}

function commandFor(pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  if (deps && deps['@ricardodevs/publish-preflight']) return LOCAL;
  return NPX;
}

function chainPrepublish(existing, command) {
  if (!existing || !String(existing).trim()) return command;
  if (alreadyWired(existing)) return existing;
  return `${existing} && ${command}`;
}

function detectIndent(raw) {
  const m = raw.match(/\n([ \t]+)"/);
  return m ? m[1] : '  ';
}

function readSkill() {
  const skillPath = path.join(__dirname, '..', 'skills', 'publish-preflight', 'SKILL.md');
  return fs.readFileSync(skillPath, 'utf8');
}

function workflowYaml() {
  return `name: publish-preflight

on:
  pull_request:
  push:
    branches: [main, master]

jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: npm run build --if-present
      - run: npx --yes @ricardodevs/publish-preflight
`;
}

function writeFile(abs, body) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function runInit(dir, opts = {}) {
  const ci = Boolean(opts.ci);
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fail(`no package.json in ${dir}`);
    return;
  }

  let raw;
  let pkg;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
    pkg = JSON.parse(raw);
  } catch (e) {
    fail(`invalid package.json: ${e.message}`);
    return;
  }

  const command = commandFor(pkg);
  pkg.scripts = pkg.scripts || {};
  const before = pkg.scripts.prepublishOnly;
  const after = chainPrepublish(before, command);
  const scriptChanged = before !== after;
  if (scriptChanged) {
    pkg.scripts.prepublishOnly = after;
    const indent = detectIndent(raw);
    const next = `${JSON.stringify(pkg, null, indent)}\n`;
    fs.writeFileSync(pkgPath, next);
    if (before) pass(`prepublishOnly: ${after}`);
    else pass(`added scripts.prepublishOnly: ${after}`);
  } else {
    pass('prepublishOnly already runs publish-preflight');
  }

  const skillDest = path.join(dir, '.cursor', 'skills', 'publish-preflight', 'SKILL.md');
  writeFile(skillDest, readSkill());
  pass(`wrote ${path.relative(dir, skillDest) || skillDest}`);

  if (ci) {
    const wfDest = path.join(dir, '.github', 'workflows', 'publish-preflight.yml');
    if (fs.existsSync(wfDest)) {
      pass('.github/workflows/publish-preflight.yml already exists');
    } else {
      writeFile(wfDest, workflowYaml());
      pass(`wrote ${path.relative(dir, wfDest)}`);
    }
  }

  console.log('\n── result ──');
  console.log('✔ pass — publish-preflight is on the publish path');
  if (!ci) {
    console.log('  (add --ci to also write a GitHub Actions check)');
  }
  process.exitCode = 0;
}

module.exports = { runInit, chainPrepublish, commandFor, alreadyWired };
