## REMOVED Requirements

### Requirement: Image import provider SHALL accept common raster image formats
**Reason**: Raster reference images are no longer created through the generic import-provider pipeline.
**Migration**: Use the sketch-mode `Import Image` tool, which creates a committed `referenceImage` operation directly in the active sketch.

### Requirement: Image import review SHALL present the image and request a target plane
**Reason**: Reference-image creation is now sketch-owned, so the active sketch already defines the target plane.
**Migration**: Enter a sketch first, then use `Import Image` from sketch mode.

### Requirement: Image import prepare SHALL store the image and produce a sketch
**Reason**: The replacement flow creates a `referenceImage` operation instead of preparing a sketch backed by `imageReference` geometry and constraints.
**Migration**: Commit a `referenceImage` operation in the active sketch rather than preparing an image-backed sketch definition through the import provider.

### Requirement: Image import SHALL work on any sketch plane
**Reason**: Reference-image creation no longer provisions a new sketch plane through a generic import review flow.
**Migration**: Open or create the target sketch on the desired plane first, then import the image into that sketch.

### Requirement: Image import SHALL attach binding metadata for refresh
**Reason**: This change removes the generic image import-provider contract for reference images.
**Migration**: Reference-image refresh and replacement behavior are handled by later reference-image editing flows instead of generic import bindings.
