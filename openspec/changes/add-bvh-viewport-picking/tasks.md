## 1. BVH Foundation

- [ ] 1.1 Add the viewport BVH acceleration dependency and wire its Three.js integration into the current viewport runtime.
- [ ] 1.2 Identify the renderable geometry classes that should use BVH in the first pass and document any intentionally unaccelerated helper paths.
- [ ] 1.3 Build or attach BVH state when viewport renderables are converted into scene geometry.

## 2. Picking Integration

- [ ] 2.1 Route viewport hover and selection raycasts through the BVH-accelerated path for supported geometry.
- [ ] 2.2 Preserve existing durable target binding, selection filtering, and hover-resolution behavior on top of the accelerated intersections.
- [ ] 2.3 Ensure BVH state rebuilds or invalidates correctly when the viewport render scene changes.

## 3. Verification

- [ ] 3.1 Add or update tests covering hover and selection parity with BVH enabled.
- [ ] 3.2 Add denser-scene viewport coverage to guard against picking regressions under higher geometry counts.
- [ ] 3.3 Remove redundant unaccelerated mesh raycast glue once parity verification passes.
