## 1. Reconstruction Contracts

- [x] 1.1 Add reconstruction result classification types for analytic, faceted fallback, rejected, and future mesh-body exception.
- [x] 1.2 Add durable reconstruction provenance fields for algorithm id/version, settings, source hash, result classification, and quality metrics.
- [x] 1.3 Add diagnostics for uncertain analytic recovery, faceted fallback limits, and disabled mesh-body fallback.
- [x] 1.4 Add contract tests for provenance and classification validation.

## 2. Analytic Recovery

- [x] 2.1 Add conservative planar region detection and validation.
- [x] 2.2 Add conservative cylindrical region detection and validation.
- [x] 2.3 Add confidence thresholds that prefer rejection or faceted fallback over speculative analytic surfaces.
- [x] 2.4 Add reconstruction tests for clean planes, clean cylinders, noisy near-misses, and unsupported shapes.

## 3. Fallback Policy

- [x] 3.1 Enforce strict rejection when neither analytic nor acceptable faceted geometry can be produced.
- [x] 3.2 Add faceted baked geometry fallback behind explicit quality and size limits.
- [x] 3.3 Keep persistent mesh-body fallback disabled and reported as unsupported.
- [x] 3.4 Add tests for A>B>C fallback ordering and source mesh non-retention.

## 4. UI And Verification

- [x] 4.1 Show reconstruction classification, warnings, settings, and quality diagnostics before commit.
- [x] 4.2 Require user acceptance for faceted fallback results.
- [x] 4.3 Verify restore uses baked assets without rerunning reconstruction from discarded source meshes.
- [x] 4.4 Run `bun run test`, `bun run lint`, and `bun run build`.
