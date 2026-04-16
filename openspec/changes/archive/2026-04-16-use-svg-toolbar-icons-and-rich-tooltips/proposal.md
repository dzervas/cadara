## Why

The toolbar still relies on `lucide-react` placeholders even though the project already ships CAD-specific SVG assets in `public/icons`, so the workbench does not match the intended visual language. Tooltips also flatten the tool name and description into a single string, which makes feature discovery harder in the dense icon-only toolbar.

## What Changes

- Replace toolbar tool icon rendering so tool buttons and dropdown variants load SVG assets from `public/icons` instead of `lucide-react` icons.
- Define a stable mapping from each toolbar tool to the SVG filename that best matches the tool, including dropdown variants and mode-specific commands such as `Finish Sketch`.
- Update toolbar tooltip content so every tool button shows the feature name as a bold title above the descriptive copy.
- Keep search results and dropdown menu rows visually aligned with the same icon asset source so toolbar presentation stays consistent across entry points.

## Capabilities

### New Capabilities
- `toolbar-tool-presentation`: Render toolbar tools from local SVG assets and present tooltips with a clear title-and-description hierarchy.

### Modified Capabilities

## Impact

- Affected code includes toolbar presentation components, tool icon typing/mapping, and shared tooltip rendering for tool buttons and dropdown families.
- Adds a local SVG icon rendering path that depends on the existing `public/icons` asset set rather than a third-party icon library for toolbar tools.
- Changes visible workbench behavior without altering tool ids, action bus contracts, or CAD command semantics.
