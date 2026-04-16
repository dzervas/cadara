## 1. BVH Foundation

- [x] 1.1 Integrate drei's `<Bvh>` into the current React Three Fiber viewport and wire it to the supported geometry subtree.
- [x] 1.2 Identify the renderable geometry classes that should use BVH in the first pass and document any intentionally unaccelerated helper paths.
- [x] 1.3 Ensure viewport renderables that benefit from acceleration are composed inside the BVH-managed subtree.

## 2. Picking Integration

- [x] 2.1 Route viewport hover and selection raycasts through the drei `<Bvh>`-accelerated path for supported geometry.
- [x] 2.2 Preserve existing durable target binding, selection filtering, and hover-resolution behavior on top of the accelerated intersections.
- [x] 2.3 Ensure BVH state rebuilds or invalidates correctly when the viewport render scene changes.

## 3. Verification

- [x] 3.1 Add or update tests covering hover and selection parity with BVH enabled.
- [x] 3.2 Add denser-scene viewport coverage to guard against picking regressions under higher geometry counts.
- [x] 3.3 Remove redundant unaccelerated mesh raycast glue once parity verification passes.
