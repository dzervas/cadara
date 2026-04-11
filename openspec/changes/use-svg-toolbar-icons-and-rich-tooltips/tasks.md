## 1. Toolbar SVG Icon Rendering

- [x] 1.1 Replace the toolbar’s `lucide-react` icon map with a local SVG filename map that covers standard tools, dropdown families, and dropdown variants.
- [x] 1.2 Add a shared toolbar icon renderer and update standard buttons, dropdown triggers, dropdown menu rows, and search result rows to use the configured SVG assets consistently.
- [x] 1.3 Preserve active states, button sizing, and toolbar interactions while removing toolbar-tool dependence on `lucide-react`.

## 2. Tooltip Content Layout

- [x] 2.1 Add a shared tooltip content fragment that renders the tool name as a bold heading above the descriptive copy.
- [x] 2.2 Update standard toolbar buttons and dropdown trigger buttons to use the new tooltip layout without changing tool dispatch behavior.
- [x] 2.3 Keep accessibility labels concise and verify the richer tooltip content does not regress keyboard or hover behavior.

## 3. Verification

- [x] 3.1 Add or update UI tests for toolbar icon rendering and tooltip content structure, including a dropdown-backed tool.
- [x] 3.2 Verify in the running workbench that the toolbar loads SVG icons from `public/icons` and that tooltips show the feature title above the description for all tool buttons.
