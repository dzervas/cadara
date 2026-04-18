## Why

Several sketch toolbar entries are visible but currently act as passive no-ops or placeholders, which makes sketch mode look more complete than it behaves. Implementing the remaining non-SVG sketch tools closes that mismatch and gives users the core curve creation and edit operations expected from a CAD sketch environment.

## What Changes

- Implement `spline` as a real sketch drawing tool with point-by-point curve authoring, live preview, validation, and commit behavior.
- Implement `trim` as an active sketch edit tool that removes or splits supported curve segments at existing intersections while preserving valid sketch definitions.
- Implement `offset` as an active sketch edit tool that creates offset copies of supported sketch entities with numeric distance control and live preview.
- Make the primary `dimension` toolbar trigger start the default aligned distance dimension flow instead of behaving as an unsupported sketch command.
- Keep unsupported edge cases explicit through validation or diagnostics rather than silently changing sketch state.
- Preserve the existing sketch-session, solver, and modeling boundaries; no kernel-specific logic moves into UI components.

## Capabilities

### New Capabilities

- `remaining-sketch-tool-behavior`: Defines user-facing behavior for the remaining non-SVG sketch tools: Spline, Trim, Offset, and the primary Dimension trigger.

### Modified Capabilities

- `sketch-tool-definition`: The sketch tool contract must support spline-style multi-point curve tools and edit tools that mutate existing sketch geometry.
- `sketch-tool-editor-schema`: The presentation schema must cover multi-step spline placement, trim target feedback, and offset distance controls/previews.
- `sketch-geometry-editing`: Active sketch editing must include trim and offset mutations in addition to direct drag editing.
- `frontend-modeling-boundary`: Accepted trim and offset edits are durable sketch mutations routed through the modeling boundary.

## Impact

- Affected areas include sketch tool types/registry, sketch session state transitions, viewport picking and overlay feedback, authored sketch definition helpers, region extraction for trimmed/offset geometry, and focused `bun:test` coverage.
- Spline may require extending authored and solved sketch contracts if existing arc/line/circle records cannot represent the selected spline curve shape.
- No new runtime dependency is expected; use existing math helpers and solver/modeling boundaries.
