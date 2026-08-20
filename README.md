# publish-preflight

Pack the npm tarball, install it into a temp directory, and smoke-test what a
consumer would run: each `bin`, or `require`/`import` for libraries.

```bash
npx @ricardodevs/publish-preflight
npx @ricardodevs/publish-preflight ./path/to/package
```

Exit 0 if the packed artifact installs and loads. Exit 1 if it would not.

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

## Hook it to publish

```json
{
  "scripts": {
    "prepublishOnly": "npx @ricardodevs/publish-preflight"
  }
}
```

Node 18+. No runtime dependencies.
