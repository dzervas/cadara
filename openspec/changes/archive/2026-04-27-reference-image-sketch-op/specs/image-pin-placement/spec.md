## REMOVED Requirements

### Requirement: Clicking on an image in the sketch editor SHALL create a pinned point
**Reason**: The old image-pin flow depends on `pointOnImage` and on images being represented inside the main sketch graph.
**Migration**: Do not create image pins through ordinary sketch clicks. Future anchor behavior will be introduced through dedicated reference-image calibration editing.

### Requirement: Normalized (u, v) SHALL be computed from click position relative to current corners
**Reason**: The replacement architecture does not use graph-owned image corners as the reference-image source of truth.
**Migration**: Future anchor placement, if needed, will resolve against the committed reference-image operation model.

### Requirement: Image-pinned points SHALL be usable as normal sketch points
**Reason**: The current image-pin flow is being removed along with image-specific sketch constraints.
**Migration**: Future anchor export will be defined as read-only fixed reference points rather than as ordinary local sketch points.
