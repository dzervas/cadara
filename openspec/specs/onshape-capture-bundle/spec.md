# onshape-capture-bundle Specification

## Purpose
TBD - created by archiving change add-onshape-capture-bundle. Update Purpose after archive.
## Requirements

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

### Requirement: References SHALL resolve immutably at their consuming history point
The capture CLI SHALL batch referenced deterministic IDs by consuming rollback
index and evaluate them against `m/{microversion}` with `rollbackBarIndex`,
recording `evaluatedAt: "historyPoint"` and the consuming feature id. It SHALL not
mutate a temporary or user workspace for reference evidence.

#### Scenario: Mid-history-consumed face resolves
- **WHEN** a chamfer references a face that a later feature destroys
- **THEN** final-state resolution fails but history-point resolution records the face's signature as of the chamfer's position
- **AND** the record carries `evaluatedAt: "historyPoint"` and the consuming feature id

#### Scenario: Genuinely unresolvable ID
- **WHEN** an ID resolves at neither the final state nor its consuming history point
- **THEN** it is recorded `unresolved` with both attempts' structured reasons

### Requirement: Bake-boundary geometry capture SHALL never mutate the user's workspace
Required rollback-bar movement for proven geometry boundaries SHALL occur only
on a temporary workspace created from the captured microversion and deleted after
capture. Failures SHALL abort with cleanup, and a cleanup failure SHALL be
reported loudly with the workspace id.

#### Scenario: Capture completes
- **WHEN** a v2 capture with a proven boundary finishes
- **THEN** the source workspace's rollback bar, history, and microversion are untouched
- **AND** the temporary workspace is deleted

#### Scenario: Capture aborts mid-rollback
- **WHEN** a request fails while the temporary workspace's rollback bar is moved
- **THEN** the CLI attempts workspace deletion and reports the failure per the no-partial-output policy
- **AND** if deletion also fails, the error output names the leftover workspace id

#### Scenario: Workspace rights unavailable
- **WHEN** the credentials cannot create a workspace required for boundary geometry
- **THEN** immutable evidence capture continues, affected snapshots are null, and the bundle carries an explicit diagnostic

### Requirement: Format-v2 bundles SHALL automatically carry proven bake-boundary snapshots
The CLI SHALL populate `rollbackSnapshots` only for locally proven intrinsic bake
boundaries, with tessellated geometry and STEP when available. Capture SHALL not
require an opt-in flag or create a temporary workspace when no boundary exists.

#### Scenario: Proven boundary capture
- **WHEN** a Part Studio contains a locally proven intrinsic bake boundary
- **THEN** its post-feature geometry is embedded with the feature id and tolerance

#### Scenario: No boundary exists
- **WHEN** no Part Studio contains a proven boundary
- **THEN** `rollbackSnapshots` is an empty array and no temporary workspace is created

#### Scenario: Boundary workspace unavailable
- **WHEN** required boundary capture cannot create its temporary workspace
- **THEN** affected studios record `rollbackSnapshots: null` and an explicit diagnostic

#### Scenario: Version negotiation
- **WHEN** a consumer validates a bundle
- **THEN** `formatVersion` 1 and 2 both validate against their respective schemas
- **AND** unknown future versions are rejected with a structured error

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
The subcommand SHALL use `ONSHAPE_COOKIE_ON` as the value of the Onshape `on`
cookie when it is set. Otherwise it SHALL read `ONSHAPE_ACCESS_KEY` and
`ONSHAPE_SECRET_KEY` for HTTP Basic authentication. It SHALL NOT write any
credential to bundles, logs, or error output.

#### Scenario: Cookie credentials take precedence
- **WHEN** `ONSHAPE_COOKIE_ON` is set, with or without API-key variables
- **THEN** GET requests contain `Cookie: on=<value>` and no Basic authorization header
- **AND** before the first POST or DELETE, the client obtains and reuses the transient cookie and header names issued by `/api/clientinfo/xsrf`

#### Scenario: API-key fallback
- **WHEN** `ONSHAPE_COOKIE_ON` is unset and both API-key variables are set
- **THEN** requests use HTTP Basic authentication

#### Scenario: Missing credentials
- **WHEN** the cookie is unset and either API-key variable is unset
- **THEN** the command exits with a usage error naming the accepted variables before any network request

#### Scenario: Request failure reporting
- **WHEN** an authenticated request fails and is reported
- **THEN** the error output contains the URL and status but no cookie or authorization header material
