## Why

The OpenCascade adapter already covers sketches, previews, and part of the feature pipeline, but the remaining core modeling operations are still missing or only partially surfaced through the UI. The current feature session panel is also extrude-specific and uses a range slider for depth, which is too limiting for precise CAD-style parameter entry and does not scale to revolve, fillet, shell, plane, and boolean workflows.

## What Changes

- Implement the remaining basic OpenCascade-backed feature flows for `revolve`, `fillet`, `shell`, `plane`, and explicit boolean operations across preview, create, update, rebuild, and snapshot/render integration.
- Add a generalized feature session form that can drive create/edit sessions for the supported solid features instead of only extrude.
- Replace slider-based dimensional controls with numeric length inputs for feature parameters such as depth, radius, thickness, offsets, and similar typed values.
- Define the selection, validation, and diagnostic behavior required to drive these features from the existing modeling contracts and workbench session model.

## Capabilities

### New Capabilities
- `occ-basic-feature-operations`: OCC-backed preview and commit behavior for revolve, fillet, shell, plane, and boolean-driven solid feature workflows.
- `feature-session-forms`: Mode-aware feature session forms for create/edit workflows with numeric parameter entry and contract-driven validation/diagnostics.

### Modified Capabilities

## Impact

- Affected code: `src/domain/modeling/opencascade-kernel-adapter.ts`, OCC helpers under `src/domain/modeling/occ/`, modeling schemas/contracts including the feature-definition union, editor session state, and workbench feature-session UI under `src/components/` and related hooks.
- Affected behavior: preview evaluation, feature create/update flows, reference resolution, diagnostics, feature inspector/session rendering, and snapshot/render export for new feature outputs.
- Dependencies: existing OpenCascade.js APIs already inventoried in `OCC.md`; no new external library is expected.
