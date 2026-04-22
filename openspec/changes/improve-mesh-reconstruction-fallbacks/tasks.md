## 1. Reconstruction Contracts

- [ ] 1.1 Add reconstruction result classification types for analytic, faceted fallback, rejected, and future mesh-body exception.
- [ ] 1.2 Add durable reconstruction provenance fields for algorithm id/version, settings, source hash, result classification, and quality metrics.
- [ ] 1.3 Add diagnostics for uncertain analytic recovery, faceted fallback limits, and disabled mesh-body fallback.
- [ ] 1.4 Add contract tests for provenance and classification validation.

## 2. Analytic Recovery

- [ ] 2.1 Add conservative planar region detection and validation.
- [ ] 2.2 Add conservative cylindrical region detection and validation.
- [ ] 2.3 Add confidence thresholds that prefer rejection or faceted fallback over speculative analytic surfaces.
- [ ] 2.4 Add reconstruction tests for clean planes, clean cylinders, noisy near-misses, and unsupported shapes.

## 3. Fallback Policy

- [ ] 3.1 Enforce strict rejection when neither analytic nor acceptable faceted geometry can be produced.
- [ ] 3.2 Add faceted baked geometry fallback behind explicit quality and size limits.
- [ ] 3.3 Keep persistent mesh-body fallback disabled and reported as unsupported.
- [ ] 3.4 Add tests for A>B>C fallback ordering and source mesh non-retention.

## 4. UI And Verification

- [ ] 4.1 Show reconstruction classification, warnings, settings, and quality diagnostics before commit.
- [ ] 4.2 Require user acceptance for faceted fallback results.
- [ ] 4.3 Verify restore uses baked assets without rerunning reconstruction from discarded source meshes.
- [ ] 4.4 Run `bun run test`, `bun run lint`, and `bun run build`.
