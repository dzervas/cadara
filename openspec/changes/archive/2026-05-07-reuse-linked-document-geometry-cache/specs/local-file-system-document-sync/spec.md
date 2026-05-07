## ADDED Requirements

### Requirement: Linked filesystem reload SHALL reuse cached geometry for unchanged files
When a document has a restored local filesystem binding, the document sync worker SHALL read and validate the current bound file before completing reload, compare the validated file document to the cached repository document for the same active document identity, and reuse the cached repository load result when the documents match.

#### Scenario: Matching linked file reuses cached repository result
- **WHEN** the document sync worker loads a filesystem-bound document whose current bound file validates to the same authored document as the cached repository document after active document-id normalization
- **THEN** the worker returns the cached repository load result without mutating the repository
- **AND** the returned result preserves the cached repository metadata, diagnostics, and geometry asset availability
- **AND** no filesystem autosync write is attempted during initialization

#### Scenario: Matching linked file with different serialized JSON reuses cache
- **WHEN** the current bound file contains authored document JSON that differs in serialization details but validates to the same authored document as the cached repository document after contract parsing
- **THEN** the worker treats the file and cache as matching
- **AND** the worker reuses the cached repository load result

#### Scenario: Matching linked file with different document id reuses active cache
- **WHEN** the current bound file validates to the cached repository document except for its stored document id
- **AND** the existing linked-file load contract normalizes the file document to the active document id
- **THEN** the worker compares the normalized file document with the cached repository document
- **AND** the worker reuses the cached repository load result when the normalized documents match

#### Scenario: Changed linked file refreshes repository from disk
- **WHEN** the document sync worker loads a filesystem-bound document whose current bound file validates but differs from the cached repository document after active document-id normalization
- **THEN** the worker refreshes the repository from the file document
- **AND** the loaded result reflects the file document rather than the stale cached repository document
- **AND** no filesystem autosync write is attempted during initialization

#### Scenario: Invalid linked file does not reuse stale cache
- **WHEN** the document sync worker loads a filesystem-bound document whose current bound file cannot be parsed or validated as an authored model document
- **THEN** the worker returns an explicit failed load result for the invalid file
- **AND** the worker does not return cached repository geometry or cached authored document state as a fallback
- **AND** the worker does not mutate the repository

#### Scenario: Unreadable linked file does not reuse stale cache
- **WHEN** the document sync worker loads a filesystem-bound document and reading the current bound file fails
- **THEN** the worker returns an explicit failed load result for the read failure
- **AND** the worker does not return cached repository geometry or cached authored document state as a fallback
- **AND** the worker does not mutate the repository

#### Scenario: Browser-only reload keeps repository restore behavior
- **WHEN** the document sync worker loads a document without a restored local filesystem binding
- **THEN** the worker returns the repository load result through the browser-backed restore path
- **AND** it does not perform linked-file equality checks or linked-file reads
