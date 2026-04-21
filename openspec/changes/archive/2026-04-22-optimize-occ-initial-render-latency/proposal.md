## Why

Opening a document currently blocks initial usable render while the OpenCascade runtime initializes and the first render snapshot is built, with observed delays over 10 seconds. The app needs to keep the viewport responsive, show explicit progress, and avoid repeating expensive OCC and tessellation work on the main thread.

## What Changes

- Eagerly start OpenCascade initialization when the app mounts instead of waiting for the first modeling action.
- Show a whole-viewport loading state while the initial OCC-backed document render is not ready.
- Move OCC runtime initialization, tessellation, and snapshot building into a dedicated Web Worker using the existing `worker` initialization hook where supported.
- Transfer mesh buffers from worker to main thread without structured-cloning large typed arrays.
- Cache OCC WASM and worker assets reliably through browser cache headers and/or an explicit service worker strategy.
- Coarsen default viewport tessellation and add camera-distance-aware LOD so startup and far-view meshes are cheaper while close inspection can refine geometry.
- Evaluate whether the current OpenCascade package path supports WASM streaming compilation, and use it only if compatible with the package and deployment targets.

## Capabilities

### New Capabilities

- `occ-initial-render-latency`: Defines startup responsiveness, OCC worker offload, render loading state, asset caching, and tessellation LOD expectations for OCC-backed documents.

### Modified Capabilities

None.

## Impact

- Affected runtime code: `src/App.tsx`, OCC runtime loading, worker bootstrap, modeling service/kernel adapter integration, and snapshot/render export code under `src/domain/modeling/occ/`.
- Affected UI: viewport loading state and render-idle behavior during initial document load.
- Affected deployment/runtime assets: OCC WASM, OCC worker script resolution, service worker or static asset cache policy, and Vite build output.
- Affected data movement: render mesh payloads must support transferable typed-array buffers across the worker boundary.
- Affected tests: `bun:test` coverage for eager initialization, worker initialization options, tessellation defaults/LOD policy, cache registration policy, and loading-state behavior.
