# Fix Import Inspector Scroll/Overflow

## Why

During the baked-geometry Taskariki smoke, the part-import inspector panel
(`src/components/layout/import-inspector.tsx`) could not be fully read: there is
no visible scrollbar and the reviewer had to zoom the browser out to see all of
the import content — fidelity warnings/errors, the verification section, and the
commit/cancel footer buttons. For dense imports (many baked/degraded features
with reason codes) the footer actions are effectively unreachable without
zooming, which blocks the primary import flow.

The panel already declares a scroll region (`flex-1 ... overflow-y-auto`, line
~103) and `h-full max-h-full ... overflow-hidden` on the `Paper` root, so the
regression is almost certainly an **unbounded ancestor height**: the inspector's
container is not constrained to the viewport, so `h-full`/`flex-1` never resolve
to a bounded height and the internal scroll region grows with content instead of
scrolling, pushing the footer off-screen.

## What Changes

- Constrain the import inspector to the available viewport/layout height so its
  internal `overflow-y-auto` region actually scrolls and the commit/cancel
  footer stays pinned and reachable.
- Verify the fidelity report and verification sections scroll independently of
  the footer, with a visible scrollbar affordance (Mantine `ScrollArea` or the
  existing Tailwind overflow region with a bounded parent).

Out of scope: redesigning the import review layout or the fidelity report
content itself.

## Impact

- Affected code: `src/components/layout/import-inspector.tsx` and its host
  layout in `src/workbench/shell/cad-workbench.tsx` (the container that must
  provide a bounded height).
- Testing: UI lane — a render test asserting the scroll region is bounded and
  the footer remains present; manual confirmation with a dense import bundle.

## Notes

Filed from the `add-baked-geometry-substrate` smoke (2026-07-11). Separated
because it is presentation/layout, not baked-geometry substrate behavior.
