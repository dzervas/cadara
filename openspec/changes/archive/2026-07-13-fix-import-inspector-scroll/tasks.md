## 1. Layout

- [x] 1.1 Constrain the import inspector host container to a bounded viewport height so the panel's `overflow-y-auto` region scrolls instead of growing.
- [x] 1.2 Keep the commit/cancel footer pinned and reachable; ensure the fidelity/verification content scrolls with a visible scrollbar affordance.

## 2. Verification

- [x] 2.1 UI-lane render test: scroll region is height-bounded and the footer actions remain present with a dense import fixture.
- [x] 2.2 Manual confirmation with a dense import (many baked/degraded features) at default zoom.
