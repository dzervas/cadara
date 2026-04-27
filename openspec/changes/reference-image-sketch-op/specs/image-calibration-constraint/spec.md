## REMOVED Requirements

### Requirement: The pointOnImage constraint SHALL pin a sketch point to normalized image coordinates
**Reason**: The replacement architecture removes image-specific constraints from the main sketch solver.
**Migration**: Future image calibration and anchor behavior will be handled by a dedicated reference-image calibration subsystem.

### Requirement: The pointOnImage constraint SHALL propagate gradients to corners and pinned point
**Reason**: The new design does not solve reference-image placement through the generic sketch solver's corner-point graph.
**Migration**: Move image transform solving into the dedicated reference-image calibration solver.

### Requirement: The pointOnImage constraint SHALL reference the image entity by ID
**Reason**: The replacement architecture removes image entities and entity-bound image constraints from the main sketch graph.
**Migration**: Use operation-local reference-image calibration state instead of `pointOnImage` constraints.
