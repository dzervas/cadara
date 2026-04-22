## Why

Users also need to import STL and 3MF triangle meshes, but triangle meshes do not preserve exact CAD topology. Mesh imports should become durable only by baking a reconstructed internal geometry result; the original mesh source must not be saved after import.

## What Changes

- Add STL and triangle-only 3MF import workflows that parse source files transiently during import.
- Show a clear warning that mesh source files are not retained and cannot be reprocessed from the saved document.
- Attempt conversion from triangles to a baked internal geometry asset during import.
- Save only the resulting baked geometry asset and reconstruction/import provenance in the authored document.
- Reject imports when the basic conversion path cannot produce acceptable durable geometry.
- Do not persist raw STL bytes, raw 3MF bytes, triangle arrays, mesh render records, or source mesh bodies in the authored document.

## Capabilities

### New Capabilities
- `mesh-baked-geometry-import`: Transient STL/3MF triangle import that persists only baked internal geometry results and provenance.

### Modified Capabilities
- `geometry-asset-substrate`: Baked geometry assets become a generated asset kind distinct from retained STEP source assets.
- `durable-modeling-contract`: Imported mesh results are represented as durable baked geometry bodies, not as source mesh bodies.
- `feature-authoring-definition`: Feature authoring exposes mesh import settings and warning/confirmation state.
- `workbench-document-file-menu`: The workbench import entry point accepts STL and 3MF files.
- `application-error-pipeline`: Mesh import conversion failures and discarded-source warnings are reported through structured diagnostics.

## Impact

- Contracts: mesh import feature definition, baked geometry asset metadata, conversion diagnostics.
- Parsers: STL parser and 3MF ZIP/XML triangle extraction for geometry-only 3MF scope.
- OCC/conversion: transient mesh-to-baked-geometry pipeline and generated geometry asset serialization.
- UI: mesh discard warning, import progress, conversion diagnostics, strict rejection for unreconstructable inputs.
- Testing: source mesh absence after save, baked asset restore, 3MF triangle-only import, STL import, failed conversion behavior.
