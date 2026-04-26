## REMOVED Requirements

### Requirement: STEP import features SHALL produce durable exact body targets
**Reason**: Legacy STEP import feature kind removed from FeatureDefinition union; durable body semantics will be respecified by the new STEP ImportProvider.
**Migration**: None required — functionality is behind a feature flag.

### Requirement: Baked mesh imports SHALL expose durable body topology
**Reason**: Legacy mesh import feature kind removed from FeatureDefinition union; body topology will be respecified by the new mesh ImportProvider.
**Migration**: None required.

### Requirement: Analytic and faceted baked results SHALL expose consistent durable body refs
**Reason**: Legacy mesh import removed; body reference consistency will be respecified by the new mesh ImportProvider.
**Migration**: None required.
