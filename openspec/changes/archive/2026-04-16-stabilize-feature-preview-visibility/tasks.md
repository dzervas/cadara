## 1. Layer preview renderables over the committed scene

- [x] 1.1 Update the workbench viewport renderable composition to keep snapshot document renderables present while feature preview renderables are active.
- [x] 1.2 Preserve existing hidden-target filtering and sketch-renderable merging after switching to layered preview composition.
- [x] 1.3 Verify preview clear paths fall back to committed snapshot renderables without leaving the viewport empty.

## 2. Add preview-specific viewport styling

- [x] 2.1 Thread preview-origin context into viewport render-object assembly so transient preview records can be styled separately from committed renderables.
- [x] 2.2 Apply transparent overlay styling and stable render-order handling for preview meshes, lines, and markers while keeping committed geometry at its normal appearance.
- [x] 2.3 Confirm stale-preview and preview-update flows replace only the transient overlay set instead of hiding unrelated committed geometry.

## 3. Add regression coverage

- [x] 3.1 Add unit coverage for layered viewport composition so preview renderables no longer replace committed document renderables.
- [x] 3.2 Add render-style tests that verify preview geometry uses transient transparency while committed geometry retains normal styling.
- [x] 3.3 Add an interaction-level regression that exercises preview start and clear behavior on a populated scene without blanking the viewport.
