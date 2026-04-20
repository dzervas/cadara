## 1. Shared Icon Source

- [x] 1.1 Move the current toolbar `ToolIconId` asset map into a shared tool icon definition module outside toolbar-specific components.
- [x] 1.2 Provide shared icon source helpers that preserve current `/icons/*.svg` resolution and `__CADARA_SINGLE_ASSETS__` lookup behavior.
- [x] 1.3 Update toolbar icon components to consume the shared helpers without changing existing toolbar asset filenames.

## 2. Workbench Consumers

- [x] 2.1 Add resolver helpers for document feature history items so registered feature authoring metadata maps to shared `ToolIconId` assets.
- [x] 2.2 Update feature timeline rendering to use shared tool icons for feature and sketch entries while preserving icon-only accessible controls.
- [x] 2.3 Update sketch history rendering to use shared tool icons for entity, constraint, and dimension concepts.
- [x] 2.4 Update Parts & Objects rendering to use shared tool icons for sketch/tool-backed concepts and keep generic body/component/action icons on `WorkbenchIcon`.

## 3. Verification

- [x] 3.1 Add or update render/spec coverage proving toolbar icons still resolve to the same current SVG assets through the shared source.
- [x] 3.2 Add or update coverage proving feature history, sketch history, and Parts & Objects use shared tool icon asset paths where applicable.
- [x] 3.3 Add focused coverage or a structural assertion that prevents a second tool-icon asset filename map from being reintroduced in toolbar/sidebar/history components.
- [x] 3.4 Run `bun run test`, `bun run lint`, and `bun run build`.
