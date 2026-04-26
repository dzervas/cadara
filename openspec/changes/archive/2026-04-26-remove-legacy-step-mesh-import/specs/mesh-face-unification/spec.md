## REMOVED Requirements

### Requirement: Mesh-imported solids SHALL undergo bounded surface domain unification
**Reason**: Legacy mesh import removed; unification behavior will be specified by the new mesh ImportProvider if needed.
**Migration**: None required — functionality is behind a feature flag.

### Requirement: Unification SHALL use mesh-appropriate tolerances
**Reason**: Legacy mesh import removed; tolerance semantics will be respecified by the new mesh ImportProvider.
**Migration**: None required.

### Requirement: Unification diagnostics SHALL be recorded in provenance
**Reason**: Legacy mesh import removed; provenance recording will be respecified by the new mesh ImportProvider.
**Migration**: None required.

### Requirement: Mesh-imported solids SHALL have selectable face references
**Reason**: Legacy mesh import removed; face reference semantics will be respecified by the new mesh ImportProvider.
**Migration**: None required.
