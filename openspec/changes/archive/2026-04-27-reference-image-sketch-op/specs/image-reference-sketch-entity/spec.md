## REMOVED Requirements

### Requirement: Image references SHALL be construction-only sketch entities with 4 corner points
**Reason**: Reference images are no longer represented as ordinary sketch entities with corner points.
**Migration**: Use the committed `referenceImage` sketch operation as the durable source of truth.

### Requirement: Image reference corner points SHALL participate in the constraint solver
**Reason**: Reference images are being removed from the generic sketch solver model.
**Migration**: Future calibration behavior will use a dedicated image-specific editing and solving path rather than main-sketch corner-point solving.

### Requirement: Image reference entities SHALL record pixel dimensions and asset reference
**Reason**: Reference-image persistence now lives on the operation payload and stores inline image bytes rather than an embedded-binary asset reference.
**Migration**: Read image metadata from the `referenceImage` operation payload.

### Requirement: Image reference entities SHALL render as textured quads on the sketch plane
**Reason**: Committed image rendering is now derived directly from the `referenceImage` operation contract.
**Migration**: Render committed reference-image underlays from operation-owned state rather than from local sketch entities.

### Requirement: Image reference corner ordering SHALL define a consistent winding
**Reason**: The replacement image operation no longer uses persisted corner-point winding as its primary model.
**Migration**: Use the operation's committed placement representation instead of quad corner winding.

### Requirement: Image reference sketches SHALL include structural edge entities between corners
**Reason**: Structural edge entities were scaffolding for the old graph-based image model and are no longer part of the replacement architecture.
**Migration**: Do not create synthetic edge entities for committed reference images.
