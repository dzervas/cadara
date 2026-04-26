## REMOVED Requirements

### Requirement: Reconstruction SHALL classify baked results
**Reason**: Legacy mesh import removed; reconstruction classification will be respecified by the new mesh ImportProvider.
**Migration**: None required — functionality is behind a feature flag.

### Requirement: Fallback policy SHALL prefer strict rejection before faceted geometry before mesh bodies
**Reason**: Legacy mesh import removed; fallback policy will be respecified by the new mesh ImportProvider.
**Migration**: None required.

### Requirement: Reconstruction settings SHALL be durable provenance
**Reason**: Legacy mesh import removed; provenance will use the import-provider-contract binding metadata instead.
**Migration**: None required.

### Requirement: Reconstruction settings SHALL include unification tolerance overrides
**Reason**: Legacy mesh import removed; tolerance settings will be respecified by the new mesh ImportProvider.
**Migration**: None required.
