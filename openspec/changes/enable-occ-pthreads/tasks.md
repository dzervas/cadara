## 1. Threaded OCC Build

- [ ] 1.1 Update `opencascade-recipe.yaml` and the custom OCC build flow to emit a pthread-enabled browser runtime plus any required helper-worker assets.
- [ ] 1.2 Refresh the app-owned OCC runtime artifacts and runtime loader assumptions so the threaded build resolves the correct wasm and helper-worker URLs.

## 2. Browser Runtime Integration

- [ ] 2.1 Update browser OCC startup and worker runtime code to require the pthread-enabled runtime and to surface structured failures when required browser prerequisites are missing.
- [ ] 2.2 Remove non-threaded browser OCC startup fallbacks so mutations, snapshots, and warmup all target one threaded worker-owned runtime.

## 3. Environment And Asset Delivery

- [ ] 3.1 Add the required response-header and serving configuration for local dev, preview, and production so the browser page and OCC worker assets satisfy the threaded runtime policy contract.
- [ ] 3.2 Extend OCC asset caching and delivery rules to cover pthread helper-worker assets alongside `cadara-occ.js` and `cadara-occ.wasm`.

## 4. Validation And Measurement

- [ ] 4.1 Add or update focused validation coverage for threaded OCC startup, helper-worker asset resolution, and explicit failure behavior when prerequisites are not met.
- [ ] 4.2 Measure representative heavy OCC operations before and after the threaded runtime change and record whether pthread support delivers meaningful wins for this codebase.
