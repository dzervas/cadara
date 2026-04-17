## Context

The workbench already exposes an Export action in the Parts & Objects context menu, but that handler only reports that export is not implemented. The authoritative document state is available through the current workspace snapshot, where `snapshot.document` is the durable kernel-owned JSON payload and presentation rows are derived UI view models.

Geometry generation already belongs behind the modeling/kernel boundary. The export flow must therefore avoid placing STL, STEP, or 3MF serialization in React components. The UI should collect intent and options, then call a typed service operation that can use the mock or OpenCascade-backed implementation.

## Goals / Non-Goals

**Goals:**
- Open a Mantine export modal from the existing Parts & Objects Export context action.
- Support STL, STEP, 3MF, and cadara as explicit format choices.
- Keep cadara as a raw JSON document download based on the authoritative durable document payload.
- Add format-specific options, with mesh accuracy controls for tessellated formats.
- Add typed export request/result contracts and validation so unsupported options fail before download.
- Keep export errors visible in the modal and avoid producing invalid files.

**Non-Goals:**
- Importing cadara or any other exported format.
- Adding cloud storage, share links, or long-running job infrastructure.
- Exporting arbitrary viewport-only presentation state.
- Adding selection workflows beyond exporting the object row that invoked the context action.
- Reworking unrelated context menu actions.

## Decisions

### Add a document export contract at the modeling boundary

Add typed export request and result shapes for `stl`, `step`, `3mf`, and `cadara`. The request should include the current document/revision envelope, the selected target from the context menu, and one discriminated options object per format. The result should return bytes or text, MIME type, file extension, suggested filename, and diagnostics.

Alternative considered: have the modal call format-specific helper functions directly. That would be smaller at first, but it couples React to serialization details and makes mock/OCC parity difficult to test.

### Treat cadara as raw durable document JSON

The cadara exporter should serialize the current `KernelDocumentSnapshot` (`snapshot.document`) with stable JSON formatting and download it with a `.cadara` extension. It should not wrap the payload in an archive or mix in presentation-only rows.

Alternative considered: export the full `WorkspaceSnapshot`. That includes duplicated compatibility fields and UI-derived presentation data, which makes the native file less durable and harder to treat as the raw document.

### Keep format-specific options discriminated by file type

Use one options schema per format:

- STL: mesh accuracy, binary/ascii encoding.
- 3MF: mesh accuracy, units, and metadata inclusion.
- STEP: STEP schema/profile and units, without mesh accuracy controls.
- cadara: JSON formatting option only if implementation needs compact versus readable output.

The modal should show only options relevant to the selected file type and reset or ignore incompatible options when the file type changes.

Alternative considered: one generic `accuracy` field for every format. That would expose meaningless controls for STEP/cadara and push avoidable validation errors into the export layer.

### Download only after a successful export result

The modal should keep a pending state while export runs, render diagnostics or thrown errors inline, and trigger a browser download only when the export result is successful. The download helper should live outside the modal as a small utility so it can be unit-tested without Mantine.

Alternative considered: close the modal immediately and report failures through the global status message. Keeping the modal open gives users a clear place to adjust options and retry.

### Preserve existing action bus semantics

The context menu should continue to dispatch/handle the existing Export action location, but the placeholder handler should become a modal opener that captures the target and label. Toolbar action contracts do not need to change for this slice.

Alternative considered: add Export as a toolbar tool first. The user asked for the export context button, and the existing context action is the narrowest surface to make functional.

## Risks / Trade-offs

- [Kernel serialization gaps] OpenCascade.js may expose different browser serialization paths per format. Mitigation: keep format generation behind the modeling export boundary and return diagnostics when a format is unavailable for the current adapter.
- [Large binary memory use] STL and 3MF can be large in browser memory. Mitigation: generate one export at a time, return `BlobPart`-friendly data, and avoid storing successful payloads in React state after triggering download.
- [Target ambiguity] Some Parts & Objects rows may represent groups or non-body targets. Mitigation: validate the target before export and show a modal diagnostic when no exportable geometry exists.
- [Cadara compatibility] Native JSON can drift as contracts evolve. Mitigation: include existing contract/schema version fields unchanged in the exported document and avoid transforming the payload during export.
- [Option mismatch] Users may switch formats after editing options. Mitigation: use discriminated defaults and validate the final request immediately before calling the export service.

## Migration Plan

1. Add export contract types, runtime schemas, default option helpers, and focused tests.
2. Add modeling service export methods for cadara and mock geometry behavior, then thread the adapter-facing operation through the existing service provider.
3. Implement OpenCascade-backed serialization per supported geometry format, returning explicit diagnostics for unsupported or empty targets.
4. Replace the Parts & Objects export placeholder with modal state and submit handling.
5. Add modal/component tests for file type switching, option visibility, pending/error states, and download invocation.

Rollback is straightforward before users depend on generated files: restore the placeholder handler and remove the service method. Once cadara downloads are used externally, compatibility should be handled by preserving the exported document schema versions rather than changing prior file contents.

## Open Questions

- Should the first implementation export only the selected object row, or should body/part rows be allowed to export the entire document when the selected row is a grouping node?
- Should STL default to binary for smaller files, or ASCII for easier inspection while the feature is new?
