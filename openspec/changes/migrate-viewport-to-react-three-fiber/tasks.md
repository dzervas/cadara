## 1. Runtime Foundation

- [x] 1.1 Add `@react-three/fiber` and `@react-three/drei` to the workbench viewport dependencies.
- [x] 1.2 Introduce an R3F-backed viewport shell that preserves the current `ThreeCadViewport` input and callback boundary.
- [x] 1.3 Port base camera defaults, lighting, and scene-root composition into the new runtime without changing viewport behavior.

## 2. Scene Parity

- [x] 2.1 Adapt document renderables into declarative R3F scene nodes while preserving existing target bindings and highlight inputs.
- [x] 2.2 Adapt sketch display renderables into declarative R3F scene nodes while preserving coplanar sketch display behavior.
- [x] 2.3 Reconnect hover, selection, and sketch-plane pointer projection so editor events preserve current semantics.

## 3. drei Integration

- [x] 3.1 Replace the custom orbit-control lifecycle with a drei-backed control integration that preserves current mouse mappings and damping.
- [x] 3.2 Replace the custom viewport grid and orientation-gizmo runtime glue with drei-backed primitives or thin compatibility wrappers.
- [x] 3.3 Preserve existing camera framing and view-navigation helpers while routing them through the new runtime.

## 4. Verification And Cleanup

- [x] 4.1 Add or update focused tests for hover and selection parity, sketch draw projection parity, and view-cube camera navigation.
- [x] 4.2 Run the affected viewport and editor test suites plus targeted e2e coverage for viewport interactions.
- [x] 4.3 Remove obsolete imperative renderer, gizmo, and event-lifecycle code after parity verification passes.
