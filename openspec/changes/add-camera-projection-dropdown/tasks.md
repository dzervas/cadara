## 1. Camera Projection Support

- [ ] 1.1 Introduce a typed viewport projection mode with `orthographic` as the default.
- [ ] 1.2 Generalize viewport camera refs and navigation helpers to support both `THREE.OrthographicCamera` and `THREE.PerspectiveCamera`.
- [ ] 1.3 Preserve camera position, target, up vector, and view direction when switching projection modes.
- [ ] 1.4 Update sketch camera framing so orthographic projection fits sketch extents through orthographic scale/zoom while perspective framing keeps field-of-view distance behavior.

## 2. Projection Dropdown UI

- [ ] 2.1 Add a compact Mantine projection dropdown under and right-aligned with the view cube overlay.
- [ ] 2.2 Use `public/icons/view-cube.svg` as the dropdown trigger icon with accessible labeling.
- [ ] 2.3 Wire `Orthographic` and `Perspective` menu options to the active viewport projection mode and show the current mode.
- [ ] 2.4 Ensure the dropdown and view cube do not intercept unrelated canvas, sketch, picking, or annotation interactions.

## 3. Verification

- [ ] 3.1 Add or update focused tests for orthographic default projection and projection mode switching.
- [ ] 3.2 Add or update tests covering view-cube snapping without changing the active projection mode.
- [ ] 3.3 Run `bun run test`.
- [ ] 3.4 Run `bun run lint`.
- [ ] 3.5 Run `bun run build`.
