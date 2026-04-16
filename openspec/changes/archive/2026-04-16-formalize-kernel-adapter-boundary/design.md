## Context

The source documents agree on a strict architectural split: the editor owns interaction and local previews, the modeling service/adapter owns durable frontend-facing operations, and the CAD kernel owns committed model state, topology, regeneration, and render export. They also repeatedly require typed durable references, explicit versioning, and deterministic request/response behavior so a kernel implementer can work from the contracts alone.

The gap today is not lack of ideas but lack of normative spec coverage. Important rules such as "no direct kernel calls from React components", "no array-order primitive addressing", and "do not hide OCC contract gaps behind guessed behavior" should live in OpenSpec so later implementation work has a stable target.

## Goals / Non-Goals

**Goals:**
- Capture the stable architectural requirements from the three source documents as compact OpenSpec capabilities.
- Preserve the separation between frontend/editor behavior and kernel implementation behavior.
- Make the public CAD kernel interface requirements explicit enough for adapter and contract work.
- Record OCC-specific implementation obligations without turning the spec into a low-level API dump.

**Non-Goals:**
- Reproduce every implementation phase or file-level recommendation from the source documents.
- Expand the current public contracts or resolve every contract gap in this change.
- Specify UI styling, scene composition details, or tool-level workflows outside the contract boundary.

## Decisions

Create three focused capabilities instead of one umbrella spec. The documents describe three separable concerns: architecture boundaries, contract behavior, and OCC implementation policy. Keeping them separate makes later changes easier to scope and avoids mixing backend implementation rules into frontend-facing requirements.

Treat typed identity, versioning, preview isolation, and render binding as contract requirements rather than implementation notes. These behaviors are core to making a CAD kernel swappable and to preventing frontend code from depending on incidental topology order.

Capture OCC behavior at the adapter-policy level, not at the raw API-call level. `OCC.md` lists verified OCJS APIs, but the more durable spec value is that an OCC-backed adapter must implement the existing `ModelingKernelAdapter` surface faithfully, keep internal plane geometry private when the contract lacks it, and reject unsupported contract cases explicitly instead of inventing semantics.

Avoid modifying existing sketch-oriented capabilities. The current OpenSpec tree already covers sketch-entry behavior. This change adds cross-cutting modeling and adapter capabilities that those sketch specs can depend on later.

## Risks / Trade-offs

- [Some guidance in the source docs is implementation advice rather than product behavior] → Mitigate by only encoding rules that are stable, testable, and contract-worthy.
- [A spec that is too broad could duplicate the source documents] → Mitigate by splitting the change into three compact capabilities with limited scope.
- [OCC-specific requirements can drift from the public contracts] → Mitigate by making the OCC spec subordinate to the public modeling contract and requiring explicit rejection for unsupported cases.
