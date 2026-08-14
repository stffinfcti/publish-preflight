# publish-preflight

Clean-room publish gate for npm CLI tools. Before you `npm publish`, it packs
your tarball, installs it into a fresh temp environment **exactly as a stranger
would** (no cache, no global install), executes your bin, and fails the publish
if your README's install command wouldn't work for a reader.

## Install

```bash
npm install --global publish-preflight
# or
npx publish-preflight
```

## Usage

```bash
# verify the current directory before publishing
preflight

# verify a specific package directory
preflight ./path/to/package
```

Exit code 0 = clean-room pass, safe to publish. Exit code 1 = something a
stranger would hit — fix it first.

## What it checks

1. **Pack** — `npm pack` your tarball, exactly what the registry would receive
2. **Clean install** — installs into a fresh temp dir with `--no-cache`,
   no global install, no shared state — the stranger's environment
3. **Bin execution** — runs every `bin` entry with `--version`, proves the
   command a reader types actually executes (raw-byte shebang check included,
   so CRLF bins fail on any platform — the git-will failure class)
4. **Zero-deps check** — `npm ls --prod --depth=0` confirms your "zero
   dependencies" claim is true
5. **Version match** — installed version matches the manifest — the tool
   reads its own version from the manifest, so it can never lie about it

## Why

`git-will` v0.1.1 shipped with LF line-ending bugs that broke its `npx` bin —
it survived only by 55 minutes of luck between publish and post. Every OSS
author has shipped "works on my machine" and watched a launch die. This gate
makes the launch-gate checklist executable: install → run → fail before
publish, not after.

Zero runtime dependencies. Node 18+.
