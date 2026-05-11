# Adapter Protocol Overview

This document is the Phase 7 operator-facing overview for the public editor, solver, modeling, and render contracts under `src/contracts/`.

The goal is blunt:

- a solver implementer should understand exactly what the frontend sends and expects back
- a kernel implementer should understand durable identity, revision, invalidation, preview, and render export semantics without reverse-engineering the UI
- the UI should consume documented typed payloads rather than hidden conventions

## Contract Families

The contract surface is intentionally split into narrow packages:

- `src/contracts/shared/`
  Shared IDs, durable references, ownership metadata, version literals, and identity policy.
- `src/contracts/sketch/`
  Authored sketch graph, solved sketch payloads, and derived region records.
- `src/contracts/solver/`
  Dedicated sketch-solver request and response envelopes.
- `src/contracts/modeling/`
  Durable document snapshot, feature mutation, sketch commit, preview, and reference-resolution contracts.
- `src/contracts/render/`
  Renderer-neutral mesh/polyline/marker export plus semantic pick bindings.
- `src/contracts/editor/`
  Pure editor state machine events, effects, and view-state contracts.

## Versioning Rules

Every contract family is versioned explicitly.

- `contractVersion`
  Shared top-level modeling boundary version. Present on solver and modeling request/response envelopes.
- `schemaVersion`
  Payload-family version for snapshots, sketches, solved sketches, and render export.
- `featureTypeVersion`
  Per-feature-family schema version carried by each feature definition variant.
- `solverSchemaVersion`
  Dedicated version for the sketch-solver contract family.

Implementers must reject unsupported versions explicitly. They must not infer compatibility from field coincidence.

Current version literals:

- `contractVersion = "modeling-contract/v1alpha1"`
- `solverSchemaVersion = "sketch-solver/v1alpha1"`
- `DocumentSnapshot.schemaVersion = "document-snapshot/v1alpha1"`
- `SketchDefinition.schemaVersion = "sketch-definition/v1alpha1"`
- `SolvedSketchSnapshot.schemaVersion = "solved-sketch/v1alpha1"`
- `RenderExport.schemaVersion = "render-export/v1alpha1"`
- `FeatureDefinition.featureTypeVersion = "feature-type/v1alpha1"`

## Identity And Ownership

Durable IDs are typed template-literal brands such as `DocumentId`, `RevisionId`, `FeatureId`, `SketchId`, `BodyId`, `FaceId`, and `RegionId`.

Durable selections and downstream references always use structured refs such as:

```ts
{ kind: 'face', bodyId: 'body_main', faceId: 'face_top' }
{ kind: 'region', sketchId: 'sketch_profile', regionId: 'region_outer' }
```

The protocol does not use array position, row order, or string parsing as the primary meaning of a durable target.

Ownership is explicit on snapshot and resolution records through:

- `ownerDocumentId`
- `ownerRevisionId`
- `ownerFeatureId`
- `ownerSketchId`
- `ownerBodyId`

## Revision And Correlation Semantics

All durable mutations and preview operations are evaluated against an explicit base revision.

- `baseRevisionId`
  The committed document revision against which a mutation or preview must run.
- `requestId`
  The async correlation key for editor or solver workflows.
- `previewId`
  The transient identity for one preview evaluation request/response family.

Callers must discard stale results by comparing the echoed correlation data and freshness/revision metadata. Implementers must not silently rebase requests onto a newer revision.

## Diagnostics And Invalidation

Diagnostics are machine-readable first.

- `ModelingDiagnostic`
  Top-level kernel/modeling diagnostic with structured `detail`.
- `SketchSolveDiagnostic`
  Solver diagnostic with a stable `code`, `severity`, and typed local target.
- `InvalidReferenceDetailPayload`
  Exact invalid durable target plus reason and ownership context.

When topology or sketch state changes destroy a durable target, the backend must report invalidation explicitly. Silent remapping to "closest surviving geometry" is forbidden.

## Render Export Semantics

Render export is renderer-neutral and selection-driven.

