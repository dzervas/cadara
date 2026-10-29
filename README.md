# CADara

CADara is an open-source, browser based CAD application. Everything happens on the browser, you can use it completely offline.

[Give it a spin!](https://cadara.app/app)

## Development and deployment

The toolchain is Bun (version in `package.json` `packageManager`). With
[devenv](https://devenv.sh), `devenv shell` (or direnv) provides it plus
Playwright's chromium and fonts; without devenv, install Bun and run
`bunx playwright install chromium` once for the E2E lane.

```sh
bun install --frozen-lockfile
bun run dev
```

`/` is the landing page; `/app` is the editor. `bun run build` builds both,
including the landing used for unknown-page/404 responses, into `dist/`.
Cloudflare Workers Static Assets uses `wrangler.jsonc`; `wrangler deploy`
runs the same build. HTML paths canonicalize without trailing slashes, and
unknown pages display the landing with a real 404 status. Shared assets stay
at root URLs, so editor workers, icons, and offline caching also work at `/app`.

- `PLAYWRIGHT_GPU=1 bun run test:e2e` — opt into GPU-accelerated Chromium locally (default/CI stay on headless-shell SwiftShader).
- `bun run preview` — preview the Vite output.
- `bun run preview:cf` — build and serve it through the local Cloudflare runtime.
- `bun run test:e2e:cloudflare` — verify the built Cloudflare routes and editor handoff.
  The local emulator requires a runnable `workerd` binary; Nix environments may
  need a compatible patched binary through `MINIFLARE_WORKERD_PATH`.
- `bun run landing:models:build` — regenerate the CLI-built landing examples.

Landing source lives in `landing/`. `landing/examples/` contains only the three
native documents, preview meshes, and manifests, grouped by model. Rebuild
scripts in `landing/scripts/` keep intermediate recipes and logs in OS temporary
directories, not the served model folder. A complete model rebuild takes many
minutes; it is not part of the normal web build.

## Contracts for Bun consumers

Pin the public repository to a commit. Bun requires explicit trust to run a git
package's `prepare` script ([lifecycle documentation](https://bun.sh/docs/pm/lifecycle)):

```json
{
  "dependencies": { "cadara": "github:dzervas/cadara#<sha>" },
  "trustedDependencies": ["cadara"]
}
```

Run `bun install` with lifecycle scripts enabled (no `--ignore-scripts` or
`install.ignoreScripts = true` in the consumer). Preparation compiles the
contracts and their Typia validators into `dist/contracts`; the consumer needs
neither a Typia plugin nor CADara's Bun preload.

```ts
import { parseAuthoredModelDocument } from "cadara/contracts";
import type { CollaborativeDocument } from "cadara/contracts/documents";
import type { AuthoredModelDocument } from "cadara/contracts/modeling/authored-document";

const result = parseAuthoredModelDocument(JSON.parse(savedCadaraJson));
if (!result.ok) throw new Error(JSON.stringify(result.diagnostic));
```

`cadara/contracts/*` mirrors every production module under `src/contracts`
(without `.ts`; directory entries use `/index`). New contract modules are picked
up automatically at build time. The root subpath offers the authored-document
parser and its document/result types. `cadara/contracts/documents` is a separate,
type-only entry for the core-owned collaborative storage document; the runtime
contracts surface never imports core, application, or infrastructure modules.

For a local `file:` dependency, first run `bun run build:contracts` in the CADara
checkout: Bun does not run `prepare` for `file:` packages, and this repository's
`bunfig.toml` disables lifecycle scripts on its own installs. Generated JS and
portable declarations are not committed. The web build replaces `dist/`, so
re-run `build:contracts` after building the web app if using this checkout as a
local dependency. The separately built `cadara-cli` package is unchanged.
