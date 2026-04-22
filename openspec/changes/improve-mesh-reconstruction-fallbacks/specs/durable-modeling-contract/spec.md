## ADDED Requirements

### Requirement: Analytic and faceted baked results SHALL expose consistent durable body refs
The modeling contract SHALL expose durable body and subshape references for both analytic recovered results and accepted faceted fallback results.

#### Scenario: Select baked fallback body
- **WHEN** a faceted fallback result is restored from a baked geometry asset
- **THEN** the snapshot exposes durable body topology for selectable targets
- **AND** downstream features either accept those targets or reject unsupported faceted topology with structured diagnostics
