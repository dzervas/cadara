## Context

The current app constructs `OpenCascadeKernelAdapter` on the main thread and only loads OCC through `getOpenCascadeInstance()` when kernel work first needs it. `createOpenCascadeInitializerFromMainJS` already accepts `mainWasm`, `worker`, and `module` settings, and the installed OpenCascade bundle already contains an `instantiateStreaming` path for browser WASM loads. Snapshot building currently calls `BRepMesh_IncrementalMesh_2` from `buildOccWorkspaceSnapshot` paths, so initial document render can combine WASM startup, geometry rebuild, tessellation, and render payload creation on the UI thread.

The change should be staged. Eager preload and viewport loading state are lower-risk improvements. Worker-backed OCC, transferable mesh buffers, and adaptive LOD touch cross-module contracts and need focused tests.

## Goals / Non-Goals

**Goals:**

- Start OCC loading at app startup and make initial render progress visible in the viewport.
- Keep OCC initialization, tessellation, and snapshot construction off the main thread in worker-capable browsers.
- Avoid copying large mesh buffers when posting render data from worker to main.
- Reduce initial tessellation cost with coarser startup meshes and adaptive refinement.
- Ensure OCC WASM and worker assets are cacheable and remain compatible with streaming compilation.

**Non-Goals:**

- Replacing OpenCascade.js or changing authored document semantics.
- Moving React state, Three.js rendering, or pointer interaction into the OCC worker.
- Requiring `SharedArrayBuffer` as the baseline path, because that would force cross-origin isolation before the worker design has proven it needs shared memory.
- Guaranteeing one absolute startup time across every device and network; the implementation should instead make the pipeline non-blocking, cacheable, and measurable.

## Decisions

1. Introduce an OCC runtime-owner preload API and call it from `App.tsx`.

   The first slice should call the existing singleton loader at mount time only while the direct main-thread adapter owns OCC, and it should surface pending/error state to the viewport. Once the worker adapter exists, the same preload entrypoint should warm the worker-owned OCC instance instead of creating a duplicate main-thread OCC runtime. Alternative considered: leave loading lazy and only add a spinner. That would clarify the delay but would not shorten the first useful document render.

2. Add a dedicated OCC worker facade rather than exposing worker details to React components.

   The main thread should talk to a typed worker client owned by the modeling/kernel layer. The worker owns OCC initialization, document rebuild execution, snapshot building, and tessellation. UI components should continue consuming `WorkspaceSnapshot` and render records through existing providers. Alternative considered: initialize OCC in an Emscripten worker only through the package `worker` option. That hook is useful when the package requests a worker asset, but it does not by itself move the app's snapshot-building calls off the main thread.

3. Use a packed internal mesh transfer protocol, then reconstruct the public render contract.

   The public render schema currently exposes point triplets and triangle triplets. The worker protocol should pack mesh positions, normals, and indices into typed arrays, use tightly owned buffers or explicit view metadata, include their `ArrayBuffer`s in the transfer list, and reconstruct the existing render geometry shape on the main thread until the public render contract is intentionally changed. Alternative considered: structured-clone existing nested arrays. That is simpler but keeps a large copy cost on the initial render path.

4. Implement cache strategy with a narrow OCC asset scope.

   Production should serve app-owned WASM and worker assets with immutable or long-lived cache headers when filenames are content-hashed. If deployment headers are not reliable for the OCC CDN/local asset path, add a small service worker cache for only OCC WASM and worker URLs, versioned by the OpenCascade package version or build manifest. Alternative considered: broad app shell service worker caching. That adds update complexity outside this performance fix.

5. Treat WASM streaming as an asset-serving compatibility concern.

   The bundled browser OCC code already attempts `WebAssembly.instantiateStreaming` and falls back to ArrayBuffer instantiation. The implementation should preserve that path by serving WASM as `application/wasm`, avoiding custom fetch wrappers that hide the `Response`, and testing the configured browser entry. Alternative considered: reimplement OCC WASM fetching with a custom `instantiateWasm` hook. That is higher risk and should only be used if measurement proves the package path cannot stream.

6. Add LOD tiers before fine-grained adaptive scheduling.

   Start with named tessellation tiers such as `startup/coarse`, `normal`, and `fine`, with an explicit unit audit for OCC angular deflection and documented conversion from degree-equivalent product settings to the OCC API unit. Initial render should use the coarse tier; camera-driven refinement can request finer meshes without changing topology. Alternative considered: continuous deflection values derived directly from camera distance. Tiers are easier to test and keep the initial LOD path explicit.

## Risks / Trade-offs

- Worker protocol drift from public contracts -> Keep message schemas small and covered by `bun:test`; reconstruct existing `WorkspaceSnapshot` shapes at the boundary.
- Duplicate OCC runtimes during migration -> Route preload through one runtime owner and remove main-thread eager loading once the worker client owns OCC.
- Service worker stale WASM -> Version cache names by build/package version and delete old OCC caches on activate.
- Coarse meshes may reduce visual quality or picking confidence -> Keep topology bindings authoritative, refine on zoom, and test selection still resolves durable targets.
- Angular deflection unit mismatch -> Audit OCC units before changing defaults and store tier values with explicit radians/degrees naming.
- Worker unavailable in test or legacy browser contexts -> Keep a direct adapter path for Node tests and surface a clear browser initialization error if the worker cannot start.

## Migration Plan

1. Add eager preload and viewport loading/error handling while keeping the current main-thread adapter.
2. Add the worker client and worker implementation behind the same modeling service boundary.
3. Move OCC initialization, rebuild, snapshot, and tessellation calls into the worker path.
4. Switch mesh transfer to packed typed arrays and verify render contract reconstruction.
5. Add OCC asset cache policy and confirm streaming-compatible WASM serving.
6. Add tessellation tiers, then camera-driven LOD requests.

Rollback can disable the worker client and LOD path behind a local runtime flag while preserving the eager preload/loading-state improvements.

## Open Questions

- Which production environment will own cache headers for app-served WASM and worker assets, and does the CDN path remain the default for deployed builds?
- What measured startup budget should be enforced in browser performance tests once the worker path is in place?
- Should the public render contract eventually accept packed typed arrays directly, or should that remain an internal worker transport detail?
