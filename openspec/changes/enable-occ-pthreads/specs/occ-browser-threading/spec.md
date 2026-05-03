## ADDED Requirements

### Requirement: Browser OCC runtime SHALL require a pthread-capable shared-memory environment
The browser OCC runtime SHALL start only when the page and worker environment satisfy the platform prerequisites required by the pthread-enabled OpenCascade build.

#### Scenario: Browser startup environment supports threaded OCC
- **WHEN** the application bootstrap runs in a browser environment that satisfies the shared-memory and worker prerequisites required by the pthread-enabled OCC build
- **THEN** the browser OCC runtime starts the threaded OpenCascade build
- **AND** the runtime does not downgrade to a non-threaded browser OCC build

#### Scenario: Browser startup environment does not support threaded OCC
- **WHEN** the application bootstrap runs in a browser environment that does not satisfy the shared-memory or worker prerequisites required by the pthread-enabled OCC build
- **THEN** browser OCC startup fails with a structured error through the existing application error path
- **AND** the runtime does not silently initialize a fallback browser OCC runtime with different threading behavior

### Requirement: App-owned OCC assets SHALL include pthread helper worker delivery
The application SHALL serve the pthread-enabled OpenCascade runtime and any helper worker assets it requires from the app-owned OCC asset set in dev, preview, and production.

#### Scenario: Browser requests OCC runtime assets
- **WHEN** the browser requests the pthread-enabled OpenCascade bootstrap module, wasm module, or required helper worker assets
- **THEN** the application serves those assets from app-owned same-origin URLs
- **AND** runtime asset resolution does not depend on third-party or toolchain-default remote paths

#### Scenario: Browser runtime resolves pthread helper worker path
- **WHEN** the pthread-enabled OpenCascade runtime asks the application loader to locate a helper worker asset
- **THEN** the loader resolves the correct app-owned helper worker URL for the active build
- **AND** the runtime does not fail because the helper worker asset path is missing or ambiguous

### Requirement: Threaded OCC deployment SHALL share one header contract across environments
The application SHALL serve browser pages and OCC worker assets with one explicit header and policy contract across local development, preview, and production so the threaded OCC runtime starts consistently in every supported environment.

#### Scenario: Local development starts threaded OCC
- **WHEN** a developer runs the local browser app and the OCC runtime starts
- **THEN** the served page and worker assets satisfy the policy requirements needed by the pthread-enabled OCC runtime
- **AND** the local runtime behavior matches the supported production runtime shape

#### Scenario: Production or preview starts threaded OCC
- **WHEN** a production or preview deployment serves the browser app and the OCC runtime starts
- **THEN** the served page and worker assets satisfy the same policy requirements used by local development
- **AND** deployment-specific configuration does not leave the threaded OCC runtime in a different startup mode than local development
