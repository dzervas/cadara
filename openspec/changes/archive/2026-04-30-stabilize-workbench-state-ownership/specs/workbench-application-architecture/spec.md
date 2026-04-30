## ADDED Requirements

### Requirement: Workbench shells SHALL not own document-facing repair state
The top-level workbench shell and shell-adjacent presentation state SHALL NOT become the owner of document refresh repair, accepted mutation reconciliation, or other document-facing state repair logic.

#### Scenario: Ordinary mutation completes
- **WHEN** a document-facing workbench mutation completes
- **THEN** shell composition code consumes updated callbacks or state from controllers and runtime
- **AND** the shell does not maintain its own repair path for reconciling the accepted document state

#### Scenario: Shell resets UI-local state after document replacement
- **WHEN** an explicit whole-document replacement flow completes
- **THEN** the shell may reset UI-local presentation state such as modal visibility or hidden-item affordances
- **AND** the shell does not become the authoritative owner of the replacement sequencing itself

### Requirement: Application controllers SHALL delegate document ownership rather than mirror it
Application-layer controllers SHALL compose browser-facing coordination and user-facing concern slices without mirroring authoritative document or command-session state in controller-local stores.

#### Scenario: Controller handles document-facing concern
- **WHEN** a controller handles history, import completion, rename, or document action coordination
- **THEN** it delegates authoritative document updates to the runtime-owned path
- **AND** it does not keep a competing controller-local source of truth for the same concern
