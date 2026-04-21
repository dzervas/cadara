## 1. Document Contract

- [ ] 1.1 Add persisted per-sketch SVG rendering state to the sketch document/runtime schema with a compatibility default when absent.
- [ ] 1.2 Ensure sketch creation, commit, reopen, import/load, and round-trip validation preserve the SVG rendering setting per sketch.
- [ ] 1.3 Add contract tests proving the setting is sketch-scoped and does not remove authored style records when toggled.

## 2. Style Runtime Behavior

- [ ] 2.1 Update sketch style target typing and validation so Fill accepts only live enclosed region targets and Stroke accepts only local sketch edge/entity targets.
- [ ] 2.2 Update Fill patching to author or update region-scoped style records keyed by the selected solved region target.
- [ ] 2.3 Update Stroke patching to author or update edge/entity stroke style fields while rejecting region and point targets.
- [ ] 2.4 Apply the per-sketch SVG rendering setting when creating active sketch renderables so disabling the toggle suppresses fill/stroke visuals without deleting stored styles.
- [ ] 2.5 Prevent sketch entry, geometry edits, selection changes, and live region recalculation from implicitly focusing Fill or Stroke style controls.

## 3. Toolbar And Forms

- [ ] 3.1 Add an icon-only sketch toolbar toggle for SVG rendering with tooltip/accessibility text and state sourced from the active sketch.
- [ ] 3.2 Remove Fill Type, Fill Solid, Fill Gradient, Stroke Options, Stroke Width, Stroke Cap, Stroke Join, Stroke Miter, and Stroke Dash from the toolbar-visible SVG style tools.
- [ ] 3.3 Keep only Fill and Stroke as toolbar-visible SVG style tools, with disabled/active states derived from the SVG rendering toggle and compatible selection target.
- [ ] 3.4 Update the sketch style presentation schema so Fill includes fill mode/color/gradient controls and Stroke includes enablement/color/width/cap/join/miter/dash controls.
- [ ] 3.5 Update generic sketch style form rendering and action dispatch so fill/stroke controls patch the correct region or edge target without SVG-tool-specific React branches.

## 4. Tests And Verification

- [ ] 4.1 Update toolbar tests to assert the SVG rendering toggle, only Fill/Stroke toolbar tools, and no separate fill/stroke variant tools.
- [ ] 4.2 Add sketch runtime tests for explicit Fill/Stroke activation, no implicit Fill focus, region-only Fill acceptance, edge-only Stroke acceptance, and non-mutating rejected targets.
- [ ] 4.3 Add renderable tests proving SVG rendering off suppresses authored fill/stroke visuals and re-enabling restores them from persisted data.
- [ ] 4.4 Run `bun run test`.
- [ ] 4.5 Run `bun run lint`.
- [ ] 4.6 Run `bun run build`.
