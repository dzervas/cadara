## Why

The repository has strong architecture guidance in `INTERFACE.md`, `ADAPTER.md`, and `OCC.md`, but that guidance is mostly design prose rather than normative product requirements. There is also a visible interaction failure today where left click selection does nothing, which indicates the selection and render-binding contract is not explicit enough across the frontend, adapter, and kernel boundary. Converting the durable parts into OpenSpec keeps frontend, adapter, and kernel work aligned before more CAD behavior is added.

## What Changes

- Add a capability spec that defines the required separation between the frontend editor layer, the modeling service boundary, and kernel implementations.
- Add a capability spec that defines the strict CAD modeling contract around typed durable references, versioned payloads, preview behavior, and render-to-reference round trips.
- Add a capability spec that defines the obligations of an OCC-backed kernel adapter, including faithful contract implementation and explicit handling of known contract gaps.
- Capture the expectation that primary viewport selection interactions, including left click selection, resolve through the same durable reference and render-binding path instead of failing silently.

## Capabilities

### New Capabilities
- `frontend-modeling-boundary`: Defines the required separation between UI/editor concerns, the frontend-facing modeling service, and kernel implementations.
- `durable-modeling-contract`: Defines the required shape of the CAD kernel interface exposed to the frontend, including typed IDs, versioning, previews, and render bindings.
- `occ-kernel-adapter`: Defines how an OpenCascade-backed adapter must satisfy the public modeling contract without leaking kernel details into the frontend.

### Modified Capabilities

## Impact

- Affected areas include `src/contracts/**`, `src/domain/modeling/**`, editor state and service boundaries, and future OCC adapter work.
- Adds normative requirements for contract versioning, durable primitive identity, render binding behavior, and explicit rejection of unsupported contract cases.
- Covers the broken left-click selection path as a contract-relevant interaction failure tied to pick-to-reference round trips.
- Clarifies that kernel implementations remain replaceable behind the same frontend-facing modeling boundary.
