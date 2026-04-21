## 1. Eager OCC Startup and Viewport Loading State

- [x] 1.1 Add an OCC preload entrypoint that starts the current OCC runtime owner on browser app mount, uses `getOpenCascadeInstance()` only for the temporary direct-adapter path, and does not create duplicate loads when called repeatedly.
- [x] 1.2 Call the preload entrypoint from `src/App.tsx` and keep initialization errors routed through the existing reported error path.
- [x] 1.3 Add viewport/editor state for "first OCC-backed render pending" and show a whole-viewport loading indicator until the first workspace snapshot is ready.
- [x] 1.4 Add `bun:test` coverage proving eager preload starts without a user action, retries or reports failures correctly, and the viewport loading state clears after the first snapshot.

## 2. OCC Worker Runtime

- [x] 2.1 Define a typed request/response protocol for OCC preload, document rebuild, workspace snapshot build, and worker failure messages.
- [x] 2.2 Add an OCC module worker that owns the OpenCascade instance and initializes it with configured WASM and worker asset URLs where the package supports them.
- [x] 2.3 Add a main-thread OCC worker client that exposes the modeling/kernel operations needed by the current `OpenCascadeKernelAdapter` integration.
- [x] 2.4 Route browser OCC initialization, tessellation, and snapshot building through the worker client while preserving a direct adapter path for Node tests.
- [x] 2.5 Add tests for worker initialization success, worker initialization failure, request cancellation or supersession, and parity with the direct OCC adapter for representative snapshots.

## 3. Transferable Mesh Payloads

- [x] 3.1 Add an internal packed mesh transport shape using typed arrays for vertex positions, vertex normals, and triangle indices, with owned packed buffers or explicit `byteOffset`, `byteLength`, and element-count metadata for every transferred view.
- [x] 3.2 Update worker snapshot responses to include mesh `ArrayBuffer`s in the `postMessage` transfer list.
- [x] 3.3 Reconstruct the existing public render geometry records on the main thread from transferred packed meshes.
- [x] 3.4 Add tests that large mesh buffers are transferred instead of structured-cloned and that reconstructed render records remain contract-compatible.

## 4. OCC Asset Caching and Streaming Compatibility

- [x] 4.1 Audit local and deployed OCC WASM/worker URL resolution, including the existing CDN-backed entry path and Vite asset output.
- [x] 4.2 Add a narrow cache strategy for OCC WASM and worker assets using immutable cache headers where available and a versioned service worker cache when headers are not sufficient.
- [x] 4.3 Ensure app-served WASM responses use `application/wasm` so the package's `WebAssembly.instantiateStreaming` path remains available.
- [x] 4.4 Add tests or build-time assertions covering OCC asset URLs, cache versioning, service worker registration scope, and streaming-compatible MIME configuration.

## 5. Coarse Tessellation and Adaptive LOD

- [x] 5.1 Add named tessellation tiers with explicit linear deflection and angular deflection units, including a unit audit for OCC's angular parameter and documented conversion from degree-equivalent product settings to the OCC API unit.
- [x] 5.2 Change initial body and sketch-region viewport tessellation to use a coarse startup tier with 0.5 to 1.0 model-unit linear deflection and 1.0 to 2.0 degree-equivalent angular deflection unless the unit audit proves the existing angular value is already coarser.
- [x] 5.3 Add camera-driven body LOD selection so far bodies use coarse meshes and close bodies can request finer meshes without changing topology bindings.
- [x] 5.4 Add tests for tier selection, unit conversion, initial coarse tessellation, zoom-triggered fine refinement, and durable selection target preservation.

## 6. Verification

- [x] 6.1 Run `bun run test` and address failures.
- [x] 6.2 Run `bun run lint` and address failures.
- [x] 6.3 Run `bun run build` and address failures.
