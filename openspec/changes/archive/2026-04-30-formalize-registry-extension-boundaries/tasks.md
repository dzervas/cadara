## 1. Introduce explicit registry composition

- [x] 1.1 Create explicit composition/factory helpers for built-in export providers, import providers, and sketch special modes.
- [x] 1.2 Rewire application bootstrap and service wiring to consume those explicit compositions instead of ambient singleton registration.
- [x] 1.3 Add or update architecture tests that fail when built-in extension availability depends on service-construction side effects or cyclic registry direction.

## 2. Migrate registry consumers

- [x] 2.1 Update export flows and related UI surfaces to consume an explicit export-provider lookup surface.
- [x] 2.2 Update import flows and related UI surfaces to consume an explicit import-provider lookup surface.
- [x] 2.3 Update sketch special-mode discovery to consume an explicit special-mode registry and break the current registry/definition/helper cycle.
- [x] 2.4 Remove modeling-service-owned built-in provider registration side effects and any other unrelated constructor-time registry mutation.

## 3. Replace global test mutation paths

- [x] 3.1 Introduce test-scoped registry composition helpers for export providers.
- [x] 3.2 Introduce test-scoped registry composition helpers for import providers and sketch special modes.
- [x] 3.3 Migrate affected tests away from long-lived global registry mutation and reset patterns.

## 4. Verify deterministic extension availability

- [x] 4.1 Add or update tests proving export and import availability is determined by explicit composition rather than initialization order.
- [x] 4.2 Add or update tests proving custom scoped providers or modes do not leak across tests.
- [x] 4.3 Add or update tests proving sketch special-mode discovery remains acyclic and behaviorally equivalent after the registry refactor.
