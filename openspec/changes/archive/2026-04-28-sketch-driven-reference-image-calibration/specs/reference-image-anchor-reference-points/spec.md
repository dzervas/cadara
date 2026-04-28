## REMOVED Requirements

### Requirement: Calibrated anchors SHALL export as fixed sketch reference points
**Reason**: Reference-image anchors now live as ordinary local sketch points bound to image metadata, so the redesign removes the projected fixed-reference export layer.
**Migration**: Use the bound local anchor points in the flat sketch graph for constraints, dimensions, and editing instead of consuming exported read-only reference points.

### Requirement: Only anchor points SHALL export from calibrated reference images
**Reason**: The redesign removes calibration-driven projected anchor exports entirely because anchor geometry is now owned by the flat sketch graph rather than exported from a separate calibration solve.
**Migration**: Read anchor visibility and editability from the bound construction points that remain in the sketch, not from projected reference records.

### Requirement: Exported anchor points SHALL refresh from calibration results
**Reason**: There are no longer exported anchor-point records to refresh; image placement is derived from solved bound points instead.
**Migration**: Recompute image placement and viewport presentation from the solved positions of the bound local anchor points.

### Requirement: Anchor visibility in normal sketch editing SHALL be user-controlled
**Reason**: Anchor visibility is no longer a toggle over exported fixed references; it is now part of how the sketch presents bound construction points.
**Migration**: Move any existing visibility handling to the sketch-owned construction-point presentation path for bound image anchors.
