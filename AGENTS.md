# AGENTS.md

## Cursor Cloud specific instructions

`publish-preflight` is a single, zero-runtime-dependency Node.js CLI (`bin/publish-preflight.js`). It packs an npm tarball, installs it into a throwaway prefix, and smoke-tests each `bin` (or `require`/`import` for libraries) as a consumer would. See `README.md` for the user-facing usage.

Non-obvious notes for working in this repo:

- No dependencies and no lockfile. There is nothing to install, so the update script is effectively a no-op. Do NOT run `npm ci` — it fails without a `package-lock.json`. Plain `npm install` is safe but unnecessary.
- Requires Node 18+ (`engines` in `package.json`); the environment ships Node 22.
- Tests: `npm test` (runs `node test/preflight.test.js`). It is a dependency-free self-test that spawns the CLI against synthetic fixtures under the OS temp dir — there is no test framework to install.
- No linter and no build step are configured. The `prepublishOnly` script runs the CLI on itself as a publish gate (`node ./bin/publish-preflight.js`).
- Run the app directly with `node bin/publish-preflight.js [package-dir]`. Dogfood it on this repo with `node bin/publish-preflight.js .` — a green run ends with `pass — packed artifact installed and loaded`.
- The CLI shells out to `npm pack`, `npm install`, and `tar`; these must be on `PATH` (they are in the default environment).