- geometry is one of `mesh`, `polyline`, or `marker`
- each render record carries one explicit `binding`
- durable identity lives in `binding.target`
- viewport-only IDs such as `RenderableId` and `PickId` are transient

Selection and highlight logic must use the binding target and semantic class. The UI must not infer face-vs-edge meaning from renderer-specific geometry layout.

## Worked Examples

The examples below are the canonical Phase 7 reference flows. Matching typed example fixtures also live in `src/contracts/shared/contract-examples.spec.ts`.

Failure semantics are part of the contract examples too:

- revision-sensitive operations must report explicit revision conflict or stale-result state instead of silently rebasing
- invalid durable references must carry structured invalidation payloads, not just human-readable diagnostics
- null ownership means "not applicable for this record", not "backend omitted data"
- worked examples below show both success-path request shapes and the failure-path fields that must still be populated

### Solve Sketch

This flow is explicit and ordered:

1. project external references
2. validate the authored sketch definition
3. solve the sketch
4. optionally derive regions

```ts
const sketchDefinition: SketchDefinition = {
  schemaVersion: "sketch-definition/v1alpha1",
  referenceIds: [],
  references: [],
  pointIds: [
    "sketch_point_a",
    "sketch_point_b",
    "sketch_point_c",
    "sketch_point_d",
  ],
  points: [
    {
      pointId: "sketch_point_a",
      label: "A",
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_profile",
        pointId: "sketch_point_a",
      },
      position: [0, 0],
      isConstruction: false,
    },
    {
      pointId: "sketch_point_b",
      label: "B",
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_profile",
        pointId: "sketch_point_b",
      },
      position: [4, 0],
      isConstruction: false,
    },
    {
      pointId: "sketch_point_c",
      label: "C",
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_profile",
        pointId: "sketch_point_c",
      },
      position: [4, 3],
      isConstruction: false,
    },
    {
      pointId: "sketch_point_d",
      label: "D",
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_profile",
        pointId: "sketch_point_d",
      },
      position: [0, 3],
      isConstruction: false,
    },
  ],
  entityIds: [
    "sketch_entity_bottom",
    "sketch_entity_right",
    "sketch_entity_top",
    "sketch_entity_left",
  ],
  entities: [
    {
      kind: "lineSegment",
      entityId: "sketch_entity_bottom",
      label: "Bottom",
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_profile",
        entityId: "sketch_entity_bottom",
      },
      isConstruction: false,
      startPointId: "sketch_point_a",
      endPointId: "sketch_point_b",
    },
    {
      kind: "lineSegment",
      entityId: "sketch_entity_right",
      label: "Right",
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_profile",
        entityId: "sketch_entity_right",
      },
      isConstruction: false,
      startPointId: "sketch_point_b",
      endPointId: "sketch_point_c",
    },
    {
      kind: "lineSegment",
      entityId: "sketch_entity_top",
      label: "Top",
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_profile",
        entityId: "sketch_entity_top",
      },
      isConstruction: false,
      startPointId: "sketch_point_c",
      endPointId: "sketch_point_d",
    },
    {
      kind: "lineSegment",
      entityId: "sketch_entity_left",
      label: "Left",
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_profile",
        entityId: "sketch_entity_left",
      },
      isConstruction: false,
      startPointId: "sketch_point_d",
      endPointId: "sketch_point_a",
    },
  ],
  constraintIds: [],
  constraints: [],
  dimensionIds: [],
  dimensions: [],
};
```

```ts
const projectRequest: ProjectSketchExternalReferencesRequest = {
  contractVersion: "modeling-contract/v1alpha1",
  solverSchemaVersion: "sketch-solver/v1alpha1",
  requestId: "request_project_1",
  documentId: "doc_workspace",
  revisionId: "rev_7",
  sketchId: "sketch_profile",
  plane: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
    linearUnit: "documentLength",
    handedness: "rightHanded",
  },
  tolerances: {
    coincidence: 0.0001,
    angleRadians: 0.0001,
    minimumSegmentLength: 0.001,
  },
  references: [],
};
```

