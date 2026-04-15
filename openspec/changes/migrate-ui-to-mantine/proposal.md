## Why

The current workbench chrome spends too many lines on long Tailwind utility strings, bespoke UI wrappers, and custom CSS variables. A Mantine-first migration reduces that styling surface, makes palette changes cheaper, and keeps the dense dark CAD feel even if some minor eye candy is intentionally dropped.

## What Changes

- Migrate standard workbench chrome from shadcn-style/Radix wrappers and heavy utility-class styling to Mantine components where Mantine already covers the interaction.
- Introduce a single shared Mantine theme module with a centrally defined dark-mode color tuple that can be updated without touching individual components.
- Reduce custom CSS to global reset, root sizing, and viewport-specific surfaces that Mantine does not own cleanly.
- Preserve existing tool, mode, and viewport behavior while allowing decorative shadows, gradients, and similar flourishes to simplify when that meaningfully reduces code.

## Capabilities

### New Capabilities
- `workbench-ui-foundation`: Mantine-first shell UI, centralized dark theme colors, and minimal custom styling for workbench chrome.

### Modified Capabilities

## Impact

- Affected code includes `package.json`, app/provider setup, `src/components/ui/`, workbench layout components, and global styling/theme modules.
- Introduces Mantine as the primary shell UI dependency and de-emphasizes hand-authored Radix wrapper components for standard controls.
- Changes the styling strategy from per-component utility strings and CSS variables toward shared Mantine theme tokens plus minimal layout glue.
