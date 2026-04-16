## Why

Profile-consuming features should handle more than one explicit profile wherever the feature contract and authoring flow already model profile selection. Extrude and revolve already define profile collections, but the requirement should apply consistently across profile-based feature authoring so future feature slices do not fall back to singular profile assumptions.

## What Changes

- Extend the profile-based feature contract from extrude/revolve-specific coverage to all authored features that declare profile inputs.
- Require profile-capable feature authoring definitions to expose collection-backed profile selection when the feature supports multiple profiles.
- Require draft hydration, definition building, preview, commit, update, rebuild, and operation-history replay to preserve the submitted profile collection without collapsing it to a single profile.
- Add regression coverage that builds a feature definition from multiple selected profiles and asserts the resulting contract payload preserves every selected profile in order.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `profile-based-feature-contract`: Generalize multi-profile requirements beyond the named extrude and revolve cases and require authoring/test coverage for profile-consuming features that accept multiple profiles.

## Impact

- Feature authoring definitions and draft patching for profile-consuming features.
- Runtime contract schemas and operation-history validation for profile collection fields.
- Modeling adapter request handling where profile collections are consumed.
- `bun:test` coverage for multi-profile authoring and contract payload construction.
