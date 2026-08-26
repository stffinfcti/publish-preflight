# publish-preflight

Would this install for a stranger? Run this before `npm publish`.

```bash
npx @ricardodevs/publish-preflight
```

It packs the tarball, installs that tarball in a temp directory, and smoke-tests each `bin` (or `require`/`import` for libraries). Exit 0 if a consumer would be fine. Exit 1 if they would not.

## Sit on the publish path

```bash
npx @ricardodevs/publish-preflight init
```

That adds a `prepublishOnly` hook (so `npm publish` runs it) and a Cursor skill (so an agent runs it before it ships). `init --ci` also writes a GitHub Actions check.

```json
{
  "scripts": {
    "prepublishOnly": "npx --yes @ricardodevs/publish-preflight"
  }
}
```

If you already have a `prepublishOnly` script, init appends with `&&`.

## What it checks

1. **Pack** — `npm pack`, then every `bin` / `main` / `module` / `types` /
   `exports` path is actually in the tarball
2. **Install** — install that tarball into a fresh prefix (not `npm link`, not
   the working tree)
3. **Smoke** — run each bin (default `--help`); reject CRLF shebangs and missing
   shebangs. If there is no `bin`, `require()` / `import()` the package

Bins are invoked with `--help` by default so a CLI that starts work on no-args
does not hang the gate. Override with `--cmd`. Each bin is killed after 15s.

```bash
publish-preflight --cmd "--version"
publish-preflight --cmd ""          # no args
```

Node 18+. No runtime dependencies.
