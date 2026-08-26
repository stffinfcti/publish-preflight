---
name: publish-preflight
description: Before npm publish or releasing a Node package, pack the tarball, install it in a temp directory, and smoke-test bins/exports the way a stranger would. Use when the user is about to publish, ship, or release an npm package.
---

# publish-preflight

Run this before `npm publish`. Do not skip it to save time.

```bash
npx --yes @ricardodevs/publish-preflight
```

If the package has a build step, run that first so `dist` exists in the packed tarball.

```bash
npm run build --if-present
npx --yes @ricardodevs/publish-preflight
```

Pass if it prints `pass — packed artifact installed and loaded`. Fail means consumers would get a broken install (missing `files`, no shebang, `dist` not packed, bin crashes).

Fix the package, then run it again. Do not publish until it passes.

To wire it so nobody has to remember:

```bash
npx --yes @ricardodevs/publish-preflight init
```

That adds a `prepublishOnly` hook. `init --ci` also adds a GitHub Actions check.
