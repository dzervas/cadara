## Context

The current extension surface is initialized through mutable module-global registries and import-time side effects. Export providers are registered when the modeling service is constructed, import providers rely on ambient mutable arrays, and sketch special modes couple registry resolution with definition imports tightly enough to create runtime cycles.

That architecture makes availability depend on hidden startup order and weakens test isolation because tests mutate long-lived global process state. It also blurs responsibility: application bootstrap, domain services, and UI entrypoints can all end up influencing which extensions exist.

Assumption: this change preserves the current built-in provider and special-mode contracts. It changes how they are composed and discovered, not the user-visible behavior of individual providers or modes.

## Goals / Non-Goals

**Goals:**
- Make extension registration explicit and deterministic.
- Move registry composition to application/bootstrap ownership.
- Remove service-construction side effects that silently mutate global provider state.
- Provide test-scoped registry composition paths that do not leak across test cases.
- Reduce or eliminate runtime dependency cycles caused by registry/definition/presentation entanglement.

**Non-Goals:**
- Inventing a plugin marketplace or dynamic remote extension loading system.
- Redesigning individual provider option forms or import/export payload contracts.
- Replacing all registries with React context if simpler injected factories are sufficient.
- Changing boot-path performance characteristics beyond what is required to remove side effects and cycles.

## Decisions

### Decision: Registry composition moves to explicit bootstrap

Built-in export providers, import providers, and sketch special modes will be composed explicitly at application bootstrap or service wiring time. Consumers receive either an injected registry object or an immutable snapshot-derived lookup surface.

Alternatives considered:
- Keep mutable singletons and just document initialization order.
  Rejected because the hidden coupling is the main problem.
- Make every consumer import built-ins directly.
  Rejected because it duplicates composition logic and weakens extension substitution.

### Decision: Domain services consume registries but do not register into them

Service constructors such as the modeling service may depend on an export-provider lookup surface, but they will not register built-ins as a side effect of construction. Registration is not a service concern.

Alternatives considered:
- Keep registration in service construction because it is convenient.
  Rejected because it couples unrelated services to global extension availability.

### Decision: Registries expose stable lookup APIs over immutable membership

The runtime should not rely on ambient mutable arrays that any module can append to at any time. Registries will expose typed lookup methods over explicit membership assembled during bootstrap or test setup. Tests may still build custom registries, but those registries are scoped to the test or harness.

Alternatives considered:
- Preserve global registries with reset helpers for tests.
  Rejected because it remains order-dependent and process-global.

### Decision: Special-mode registry direction must be acyclic

Sketch special-mode registration will be refactored so that shared mode identifiers, neutral schema helpers, and presentation helpers do not require the registry to import a mode definition that also imports the registry or registry-dependent helpers. Shared pieces move to neutral modules when necessary.

Alternatives considered:
- Keep the cycle and rely on current import behavior.
  Rejected because it is fragile and constrains future extension work.

### Decision: UI surfaces consume extension availability through injected boundaries

Import and export UI entrypoints should read extension availability from explicit boundaries prepared by application composition, not from ambient mutable registries. This keeps UI behavior deterministic and makes it possible to test “available extensions” as an input rather than shared process state.

Alternatives considered:
- Only fix service construction side effects and leave UI on mutable registries.
  Rejected because UI discovery is part of the same hidden-global problem.

## Risks / Trade-offs

- [Bootstrap wiring gets more verbose] → Accept small wiring verbosity in exchange for deterministic ownership and simpler reasoning.
- [Many tests currently rely on ambient registry mutation] → Provide small registry factory helpers and migrate tests incrementally.
- [Registry injection could sprawl through many call sites] → Inject near composition roots and pass narrowed lookup surfaces rather than raw registry internals.
- [Cycle removal may force neutral-module extraction] → Keep extracted modules minimal and identity-focused to avoid another abstraction dump.

## Migration Plan

1. Introduce explicit registry factory/composition helpers for export, import, and special-mode surfaces.
2. Rewire built-in bootstrap to use explicit composition.
3. Update domain services and UI entrypoints to consume injected lookup surfaces instead of mutable singletons.
4. Break special-mode dependency cycles by moving shared identifiers/helpers to neutral modules.
5. Replace test-global mutation helpers with test-scoped registry composition.

Rollback is possible per registry family. Export, import, and special-mode registration can be migrated independently as long as each family preserves one deterministic composition path at a time.

## Open Questions

- Whether the app should own one shared extension-composition module or separate bootstrap modules per registry family.
- Whether test helpers should expose lightweight registry factories or fixture-level prebuilt compositions for the most common provider combinations.
