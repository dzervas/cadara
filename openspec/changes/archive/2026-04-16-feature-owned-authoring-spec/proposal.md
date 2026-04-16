## Why

The current feature-editing stack keeps the kernel boundary intact, but the editor logic for `revolve`, `shell`, `extrude`, and related features is still centralized in shared unions, switch statements, and form branches. That makes new features expensive to add, encourages feature-specific UI code, and leaves too much authoring behavior implicit instead of specified.

## What Changes

- Introduce a feature-owned authoring spec where each feature defines its own metadata and behavior in its own file.
- Define a shared feature authoring contract that covers feature identity, toolbar metadata, mode availability, selection behavior, draft lifecycle, preview/commit preparation, diagnostics, and hydration from snapshots.
- Define a shared editor-form contract that exposes a complete vocabulary of form elements and reference-picking elements so features can describe their editors declaratively with minimal custom code.
- Require the workbench/editor runtime to consume feature specs through a registry instead of hardcoded feature-type branching.
- Preserve the existing modeling-service and kernel boundary so per-feature authoring specs never require UI code to import kernel code or kernel code to import UI code.

## Capabilities

### New Capabilities
- `feature-authoring-definition`: Defines the contract every feature authoring module must implement, including metadata, draft behavior, selection semantics, preview/commit definition building, and editor integration points.
- `feature-editor-form-schema`: Defines the declarative editor-form schema and field vocabulary used by feature authoring modules so the inspector can render feature editors generically.

### Modified Capabilities

## Impact

- Affected areas include `src/domain/editor/**`, `src/domain/tools/**`, `src/components/layout/feature-inspector.tsx`, editor state integration, and feature-specific authoring logic currently centralized in shared files.
- Introduces a registry-driven feature authoring model and a declarative form schema for feature editors.
- Preserves the modeling contract and kernel adapter boundaries while moving feature-specific UI/editor behavior into isolated per-feature modules.
