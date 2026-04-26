## 1. Snapshot Contributor Ancestry

- [x] 1.1 Extend the snapshot entity contract and builders to expose contributor feature ids for selectable body topology targets.
- [x] 1.2 Teach OCC topology replacement and rebuild flows to preserve contributor ancestry for unique-successor topology and extend it for newly derived topology such as shell-created inner faces.
- [x] 1.3 Add focused modeling or adapter coverage proving a shelled cube's inner face resolves to `Extrude` plus `Shell`, while a preserved back face resolves to `Extrude` only.

## 2. Selection-Derived Highlight State

- [x] 2.1 Derive a history-highlight feature-id set from the current primary visible selection and snapshot contributor ancestry in the editor/runtime layer.
- [x] 2.2 Recompute and clear that derived highlight state correctly across snapshot refresh, reload, and empty-space deselection without mutating document cursor state.

## 3. Timeline And Viewport Wiring

- [x] 3.1 Update the feature timeline presentation to highlight all committed history items whose feature ids appear in the derived contributor set.
- [x] 3.2 Wire viewport selection and deselection flows so accepted geometry clicks update the derived contributor highlight set and empty clicks clear it.
- [x] 3.3 Add component or integration coverage proving shell-inner-face, preserved-back-face, and deselect behaviors render the expected history highlights.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
