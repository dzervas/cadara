## Why

The current extension surface relies on mutable module-global registries and import-time registration side effects. That makes provider availability, startup order, and tests depend on hidden global state, and it has already introduced runtime cycles between registries, presentation helpers, and mode definitions.

## What Changes

- Replace implicit import-time registration with explicit application bootstrap and composition rules for export providers, import providers, and sketch special modes.
- Define registry boundaries so UI components and domain services consume explicit registry snapshots or injected registries instead of reaching into mutable singletons.
- Remove startup-time side effects from service construction where building one service silently mutates globally shared provider state.
- Require extension contracts to remain stateless and discoverable without introducing domain cycles between registry modules, definitions, and presentation helpers.
- Add architecture rules for test registration so tests can inject temporary extensions without mutating long-lived global process state.
- Preserve current built-in providers and special-mode behavior while making extension initialization deterministic.

## Capabilities

### New Capabilities
- `extension-registry-boundaries`: Defines explicit bootstrap, dependency, and lifecycle rules for runtime extension registries and mode/provider discovery.

### Modified Capabilities
- `export-provider-contract`: Change provider discovery requirements so registration and listing do not depend on hidden singleton mutation during unrelated service construction.
- `import-provider-contract`: Change provider discovery and test injection requirements so import availability is determined by explicit registry composition rather than ambient mutable globals.
- `sketch-special-editor-modes`: Change special-mode registration requirements so mode discovery does not introduce runtime dependency cycles between registries, definitions, and presentation helpers.
- `workbench-application-architecture`: Clarify that extension registry composition is an application/bootstrap concern rather than a responsibility of shell components or domain service constructors.

## Impact

- Affected code: `src/domain/export/*registry*`, `src/domain/import/*registry*`, `src/domain/sketch-special-modes/*`, modeling-service construction, export/import UI entrypoints, and related tests.
- Affected systems: application bootstrap, provider availability, test isolation, special-mode discovery, and startup dependency direction.
- Expected outcome: deterministic extension initialization, fewer hidden global couplings, cleaner test setup, and reduced risk of architecture regressions caused by registry side effects or runtime cycles.
