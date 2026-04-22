## Why

Users need to bring existing exact CAD models into the workspace and continue using normal face, edge, and vertex selection. STEP is the right first import target because it preserves BREP topology and can be replayed through OCC from retained source bytes.

## What Changes

- Add a STEP exact-solid import workflow backed by the geometry asset substrate.
- Persist the original STEP bytes as a durable geometry asset inside the self-contained document.
- Add an authored import feature that references the STEP asset plus import settings such as units, scale, orientation, and placement.
- Rebuild imported STEP assets through OCC into exact `TopoDS_Shape` bodies with durable body, face, edge, and vertex references.
- Add import UI for selecting STEP files, reviewing import settings, surfacing progress, and reporting unsupported or invalid files.
- Treat imported STEP bodies like normal exact bodies for viewport rendering, picking, feature-tree/object-tree display, and downstream feature references.

## Capabilities

### New Capabilities
- `step-exact-solid-import`: Import, persist, rebuild, and select exact solids from STEP geometry assets.

### Modified Capabilities
- `geometry-asset-substrate`: STEP assets become the first required geometry asset consumer.
- `durable-modeling-contract`: Modeling feature definitions and snapshots expose exact imported bodies as durable authored results.
- `occ-kernel-adapter`: OCC restore/rebuild supports STEP-backed import features.
- `feature-authoring-definition`: Feature authoring exposes a file-backed import command with typed settings.
- `workbench-document-file-menu`: The workbench exposes an import entry point for STEP files.

## Impact

- Contracts: new feature kind and runtime schemas for STEP import definitions and diagnostics.
- OCC: STEP reader integration in worker/runtime restore paths, topology extraction, and body label/provenance handling.
- UI: import command, file picker filters, import settings review, progress/error notification.
- Storage: source STEP bytes are retained as immutable geometry assets and shared to peers automatically.
- Testing: STEP asset round-trip, restore from repository/local file, peer asset sync, topology selection, invalid file diagnostics.
