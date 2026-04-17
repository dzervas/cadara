## 1. Snap Engine

- [x] 1.1 Add pure sketch-space candidate types for snap point, source references, candidate kind, priority, distance, and preview metadata.
- [x] 1.2 Implement endpoint, center, midpoint, nearest-on-line, nearest-on-circle, and nearest-on-arc candidates.
- [x] 1.3 Implement intersection, horizontal/vertical alignment, perpendicular foot, and deterministic tangent candidates.
- [x] 1.4 Add stable candidate ranking and active-candidate hysteresis.

## 2. Tool and Viewport Integration

- [x] 2.1 Feed local sketch geometry into the snap resolver during active sketch drawing.
- [x] 2.2 Feed projected reference geometry into the snap resolver when projection results are available.
- [x] 2.3 Use snapped coordinates for live tool preview and accepted draw points without committing inferred constraints.
- [x] 2.4 Render transient snap glyphs and labels through existing viewport authoring feedback.

## 3. Verification

- [x] 3.1 Add unit tests for candidate generation and ranking across local and projected geometry.
- [x] 3.2 Add editor/session tests proving snapped coordinates affect drawing previews and commits.
- [x] 3.3 Run `bun run test`.
- [x] 3.4 Run `bun run lint`.
