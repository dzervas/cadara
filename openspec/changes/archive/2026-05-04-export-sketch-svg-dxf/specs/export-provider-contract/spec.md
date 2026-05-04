## MODIFIED Requirements

### Requirement: Export providers SHALL implement a stateless ExportProvider interface
Each export format SHALL be implemented as a stateless `ExportProvider` that declares its format metadata, declares compatible target kinds or target compatibility logic, exposes schema-driven option forms, and produces export payloads from a compatible target and options.

#### Scenario: Provider declares format metadata
- **WHEN** a provider is registered
- **THEN** it exposes `id`, `label`, `formatId`, `fileExtension`, and `mimeType` as static properties
- **AND** `formatId` is a unique string identifying the export format (e.g., `'stl'`, `'step'`, `'3mf'`, `'svg'`, `'dxf'`)

#### Scenario: Provider declares target compatibility
- **WHEN** a provider is registered
- **THEN** it exposes target compatibility information that allows the export flow to decide whether a given `DurableRef` can be exported by that provider
- **AND** compatibility can distinguish body targets from committed sketch targets

#### Scenario: Provider exposes default options
- **WHEN** the export orchestrator needs initial option values for a matched provider
- **THEN** it calls `getDefaultOptions()` on the provider
- **AND** the provider returns a fully populated default options object for its format

#### Scenario: Provider exposes a schema-driven option form
- **WHEN** the export modal needs to render format-specific options
- **THEN** it calls `getOptionFormSchema(options)` on the matched provider
- **AND** the provider returns a `FeatureEditorFormSchema` describing the available user-facing options

#### Scenario: Provider applies option patches
- **WHEN** the user changes an option value in the export modal
- **THEN** the orchestrator calls `applyOptionPatch(options, patch)` on the provider
- **AND** the provider returns an updated options object reflecting the change

#### Scenario: Provider produces an export payload
- **WHEN** the orchestrator invokes `export(input)` with a compatible target reference, options, and capabilities
- **THEN** the provider returns a success result with the file payload, filename, extension, and MIME type
- **OR** the provider returns a failure result with diagnostics explaining why export failed

### Requirement: Export providers SHALL receive capabilities through an ExportCapabilities bag
Providers SHALL NOT access kernel, document, or sketch-session internals directly. The orchestrator SHALL supply an `ExportCapabilities` object that exposes only the services a provider needs.

#### Scenario: Tessellation capability for mesh formats
- **WHEN** a mesh-based provider (STL, 3MF) needs to tessellate a body
- **THEN** it uses the mesh tessellation service from `ExportCapabilities`
- **AND** does not import or reference OCC types directly

#### Scenario: B-Rep writer capability for exact formats
- **WHEN** a B-Rep provider (STEP) needs to write geometry
- **THEN** it uses the B-Rep writer service from `ExportCapabilities`
- **AND** does not import or reference OCC writer classes directly

#### Scenario: Sketch vector capability for sketch formats
- **WHEN** a sketch vector provider (SVG, DXF) needs committed sketch geometry or authored sketch styles
- **THEN** it uses the sketch-vector service from `ExportCapabilities`
- **AND** does not import editor session, workbench presentation, or sketch runtime internals directly

### Requirement: Export provider registry SHALL discover and match providers by format
The system SHALL maintain a registry of registered `ExportProvider` instances and provide lookup by format ID and compatible target.

#### Scenario: Register a provider at startup
- **WHEN** the application initializes
- **THEN** all built-in export providers are registered in the export provider registry
- **AND** `getRegisteredExportProviders()` returns the full list

#### Scenario: Look up provider by format
- **WHEN** the export flow needs the provider for a specific format
- **THEN** `getExportProviderByFormat(formatId)` returns the matching provider
- **OR** returns `undefined` if no provider is registered for that format

#### Scenario: List available export formats
- **WHEN** the export modal needs to display available export formats
- **THEN** it queries the registry for providers compatible with the selected export target
- **AND** uses their `formatId`, `label`, and `fileExtension` to populate the format selector

#### Scenario: List sketch-compatible export formats
- **WHEN** the export modal is scoped to a committed sketch target
- **THEN** the registry returns sketch-compatible providers such as SVG and DXF
- **AND** omits providers that only support body targets

#### Scenario: Dynamic registration for tests
- **WHEN** a test needs to inject a custom export provider
- **THEN** `registerExportProviderForTest(provider)` adds it to the registry
- **AND** `resetExportProvidersForTest()` restores the registry to its default state

### Requirement: Export orchestrator SHALL coordinate the provider lifecycle
The export orchestrator SHALL resolve the target, match the provider, verify provider compatibility, and delegate payload generation without the export modal or download flow needing to know provider internals.

#### Scenario: Successful geometry export through orchestrator
- **WHEN** the user confirms an export with a geometry format compatible with the selected target
- **THEN** the orchestrator looks up the provider by format
- **AND** calls `provider.export(input)` with the resolved target, user options, and capabilities
- **AND** returns the provider's result to the download flow

#### Scenario: Incompatible provider target is rejected
- **WHEN** the user or caller requests a provider-backed format for a target that provider does not support
- **THEN** the orchestrator returns a failure result with a diagnostic indicating that the format is incompatible with the selected target
- **AND** the provider is not invoked

#### Scenario: Unknown format falls through to cadara or fails
- **WHEN** the user selects a format with no registered provider
- **AND** the format is not `cadara`
- **THEN** the orchestrator returns a failure result with a diagnostic indicating the format is unsupported

#### Scenario: Cadara export bypasses providers
- **WHEN** the user selects cadara format
- **THEN** the orchestrator delegates to the existing document JSON serialization path
- **AND** does not look up a provider
