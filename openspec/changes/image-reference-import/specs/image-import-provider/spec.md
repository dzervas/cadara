## ADDED Requirements

### Requirement: Image import provider SHALL accept common raster image formats
The `ImageImportProvider` SHALL accept PNG, JPEG, WebP, BMP, and TIFF files based on file extension and media type.

#### Scenario: Accept PNG file
- **WHEN** a resolved import source has a file name ending in `.png` or media type `image/png`
- **THEN** the provider's `accepts()` returns `true`

#### Scenario: Accept JPEG file
- **WHEN** a resolved import source has a file name ending in `.jpg` or `.jpeg` or media type `image/jpeg`
- **THEN** the provider's `accepts()` returns `true`

#### Scenario: Reject non-image file
- **WHEN** a resolved import source has a file name and media type that do not match any supported image format
- **THEN** the provider's `accepts()` returns `false`

### Requirement: Image import review SHALL present the image and request a target plane
The provider's `review()` SHALL decode the image to extract pixel dimensions and present a review result that lets the user select a target sketch plane.

#### Scenario: Review valid image
- **WHEN** `review()` receives a resolved source containing valid image bytes
- **THEN** the review result includes pixel width, pixel height, and the source name
- **AND** the proposed action kinds include `commitSketch`

#### Scenario: Review corrupt image
- **WHEN** `review()` receives a resolved source whose bytes cannot be decoded as a supported image format
- **THEN** the review result includes a diagnostic with `severity: 'error'` describing the decoding failure
- **AND** the provider does not proceed to prepare

### Requirement: Image import prepare SHALL store the image and produce a sketch
The provider's `prepare()` SHALL store the image bytes as an embedded binary asset via `ImportCapabilities.assets.storeEmbeddedBinary()` and return `ImportPreparedActions` containing a single `CommitSketchRequest` with the image reference sketch.

#### Scenario: Prepare creates embedded binary and sketch request
- **WHEN** `prepare()` is called with a valid review result and the user's selected target plane
- **THEN** the provider calls `capabilities.assets.storeEmbeddedBinary()` with the image bytes and media type
- **AND** returns `ImportPreparedActions` with one `CommitSketchRequest`

#### Scenario: Sketch contains image reference entity with initial fixPoint constraints
- **WHEN** the provider constructs the initial sketch definition
- **THEN** the sketch definition contains 4 `SketchPointDefinition` entries for the image corners
- **AND** contains 1 `imageReference` entity referencing those 4 corner points and the embedded binary asset ID
- **AND** contains 4 `fixPoint` constraints pinning each corner to its initial position
- **AND** contains no other entities, constraints, or dimensions

#### Scenario: Initial corner placement preserves aspect ratio
- **WHEN** the provider computes initial corner positions from the image's pixel dimensions
- **THEN** the aspect ratio of the corner quad matches the image's pixel aspect ratio
- **AND** the longest side of the quad is scaled to a reasonable default extent in sketch-plane units

#### Scenario: Sketch label derives from source name
- **WHEN** the provider constructs the `CommitSketchRequest`
- **THEN** the sketch label is derived from the import source name (e.g., `"photo.jpg"` → `"photo"`)

### Requirement: Image import SHALL work on any sketch plane
The `ImageImportProvider` SHALL accept any `SketchPlaneDefinition` as the target plane — primary datum planes (XY, YZ, XZ), construction planes, and planar body faces.

#### Scenario: Import onto XY plane
- **WHEN** the user selects the XY datum plane as the target
- **THEN** the committed sketch uses the XY plane definition and the image corners are placed in XY sketch-space coordinates

#### Scenario: Import onto a body face
- **WHEN** the user selects a planar body face as the target
- **THEN** the committed sketch uses a plane definition derived from that face
- **AND** the image corners are placed in the face-plane's sketch-space coordinates

### Requirement: Image import SHALL attach binding metadata for refresh
The provider SHALL include an `ImportBinding` in the prepared actions matching the source origin, so the image can be re-imported from the same source if the user updates the original file.

#### Scenario: Local file binding
- **WHEN** the import source origin is `localFile`
- **THEN** the prepared actions include an `ImportBinding` with `kind: 'localFile'`, the file name, path hint, source fingerprint, and `refreshPolicy: 'manual'`

#### Scenario: URL binding
- **WHEN** the import source origin is `url`
- **THEN** the prepared actions include an `ImportBinding` with `kind: 'url'`, the URL, source fingerprint, and `refreshPolicy: 'manual'`
