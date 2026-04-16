# feature-preview-visibility Specification

## Purpose
TBD - created by archiving change stabilize-feature-preview-visibility. Update Purpose after archive.
## Requirements
### Requirement: Feature previews SHALL preserve committed viewport geometry
The workbench viewport SHALL continue rendering committed document geometry while a feature preview is active instead of replacing the scene with preview-only renderables.

#### Scenario: Preview starts over an existing model
- **WHEN** the user activates or edits a feature draft that produces preview renderables for a document that already has visible geometry
- **THEN** the committed geometry remains visible in the viewport while the preview is shown

#### Scenario: Preview updates after a draft change
- **WHEN** an active feature preview is recomputed because the user changes feature inputs
- **THEN** unrelated committed geometry remains continuously visible during the preview update

### Requirement: Feature previews SHALL render as visually distinct transient overlays
The workbench viewport SHALL render feature preview geometry with a transparent transient treatment that distinguishes it from committed geometry without dimming or hiding the rest of the scene.

#### Scenario: Previewed face geometry is displayed
- **WHEN** the viewport renders transient feature-preview faces over committed geometry
- **THEN** the preview faces use partial transparency while committed faces keep their normal opaque styling

#### Scenario: Previewed wire or point geometry is displayed
- **WHEN** the viewport renders transient feature-preview edges or markers
- **THEN** the preview geometry remains readable as an overlay and visually distinct from committed wire geometry

### Requirement: Preview lifecycle transitions SHALL clear only transient preview geometry
The workbench viewport SHALL add and remove feature preview geometry without blanking unrelated committed geometry during preview start, stale response handling, cancel, or commit transitions.

#### Scenario: Preview is cancelled or committed
- **WHEN** the active feature preview is cleared because the user cancels or commits the feature
- **THEN** the transient preview geometry is removed and the committed scene remains visible without a geometry-hidden intermediate state

#### Scenario: Preview response becomes stale
- **WHEN** a preview response is rejected as stale against a newer committed revision
- **THEN** the viewport removes or ignores the stale preview overlay without hiding the committed geometry already shown for that revision

