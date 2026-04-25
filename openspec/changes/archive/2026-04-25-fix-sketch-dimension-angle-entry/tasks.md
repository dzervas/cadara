## 1. Spec and Dimension Intent

- [x] 1.1 Add the OpenSpec proposal, design, and spec deltas for angle dimension value entry, placement clicks, and current dimension labels.
- [x] 1.2 Add a shared Dimension-tool intent classifier that identifies single local line selections as length dimensions and non-parallel line pairs as angle dimensions.

## 2. Authoring and Editing Behavior

- [x] 2.1 Use the classifier for Dimension-tool preview/value metadata, line-length commits, and angle UI degree to durable radian conversion on commit.
- [x] 2.2 Seed committed line-angle annotation edits in degrees and convert edited values back to radians on save.
- [x] 2.3 Ensure primary viewport clicks while a value-backed dimension is waiting for placement pin the preview and open value entry before target selection or clearing.

## 3. Annotation Labels and Glyphs

- [x] 3.1 Add angle dimension annotation glyph metadata and icon mapping.
- [x] 3.2 Replace deprecated user-facing dimension detail labels with current measurement wording while keeping visible chips compact.

## 4. Verification

- [x] 4.1 Add Bun regression tests for single-edge line length dimensions, non-parallel line angle value entry, degree/radian conversion, click-to-place behavior, and updated annotation labels/glyphs.
- [x] 4.2 Run `openspec validate fix-sketch-dimension-angle-entry --strict`.
- [x] 4.3 Run `bun run test`, `bun run lint`, and `bun run build`.
