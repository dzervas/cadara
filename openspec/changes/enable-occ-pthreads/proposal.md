## Why

The browser OCC runtime currently runs inside a dedicated worker, but the custom OpenCascade build is still single-threaded. That leaves heavy meshing, rebuild, and export work bound to one core even though the architecture already pays the complexity cost of moving OCC off the main thread.

## What Changes

- Rebuild the custom browser OpenCascade distribution with Emscripten pthread support and make that threaded build the only supported browser OCC runtime.
- Require the browser OCC startup path to run only when the page and worker environment satisfy the platform prerequisites for shared-memory WebAssembly threading.
- Update browser runtime loading, worker asset delivery, and deployment headers so the pthread-enabled OCC runtime and its helper worker assets load correctly in dev, preview, and production.
- **BREAKING** Remove support for non-threaded browser OCC initialization paths instead of preserving a fallback runtime with different performance and platform behavior.
- Add proposal-level validation and benchmarking work so the change measures whether representative OCC operations materially benefit from pthread execution before follow-on tuning.

## Capabilities

### New Capabilities
- `occ-browser-threading`: Defines the browser platform, asset-loading, and failure-mode requirements for a pthread-enabled OCC runtime.

### Modified Capabilities
- `occ-kernel-adapter`: The browser OCC adapter runtime requirements change because the authoritative browser runtime owner must target the threaded OCC build and reject unsupported platform environments explicitly.
- `occ-initial-render-latency`: OCC startup and asset delivery requirements change because the warm path must initialize the pthread-enabled runtime and serve any additional worker assets needed by that runtime.

## Impact

- Affected code: `opencascade-recipe.yaml`, `public/cadara-occ.*`, `src/domain/modeling/occ/runtime.ts`, `src/domain/modeling/occ/worker-runtime.ts`, `src/domain/modeling/occ/worker.ts`, `src/infrastructure/occ/browser-kernel-runtime.ts`, `vite.config.ts`, and deployment configuration such as `wrangler.jsonc`.
- Affected systems: browser worker startup, runtime asset caching, deployment response headers, local dev/preview serving, and OCC load-time measurement harnesses.
- External dependencies: Emscripten pthread worker delivery, browser shared-memory requirements, and same-origin worker asset serving.
