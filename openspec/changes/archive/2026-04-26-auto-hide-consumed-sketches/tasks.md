## 1. Consumed Sketch Derivation

- [x] 1.1 Confirm or extend snapshot/presentation metadata so committed sketch rows can be identified as consumed by applied profile-based features during live rebuild and replay.
- [x] 1.2 Add focused contract or adapter coverage proving sketch-owned profile references mark the owning sketch as consumed, while planar-face-only profiles do not.

## 2. Runtime Visibility State

- [x] 2.1 Introduce derived auto-hidden sketch visibility in the editor/runtime layer instead of persisting consumed-sketch hide state in authored document data.
- [x] 2.2 Add a session-local explicit show override for auto-hidden sketches and reconcile it against snapshot updates so reload re-applies derived auto-hide.

## 3. Sidebar And Viewport Sync

- [x] 3.1 Update `Parts & Objects` visibility rendering so consumed sketches show hidden-state treatment immediately after accepted profile-based feature commits and after reload.
- [x] 3.2 Update viewport render, hover, and selection filtering to use the same effective visibility computation as the sidebar for consumed sketches.
- [x] 3.3 Add interaction coverage proving a user can show an auto-hidden sketch again from the sidebar without editing the consuming feature.

## 4. Verification

- [x] 4.1 Add regression coverage proving a consumed sketch auto-hides again after document reload or replay rebuild.
- [x] 4.2 Run `bun run test`, `bun run lint`, and `bun run build`.