```ts
const solveRequest: SolveSketchRequest = {
  contractVersion: "modeling-contract/v1alpha1",
  solverSchemaVersion: "sketch-solver/v1alpha1",
  requestId: "request_solve_1",
  documentId: "doc_workspace",
  revisionId: "rev_7",
  sketchId: "sketch_profile",
  plane: projectRequest.plane,
  tolerances: projectRequest.tolerances,
  partialSolvePolicy: "bestEffort",
  definition: sketchDefinition,
  projectedReferences: [],
  incrementalEdit: null,
};
```

The solver response echoes request identity and returns:

- `status`
- `solvedSnapshot`
- `derivedRegions`
- `diagnostics`

Interpretation rules:

- `revisionId` is the exact committed revision against which solving ran.
- `definition` is authored input, never solved output.
- `projectedReferences` is the only authoritative external-geometry input in sketch space.
- `derivedRegions` may be empty even when solving succeeds.

Representative success response shape:

```ts
const solveSketchResponse: SolveSketchResponse = {
  contractVersion: "modeling-contract/v1alpha1",
  solverSchemaVersion: "sketch-solver/v1alpha1",
  requestId: "request_solve_1",
  documentId: "doc_workspace",
  revisionId: "rev_7",
  sketchId: "sketch_profile",
  status: "fullyConstrained",
  solvedSnapshot: {
    schemaVersion: "solved-sketch/v1alpha1",
    status: "fullyConstrained",
    solvedEntities: [
      {
        entityId: "sketch_entity_bottom",
        kind: "lineSegment",
        startPosition: [0, 0],
        endPosition: [4, 0],
      },
    ],
    solvedPoints: [
      {
        pointId: "sketch_point_a",
        target: {
          kind: "sketchPoint",
          sketchId: "sketch_profile",
          pointId: "sketch_point_a",
        },
        solvedPosition: [0, 0],
      },
    ],
    constraintStatuses: [],
    dimensionStatuses: [],
    diagnostics: [],
  },
  derivedRegions: [
    {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_7",
      ownerFeatureId: null,
      ownerSketchId: "sketch_profile",
      ownerBodyId: null,
      regionId: "region_outer",
      label: "Outer profile",
      target: {
        kind: "region",
        sketchId: "sketch_profile",
        regionId: "region_outer",
      },
      sourceSketch: { kind: "sketch", sketchId: "sketch_profile" },
      boundaryEntityIds: ["sketch_entity_bottom"],
      boundaryPointIds: ["sketch_point_a"],
      isClosed: true,
    },
  ],
  diagnostics: [],
};
```

### Create Extrude

Extrude creation always uses one typed `FeatureDefinition` payload. There is no side-band target array.

```ts
const createExtrudeRequest: CreateFeatureRequest = {
  contractVersion: "modeling-contract/v1alpha1",
  documentId: "doc_workspace",
  baseRevisionId: "rev_7",
  definition: {
    kind: "extrude",
    featureTypeVersion: "feature-type/v1alpha1",
    parameters: {
      profile: {
        kind: "region",
        sketchId: "sketch_profile",
        regionId: "region_outer",
      },
      depth: 12,
      direction: "oneSided",
      operation: "newBody",
    },
  },
};
```

The kernel response reports revision acceptance and rebuild outcome explicitly through:

- `revisionState`
- `rebuildResult`
- `changedTargets`
- `diagnostics`

Representative success response shape:

```ts
const createExtrudeResponse: CreateFeatureResponse = {
  contractVersion: "modeling-contract/v1alpha1",
  documentId: "doc_workspace",
  revisionId: "rev_8",
  revisionState: {
    kind: "accepted",
    baseRevisionId: "rev_7",
  },
  rebuildResult: {
    kind: "rebuilt",
    revisionId: "rev_8",
    invalidatedTargets: [],
    diagnostics: [],
  },
  changedTargets: [
    { kind: "feature", featureId: "feature_extrude_1" },
    { kind: "body", bodyId: "body_main" },
    { kind: "face", bodyId: "body_main", faceId: "face_side_1" },
  ],
  diagnostics: [],
  featureId: "feature_extrude_1",
};
```

