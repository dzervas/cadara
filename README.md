# CADara

CADara is an open-source, browser based CAD application. Everything happens on the browser, you can use it completely offline.

It uses OpenCascade for the time being which is delivered as a WASM binary (shoutout to the [OpenCascade.js team](https://ocjs.org/))

[Give it a spin!](https://cadara.app/app)

## Development and deployment

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

## State

The project is purely vibe-coded and that won't change until there are enough features to be able to call this application a full CAD solution.

With that said the solid and sketch operations, including 2D constraints, are there.
