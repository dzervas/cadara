## ADDED Requirements

### Requirement: Timeline SHALL show feature-scoped rebuild errors
The bottom feature timeline SHALL mark document history items that own recoverable rebuild errors and SHALL provide persistent repair guidance without requiring the user to reset the document.

#### Scenario: Failed feature item is marked
- **WHEN** the current snapshot contains an error diagnostic attached to a committed feature
- **THEN** the corresponding feature history item renders with danger styling that is visually red
- **AND** the item remains present in its authored history position even if its geometry did not rebuild

#### Scenario: Multiple failed feature items are marked
- **WHEN** reload discovers errors on multiple independent committed features
- **THEN** each corresponding feature history item renders its own error state
- **AND** the timeline does not collapse those errors into one document-level message

#### Scenario: Failed feature shows persistent guidance tooltip
- **WHEN** a feature history item has an attached error diagnostic
- **THEN** the timeline shows a persistent tooltip or equivalent always-visible popover anchored to that feature item
- **AND** the tooltip explains what went wrong and how to repair the authored field
- **AND** the tooltip text does not use raw missing topology ids as its primary user-facing message

#### Scenario: Error item opens repair context
- **WHEN** the user activates an erroneous feature history item
- **THEN** the workbench selects or opens the feature editing context needed to correct the invalid field
- **AND** the action does not clear, delete, reset, or start over the document
