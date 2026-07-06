## ADDED Requirements

### Requirement: Capture SHALL produce a single self-contained versioned bundle file
The `cadara onshape capture` subcommand SHALL write one `.onshape-capture.json` file containing everything a later offline import needs: a `formatVersion`, capture provenance (timestamps, CLI version, API version, base URL, document/workspace-or-version ids, microversion), and per-Part-Studio capture sections. The bundle envelope SHALL be validated with Typia-generated validators shared between the CLI and future consumers.

#### Scenario: Successful capture of a workspace URL
- **WHEN** the user runs `cadara onshape capture https://cad.onshape.com/documents/{did}/w/{wid}`
- **THEN** the CLI writes a single bundle file containing document metadata, the element list, and one capture section per Part Studio in the workspace
- **AND** the bundle validates against the `formatVersion: 1` envelope schema

#### Scenario: Element-scoped capture
- **WHEN** the document URL includes `/e/{eid}` and that element is a Part Studio
- **THEN** only that Part Studio is captured
- **AND** the element list still records all elements for provenance

#### Scenario: Invalid document URL
- **WHEN** the argument is not a recognizable Onshape document URL or lacks the workspace/version segment
- **THEN** the command exits with a usage error explaining the expected URL shape
- **AND** no network requests are made

### Requirement: Raw Onshape responses SHALL be archived verbatim
Each Part Studio capture section SHALL store the unmodified Onshape API responses for the feature list, solved sketch states, parts, and (when available) feature specs. The CLI SHALL NOT transform, filter, or reinterpret Onshape payloads at capture time.

#### Scenario: Feature list archived
- **WHEN** a Part Studio is captured
- **THEN** the raw `getFeatures` response — including `BTMSketch-151` entities and constraints, feature parameters, and serialization/microversion metadata — is stored byte-equivalent as parsed JSON

#### Scenario: Solved sketch states archived
- **WHEN** a Part Studio containing sketches is captured
- **THEN** the raw solved-sketch response is stored so a consumer can compare its own constraint-solver results against Onshape's solved geometry

#### Scenario: Optional section unavailable
- **WHEN** an optional section such as feature specs cannot be fetched
- **THEN** the bundle records the absence with a structured reason
- **AND** the capture still succeeds

### Requirement: Every referenced deterministic ID SHALL be resolved to a geometric signature or an explicit unresolved record
The CLI SHALL collect every deterministic ID referenced by feature parameters and sketch constraints in the captured feature list and SHALL resolve each to a geometric signature (entity class, geometry type, defining data, bounding box/centroid, owning feature where derivable) by server-side FeatureScript evaluation against the captured microversion.

#### Scenario: Sketch plane reference resolved
- **WHEN** a sketch references a plane through a deterministic ID
- **THEN** the resolution table contains a signature identifying the plane's origin and normal and, for default planes, its identity as a default plane

#### Scenario: Projected constraint external reference resolved
- **WHEN** a sketch constraint references an external edge or face through a deterministic ID
- **THEN** the resolution table contains a signature with the entity's geometry type and defining data sufficient for offline geometric matching

#### Scenario: Reference cannot be resolved against the final state
- **WHEN** a deterministic ID refers to an entity that no longer exists in the final model state
- **THEN** the resolution table records the ID with a structured `unresolved` reason
- **AND** the capture still succeeds
- **AND** no signature is fabricated

#### Scenario: Unreferenced IDs are not resolved
- **WHEN** the feature list contains no reference to a given deterministic ID
- **THEN** the CLI does not spend requests resolving it

### Requirement: Capture SHALL include final-state ground-truth geometry
Each Part Studio capture section SHALL include the final model geometry as both a tessellated representation and a STEP export, embedded in the bundle, so consumers can validate rebuilds and fall back to baked geometry without network access.

#### Scenario: Ground truth captured
- **WHEN** a Part Studio with at least one solid body is captured
- **THEN** the bundle embeds tessellated face data and STEP text for the final state
- **AND** records the tessellation tolerance used

#### Scenario: Empty Part Studio
- **WHEN** a Part Studio produces no bodies
- **THEN** the ground-truth section records that state explicitly rather than embedding empty payloads

### Requirement: Capture SHALL fail loudly rather than emit partial bundles
The CLI SHALL abort without writing an output file when any mandatory section (document metadata, elements, feature list, solved sketches, parts, reference resolution table, ground truth) cannot be captured.

#### Scenario: Mandatory request fails after retries
- **WHEN** a mandatory API request keeps failing after bounded retries
- **THEN** the command exits non-zero with the failing endpoint and status in the error output
- **AND** no bundle file is written

#### Scenario: Rate limiting encountered
- **WHEN** the API responds with HTTP 429
- **THEN** the CLI retries with exponential backoff within its bounded retry budget
- **AND** caps concurrent in-flight requests

### Requirement: Credentials SHALL come from the environment and never leak into output
The subcommand SHALL read `ONSHAPE_ACCESS_KEY` and `ONSHAPE_SECRET_KEY` from the environment for HTTP Basic authentication and SHALL NOT write them to bundles, logs, or error output.

#### Scenario: Missing credentials
- **WHEN** either environment variable is unset
- **THEN** the command exits with a usage error naming the missing variable before any network request

#### Scenario: Request failure reporting
- **WHEN** an authenticated request fails and is reported
- **THEN** the error output contains the URL and status but no authorization header material