### Preview Extrude

Preview evaluation uses the same typed feature definition family as create/update, but the result is transient.

```ts
const previewExtrudeRequest: EvaluatePreviewRequest = {
  contractVersion: "modeling-contract/v1alpha1",
  documentId: "doc_workspace",
  baseRevisionId: "rev_7",
  previewId: "preview_extrude_1",
  definition: createExtrudeRequest.definition,
};
```

The response must not mutate committed state. It returns:

- `previewId`
- `revisionId`
- `freshness`
- transient `render`
- `diagnostics`

If the preview was evaluated against a stale revision, the kernel reports `freshness.kind === 'stale'` and the caller discards it.

Representative stale response shape:

```ts
const previewExtrudeResponse: EvaluatePreviewResponse = {
  contractVersion: "modeling-contract/v1alpha1",
  documentId: "doc_workspace",
  revisionId: "rev_8",
  previewId: "preview_extrude_1",
  freshness: {
    kind: "stale",
    requestedRevisionId: "rev_7",
    currentRevisionId: "rev_8",
  },
  render: {
    schemaVersion: "render-export/v1alpha1",
    records: [],
  },
  diagnostics: [
    {
      code: "preview.staleRevision",
      severity: "warning",
      message: "Preview response is stale and must be discarded.",
      target: null,
      detail: {
        kind: "stalePreview",
        previewId: "preview_extrude_1",
        requestedRevisionId: "rev_7",
        currentRevisionId: "rev_8",
      },
    },
  ],
};
```

### Resolve Dead Reference

Reference resolution is explicit even when the target no longer resolves.

```ts
const resolveReferenceRequest: ResolveReferenceRequest = {
  contractVersion: "modeling-contract/v1alpha1",
  documentId: "doc_workspace",
  target: {
    kind: "face",
    bodyId: "body_main",
    faceId: "face_deleted",
  },
};
```

The resolution response still returns a `ResolvedReferenceRecord`, but `resolution.invalidation` explains why the target is dead. This lets the editor present actionable failure state without parsing `message`.

```ts
const resolveReferenceResponse: ResolveReferenceResponse = {
  contractVersion: "modeling-contract/v1alpha1",
  resolution: {
    label: "Deleted face",
    target: {
      kind: "face",
      bodyId: "body_main",
      faceId: "face_deleted",
    },
    ownerDocumentId: "doc_workspace",
    ownerRevisionId: "rev_8",
    ownerFeatureId: "feature_extrude_1",
    ownerSketchId: null,
    ownerBodyId: "body_main",
    invalidation: {
      reason: "deletedByRebuild",
      target: {
        kind: "face",
        bodyId: "body_main",
        faceId: "face_deleted",
      },
      ownerFeatureId: "feature_extrude_1",
      ownerSketchId: null,
      sourceTarget: null,
    },
  },
  diagnostics: [],
};
```

### Export Render Mesh With Bindings

Render export records are selection-capable because each record includes a semantic binding.

```ts
const renderExport: RenderExport = {
  schemaVersion: "render-export/v1alpha1",
  records: [
    {
      id: "renderable_face_1",
      label: "Extrude Side Face",
      ownerBodyId: "body_main",
      ownerFeatureId: "feature_extrude_1",
      binding: {
        pickId: "pick_face_1",
        pickPriority: 10,
        topology: "face",
        semanticClass: "bodyFace",
        target: {
          kind: "face",
          bodyId: "body_main",
          faceId: "face_side_1",
        },
      },
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
        ],
        vertexNormals: null,
        triangleIndices: [[0, 1, 2]],
      },
    },
  ],
};
```

The viewport may use `id` and `pickId` transiently, but durable selection must round-trip through `binding.target`.

## Implementer Notes

- Treat every array documented as canonical order as authoritative ordering, not incidental serialization.
- Treat `null` ownership fields as intentionally absent ownership, not unresolved data.
- Treat diagnostics as machine-readable first and human-readable second.
- Reject unsupported feature kinds, reference kinds, schema versions, or revision bases explicitly.
