## 1. Export Contracts

- [x] 1.1 Add typed export format, option, request, result, and diagnostic contracts for STL, STEP, 3MF, and cadara.
- [x] 1.2 Add runtime validation schemas and default option helpers for each supported file type.
- [x] 1.3 Add focused `bun:test` coverage for option defaults, invalid option rejection, and discriminated request parsing.

## 2. Export Service Boundary

- [x] 2.1 Add a modeling service export method that accepts the typed request and returns a download-ready payload or diagnostics.
- [x] 2.2 Implement cadara export as stable JSON serialization of the current durable document payload.
- [x] 2.3 Implement mock adapter export behavior for geometry formats so UI and service tests can run without OpenCascade serialization.
- [x] 2.4 Implement OpenCascade-backed STL, STEP, and 3MF export paths or explicit unavailable diagnostics for unsupported adapter cases.
- [x] 2.5 Add service/adapter tests for cadara JSON output, unexportable targets, and successful geometry export payload metadata.

## 3. Export Modal UI

- [x] 3.1 Build a Mantine export modal that shows STL, STEP, 3MF, and cadara format choices.
- [x] 3.2 Show mesh accuracy controls only for STL and 3MF, STEP-specific controls only for STEP, and cadara JSON options only for cadara.
- [x] 3.3 Wire modal submission to the export service with pending, success, validation failure, and thrown-error states.
- [x] 3.4 Add a small browser download helper and unit coverage proving successful exports trigger one download with the returned filename, MIME type, and payload.

## 4. Context Menu Integration

- [x] 4.1 Replace the Parts & Objects export placeholder handler with modal-opening state scoped to the selected row target and label.
- [x] 4.2 Preserve the existing Delete placeholder behavior and context menu keyboard/right-click behavior.
- [x] 4.3 Add component/domain tests proving Export opens the modal and no longer shows the placeholder status message.

## 5. Verification

- [x] 5.1 Run `bun run test`.
- [x] 5.2 Run `bun run lint`.
