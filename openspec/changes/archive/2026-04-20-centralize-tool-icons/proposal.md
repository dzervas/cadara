## Why

Tool-related icons are currently defined in multiple UI-specific places, so the toolbar, feature history, and Parts & Objects surfaces can drift even when they represent the same modeling concepts. The toolbar icon set is already the desired visual source, and other tool-aware surfaces should consume that same definition instead of maintaining parallel icon choices.

## What Changes

- Introduce a shared tool icon definition capability that exposes the toolbar's current `ToolIconId` to asset mapping as the single source of truth for tool and modeling-feature icons.
- Update toolbar icon rendering to consume the shared registry without changing the current toolbar icon assets.
- Update feature history/timeline rendering to resolve feature and sketch-related icons through the same shared tool icon definitions where a tool or feature definition exists.
- Update Parts & Objects rendering to reuse shared tool icon definitions for feature/sketch-like entries while leaving unrelated generic workbench controls on the generic workbench icon set.
- Add focused coverage that fails when tool icon assets are duplicated or when toolbar/timeline/sidebar tool icons diverge from the shared registry.

## Capabilities

### New Capabilities
- `tool-icon-definition`: Defines the single source of truth for tool and modeling-feature icon metadata and the expected consumers across toolbar, feature history, and Parts & Objects.

### Modified Capabilities
- `toolbar-tool-presentation`: Toolbar tool icons must be resolved from the shared tool icon definition source while preserving the current toolbar icon assets.
- `feature-timeline-bar`: Timeline feature and sketch icons must resolve through shared tool icon definitions instead of a separate generic workbench icon choice.

## Impact

- Affected code: `src/domain/tools/schema.ts`, `src/components/layout/toolbar-tool-icon-assets.ts`, `src/components/layout/toolbar-tool-icon-src.ts`, `src/components/layout/toolbar-tool-icon.tsx`, `src/components/layout/feature-timeline-bar.tsx`, `src/components/layout/history-timeline-shell.tsx`, `src/components/layout/feature-sidebar.tsx`, and focused specs under `src/components/layout/`.
- No new runtime dependency is expected.
- The existing generic `WorkbenchIcon` set remains available for non-tool shell controls such as file, visibility, context-menu action, and status icons.
