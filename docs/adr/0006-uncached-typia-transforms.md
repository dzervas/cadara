# Disable the legacy Typia transform output cache

Keep `cache: false` in the shared Typia plugin options even though repeated transformations cost startup and build time. The legacy plugin's output cache can reuse a validator after an imported type changes while the validator's primary source remains unchanged, so faster cached transforms can silently validate the wrong contract. This is a correctness decision, not a claimed fix for the separate historical malformed-transform syntax report; a future cache or toolchain replacement must prove imported-type invalidation rather than merely make builds faster.

The setting is in [`createTypiaPluginOptions`](../../typia-plugin-options.ts); the [production-options regression](../../src/contracts/shared/typia-transform-sentinel.spec.ts) checks an unchanged validator source against changed imported types, including a cold process. That regression covers the shared options, which the dev server, Vitest, the Bun CLI preload and the CLI bundle use.

## Amendment: cached production builds (2026-10-29)

`vite build` (Vite `apply: "build"`, through [`createTypiaVitePlugins`](../../typia-plugin-options.ts)) runs Typia with `cache: true`. `cache: false` also disables the plugin's in-process parsed-source cache, so every transformed file re-parsed its whole import graph: a production build took about 62 s uncached and about 39 s cached from an empty cache (local measurement). Deploy builds on Cloudflare Workers Builds start from a fresh checkout and persist only Bun's install cache, never `node_modules/.cache`, so they cannot reuse a stale validator. A local `vite build` (including `build:single` and the offline E2E build) can: after changing a type imported by a validator source, delete `node_modules/.cache/unplugin_typia` before trusting a local production build.

Historical rationale: `cadara-d84`, terminal disposition comment “Scope / controls” and “Conclusion / hypotheses / reopen conditions”, distinguishes the cache-staleness repair from the unreproduced syntax report; `cadara-1wb`, description, records the cost and qualification requirements for replacing the legacy integration.
