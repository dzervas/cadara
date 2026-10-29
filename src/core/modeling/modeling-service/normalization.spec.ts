import { test, expect } from "vitest";

import { isExpressionAuthoredValue } from "@/contracts/modeling/authored-values";
import {
  normalizeShellFeatureParameters,
  normalizeWorkspaceSnapshot,
} from "@/core/modeling/modeling-service/normalization";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  requireSketchDefinition,
  requireSolvedSketchSnapshot,
  validateSketchDefinition,
  validateSketchRecord,
  validateSolvedSketchSnapshot,
  validateSolverRegionRecord,
} from "@/contracts/sketch/runtime-schema";
import { solveSketchDefinitionCore } from "@/core/sketch-solver";
import { literalResolvedDefinition } from "@/contracts/sketch/region-extraction.fixtures";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { deleteSelectedSketchGeometry } from "@/core/editor/sketch-session";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import {
  eid,
  entityRef,
  mirroredSession,
} from "@/core/editor/sketch-mirror.fixtures";

// Lane: logic (per docs/testing.md — persistence/runtime validation seam).
// T17o (E2, [TECH] T17-14): the hand-written sketch normalizer
// (`normalizeSketches` → `normalizeSketchRecord`/`normalizeSketchDefinition`,
// `normalizeSolvedSketchSnapshot`) had no production consumer and is
// deleted; its rows are ported to the Typia validators of the persistence
// boundary (`@/contracts/sketch/runtime-schema`), which every caller uses.
// Entity- and relationship-level payloads are checked inside a minimal
// sketch definition (`definitionWith`).
const NORMALIZATION_SKETCH_ID = "sketch_normalization";

function definitionWith(input: {
  pointIds?: readonly string[];
  entities?: readonly unknown[];
  derivedRelationships?: readonly unknown[];
}) {
  const pointIds = input.pointIds ?? [];
  const entities = (input.entities ?? []) as { entityId: string }[];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: [...pointIds],
    points: pointIds.map((pointId) => ({
      pointId,
      label: pointId,
      target: {
        kind: "sketchPoint",
        sketchId: NORMALIZATION_SKETCH_ID,
        pointId,
      },
      position: [0, 0],
      isConstruction: false,
    })),
    entityIds: entities.map((entity) => entity.entityId),
    entities: [...entities],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    ...(input.derivedRelationships
      ? { derivedRelationships: [...input.derivedRelationships] }
      : {}),
  };
}

/** The relationship as the persistence boundary parses it (throws when rejected). */
const parseRelationship = (relationship: unknown) =>
  requireSketchDefinition(
    definitionWith({ derivedRelationships: [relationship] }),
  ).derivedRelationships![0]!;

const SPLINE_POINT_IDS = ["sketch_point_middle", "sketch_point_alias"];

/** The entity as the persistence boundary parses it (throws when rejected). */
const parseEntity = (entity: unknown) =>
  requireSketchDefinition(
    definitionWith({ pointIds: SPLINE_POINT_IDS, entities: [entity] }),
  ).entities[0]!;

function makeOffsetPayload(overrides: Record<string, unknown> = {}) {
  return {
    derivationId: "sketch_derivation_1_offset",
    label: "offset 1",
    kind: "offset",
    seedEntityIds: ["sketch_entity_seed"],
    distance: { source: "expression", valueText: "wall / 2" },
    jointPolicy: "trimExtendArcFallback",
    piecewiseCubicOutputs: [],
    jointOutputs: [
      {
        firstSeedEntityId: "sketch_entity_seed",
        secondSeedEntityId: "sketch_entity_seed_b",
        outputEntityId: "sketch_entity_joint",
        centerPointId: "sketch_point_jc",
        startPointId: "sketch_point_js",
        endPointId: "sketch_point_je",
      },
    ],
    outputs: [
      {
        seedEntityId: "sketch_entity_seed",
        outputEntityId: "sketch_entity_offset",
        instanceIndex: 1,
        seedPointIds: ["sketch_point_a", "sketch_point_b"],
        outputPointIds: ["sketch_point_oa", "sketch_point_ob"],
      },
    ],
    ...overrides,
  };
}

function makeShellPayload(overrides: Record<string, unknown> = {}) {
  return {
    bodyTarget: { kind: "body", bodyId: "body_shell" },
    faceTargets: [{ kind: "face", bodyId: "body_shell", faceId: "face_top" }],
    thickness: 1,
    direction: "inside",
    operation: "join",
    booleanScope: { kind: "targetBody", bodyId: "body_shell" },
    ...overrides,
  };
}

function makeSplinePayload() {
  return {
    kind: "spline",
    entityId: "sketch_entity_spline",
    label: "Spline",
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_normalization",
      entityId: "sketch_entity_spline",
    },
    isConstruction: false,
    pointOccurrenceIds: [
      "occurrence-start",
      "occurrence-middle",
      "occurrence-end",
    ],
    pointOccurrences: [
      {
        occurrenceId: "occurrence-middle",
        pointId: "sketch_point_middle",
        tangent: { kind: "authored", vector: [0, 0] },
      },
      {
        occurrenceId: "occurrence-end",
        pointId: "sketch_point_alias",
        tangent: { kind: "automatic" },
      },
      {
        occurrenceId: "occurrence-start",
        pointId: "sketch_point_alias",
        tangent: { kind: "automatic" },
      },
    ],
    closure: "positional",
    interpolationPolicy: "centripetal-mean-arm-v1",
  };
}

test("src/domain/modeling/modeling-service/normalization.spec.ts", () => {
  const normalized = parseRelationship(makeOffsetPayload());
  expect(
    normalized.kind === "offset" && normalized.jointPolicy,
    "A valid offset payload should normalize to the offset kind with its joint policy.",
  ).toBe("trimExtendArcFallback");
  expect(
    normalized.kind === "offset" && normalized.jointOutputs.length,
    "Joint outputs should survive normalization.",
  ).toBe(1);
  expect(
    normalized.kind === "offset" &&
      isExpressionAuthoredValue(normalized.distance),
    "An authored expression distance should survive normalization.",
  ).toBeTruthy();

  expect(
    () => parseRelationship(makeOffsetPayload({ jointPolicy: "bogusPolicy" })),
    "An unknown joint policy should be rejected at the persistence boundary.",
  ).toThrow();

  expect(
    () =>
      parseRelationship(
        makeOffsetPayload({
          jointOutputs: [{ firstSeedEntityId: "sketch_entity_seed" }],
        }),
      ),
    "A malformed joint output payload should be rejected at the persistence boundary.",
  ).toThrow();

  expect(
    () => parseRelationship(makeOffsetPayload({ jointOutputs: "nope" })),
    "A non-array jointOutputs field should be rejected at the persistence boundary.",
  ).toThrow();
});

test("spline normalization rejects unknown fields without changing authored ordering or tangent intent", () => {
  const payload = makeSplinePayload();
  const normalized = parseEntity(payload);
  expect(normalized).toEqual(payload);
  expect(normalized.kind).toBe("spline");
  if (normalized.kind !== "spline") return;
  expect(normalized.pointOccurrenceIds).toEqual([
    "occurrence-start",
    "occurrence-middle",
    "occurrence-end",
  ]);
  expect(
    normalized.pointOccurrences.map(({ occurrenceId }) => occurrenceId),
  ).toEqual(["occurrence-middle", "occurrence-end", "occurrence-start"]);
  expect(normalized.pointOccurrences[0]?.tangent).toEqual({
    kind: "authored",
    vector: [0, 0],
  });
  expect(normalized.pointOccurrences[1]?.pointId).toBe("sketch_point_alias");
  expect(normalized.pointOccurrences[2]?.pointId).toBe("sketch_point_alias");
  expect(normalized.closure).toBe("positional");

  expect(() => parseEntity({ ...payload, unknownEntityField: true })).toThrow();
  expect(() =>
    parseEntity({
      ...payload,
      pointOccurrences: [
        { ...payload.pointOccurrences[0], unknownOccurrenceField: true },
        ...payload.pointOccurrences.slice(1),
      ],
    }),
  ).toThrow();
  expect(() =>
    parseEntity({
      ...payload,
      pointOccurrences: [
        {
          ...payload.pointOccurrences[0],
          tangent: {
            ...payload.pointOccurrences[0]!.tangent,
            unknownTangentField: true,
          },
        },
        ...payload.pointOccurrences.slice(1),
      ],
    }),
  ).toThrow();
});

// Seam: the spline entity persistence boundary carries T10g's option-B field
// explicitly (a dropped field would silently change the shape on reload).
test("spline normalization carries endSpanParameterLengths and rejects malformed shapes", () => {
  const payload = makeSplinePayload();
  expect("endSpanParameterLengths" in parseEntity(payload)).toBe(false);
  for (const fields of [{ start: 0.5 }, { end: 2 }, { start: 0.5, end: 2 }]) {
    const stored = JSON.parse(
      JSON.stringify({ ...payload, endSpanParameterLengths: fields }),
    );
    const normalized = parseEntity(stored);
    expect(normalized).toEqual(stored);
    expect(
      normalized.kind === "spline" && normalized.endSpanParameterLengths,
    ).toEqual(fields);
    // Round trip: parsing the parsed record is the identity.
    expect(parseEntity(JSON.parse(JSON.stringify(normalized)))).toEqual(
      normalized,
    );
  }
  // Values are judged by reconstructSpline (A-7), not here.
  expect(
    parseEntity({
      ...payload,
      endSpanParameterLengths: { start: -1 },
    }),
  ).toMatchObject({ endSpanParameterLengths: { start: -1 } });
  for (const malformed of [{}, { start: 1, other: 2 }, { end: "2" }, 3, null])
    expect(
      () =>
        parseEntity({
          ...payload,
          endSpanParameterLengths: malformed,
        }),
      JSON.stringify(malformed),
    ).toThrow();
});

// Lane: logic (per docs/testing.md — shell parameter normalization is a domain
// contract boundary with no UI or browser dependency).
// Seam: normalizeShellFeatureParameters distinguishes legacy open-face shells,
// closed cavities, and whole-solid offsets before OCC execution.
test("normalizes split-boundary vertex records without accepting partial or legacy segments", () => {
  const circleBranch = {
    source: { kind: "entity", entityId: "sketch_entity_circle" },
    spanId: "whole",
  };
  const chordBranch = {
    source: { kind: "entity", entityId: "sketch_entity_chord" },
    spanId: "whole",
  };
  const crossing = (position: [number, number], key: string) => ({
    kind: "verifiedIntersection",
    key,
    position,
    witness: {
      first: { branch: chordBranch, parameter: 0, parameterBounds: [0, 0] },
      second: {
        branch: circleBranch,
        parameter: Math.PI,
        parameterBounds: [Math.PI, Math.PI],
      },
      classification: "crossing",
      proof: "exactImplicitLineRootSet",
    },
  });
  const segment = {
    branch: circleBranch,
    sourceParameterInterval: [0, Math.PI],
    traversalDirection: "forward",
    start: crossing([2, 0], "x-right"),
    end: crossing([-2, 0], "x-left"),
    sourceSegmentOrdinal: 1,
  };
  const payload = [
    {
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_split",
      ownerBodyId: null,
      regionId: "region_split",
      signature: "split region signature",
      label: "Split region",
      target: {
        kind: "region",
        sketchId: "sketch_split",
        regionId: "region_split",
      },
      sourceSketch: { kind: "sketch", sketchId: "sketch_split" },
      loops: [
        {
          loopId: "region_loop_split_0",
          role: "outer",
          orientation: "counterClockwise",
          segments: [segment],
          isClosed: true,
        },
      ],
      isClosed: true,
    },
  ];
  const withSegment = (replacement: Record<string, unknown>) => [
    {
      ...payload[0],
      loops: [{ ...payload[0]!.loops[0], segments: [replacement] }],
    },
  ];
  // T17o (E2): the persistence boundary's region validator (Typia).
  const parseRegions = (value: readonly unknown[]) =>
    value.map((record) => {
      const result = validateSolverRegionRecord(record);
      if (!result.success) throw new Error("Invalid region record payload.");
      return result.data;
    });
  const normalized = parseRegions(payload);
  expect(normalized[0]?.loops[0]?.segments[0]?.start?.position).toEqual([2, 0]);
  expect(normalized[0]?.loops[0]?.segments[0]?.end?.position).toEqual([-2, 0]);
  expect(normalized[0]?.loops[0]?.segments[0]?.sourceSegmentOrdinal).toBe(1);
  expect(
    () => parseRegions(withSegment({ ...segment, end: undefined })),
    "A split boundary segment without its end vertex is rejected.",
  ).toThrow("Invalid region record payload");
  expect(
    () =>
      parseRegions(
        withSegment({
          ...segment,
          startPosition: [2, 0],
          endPosition: [-2, 0],
        }),
      ),
    "The removed position fields are rejected: there is no dual representation.",
  ).toThrow("Invalid region record payload");
});

test("normalizes shell closedHollow and offsetAllFaces without weakening open-face validation", () => {
  const openFaces = normalizeShellFeatureParameters(makeShellPayload());
  expect(
    openFaces.mode,
    "Legacy shell payloads should remain open-face shells.",
  ).toBeUndefined();
  expect(openFaces.faceTargets.length).toBe(1);

  const closedHollow = normalizeShellFeatureParameters(
    makeShellPayload({ mode: "closedHollow", faceTargets: [] }),
  );
  expect(closedHollow.mode).toBe("closedHollow");
  expect(closedHollow.faceTargets).toEqual([]);
  expect(closedHollow.direction).toBe("inside");

  const offsetAll = normalizeShellFeatureParameters(
    makeShellPayload({ mode: "offsetAllFaces", faceTargets: [] }),
  );
  expect(offsetAll.mode).toBe("offsetAllFaces");
  expect(offsetAll.faceTargets).toEqual([]);
  expect(offsetAll.direction).toBe("inside");

  expect(() =>
    normalizeShellFeatureParameters(
      makeShellPayload({ mode: "offsetAllFaces" }),
    ),
  ).toThrow("cannot include face targets");
  expect(() =>
    normalizeShellFeatureParameters(
      makeShellPayload({
        mode: "closedHollow",
        faceTargets: [],
        direction: "outside",
      }),
    ),
  ).toThrow("requires an inside direction");
  expect(() =>
    normalizeShellFeatureParameters(makeShellPayload({ faceTargets: [] })),
  ).toThrow("at least one removable face");
});

// T15b (T-7, T-8): same-version persistence of a datum-axis mirror and of the
// solved `failedDerivationIds` (normalization + runtime validation seams).
test("T15b: a sketch-datum mirror and failedDerivationIds round-trip through normalization and runtime validation; unknown datums and dangling/duplicate failed ids are rejected", async () => {
  const pid = (id: string) => `sketch_point_${id}` as SketchPointId;
  const eid = (id: string) => `sketch_entity_${id}` as SketchEntityId;
  const point = (id: string, position: readonly [number, number]) => ({
    pointId: pid(id),
    label: id,
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_primary",
      pointId: pid(id),
    },
    position,
    isConstruction: false,
  });
  const line = (id: string, a: string, b: string) => ({
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: eid(id),
    },
    isConstruction: false,
    startPointId: pid(a),
    endPointId: pid(b),
  });
  const mirror = (
    derivationId: string,
    mirrorReference: unknown,
    seed: string,
    output: string,
    seedPoints: string[],
    outputPoints: string[],
  ) => ({
    derivationId,
    label: derivationId,
    kind: "mirror",
    seedEntityIds: [eid(seed)],
    mirrorReference,
    outputs: [
      {
        seedEntityId: eid(seed),
        outputEntityId: eid(output),
        instanceIndex: 1,
        seedPointIds: seedPoints.map(pid),
        outputPointIds: outputPoints.map(pid),
      },
    ],
  });
  const datumMirror = mirror(
    "sketch_derivation_1_mirror",
    { kind: "sketchDatum", datum: "xAxis" },
    "ab",
    "mab",
    ["a", "b"],
    ["ma", "mb"],
  );
  const brokenMirror = mirror(
    "sketch_derivation_2_mirror",
    { kind: "lineEntity", entityId: eid("missing_axis") },
    "cd",
    "mcd",
    ["c", "d"],
    ["mc", "md"],
  );
  const definition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: ["a", "b", "ma", "mb", "c", "d", "mc", "md"].map(pid),
    points: [
      point("a", [1, 1]),
      point("b", [3, 2]),
      point("ma", [1, -1]),
      point("mb", [3, -2]),
      point("c", [5, 5]),
      point("d", [6, 5]),
      point("mc", [9, 9]),
      point("md", [10, 9]),
    ],
    entityIds: ["ab", "mab", "cd", "mcd"].map(eid),
    entities: [
      line("ab", "a", "b"),
      line("mab", "ma", "mb"),
      line("cd", "c", "d"),
      line("mcd", "mc", "md"),
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    derivedRelationships: [datumMirror, brokenMirror],
  } as unknown as SketchDefinition;

  // The datum kind persists as authored (same version, no migration).
  const stored = JSON.parse(JSON.stringify(datumMirror));
  expect(parseRelationship(stored)).toEqual(datumMirror);
  expect(validateSketchDefinition(definition).success).toBe(true);
  for (const datum of ["origin", "zAxis"])
    expect(() =>
      parseRelationship({
        ...stored,
        mirrorReference: { kind: "sketchDatum", datum },
      }),
    ).toThrow(/derivedRelationships\[0\]/);
  expect(
    validateSketchDefinition({
      ...definition,
      derivedRelationships: [
        {
          ...datumMirror,
          mirrorReference: { kind: "sketchDatum", datum: "origin" },
        },
      ],
    }).success,
  ).toBe(false);

  const snapshot = solveSketchDefinitionCore({
    definition: literalResolvedDefinition(definition),
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-3,
    },
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;
  expect(snapshot.failedDerivationIds).toEqual(["sketch_derivation_2_mirror"]);
  const roundTrip = requireSolvedSketchSnapshot(
    JSON.parse(JSON.stringify(snapshot)),
  );
  expect(roundTrip).toEqual(snapshot);
  expect(validateSolvedSketchSnapshot(roundTrip).success).toBe(true);
  const duplicate = validateSolvedSketchSnapshot({
    ...snapshot,
    failedDerivationIds: [
      "sketch_derivation_2_mirror",
      "sketch_derivation_2_mirror",
    ],
  });
  expect(
    duplicate.success ? [] : duplicate.issues.map((issue) => issue.message),
  ).toContain(
    "Failed derived relationship ids must name each relationship once.",
  );
  const base = (
    await new MockKernelAdapter().getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
    })
  ).snapshot.document.sketches[0]!.sketch;
  const record = (ids: string[]) =>
    validateSketchRecord({
      ...structuredClone(base),
      definition,
      solvedSnapshot: { ...snapshot, failedDerivationIds: ids },
      regions: [],
    });
  expect(record(["sketch_derivation_2_mirror"]).success).toBe(true);
  const dangling = record(["sketch_derivation_unknown"]);
  expect(
    dangling.success ? [] : dangling.issues.map((issue) => issue.message),
  ).toContain(
    "A failed derived relationship id must reference an existing mirror, pattern or transform relationship.",
  );
  // Review A4: an id without its relationship's error diagnostic is rejected.
  const withoutError = validateSolvedSketchSnapshot({
    ...snapshot,
    diagnostics: snapshot.diagnostics.filter(
      (diagnostic) => diagnostic.severity !== "error",
    ),
  });
  expect(
    withoutError.success
      ? []
      : withoutError.issues.map((issue) => issue.message),
  ).toContain(
    "A failed derived relationship id must have its relationship's error diagnostic.",
  );
  expect(() =>
    requireSolvedSketchSnapshot({ ...snapshot, failedDerivationIds: [1] }),
  ).toThrow(/failedDerivationIds\[0\]/);
  // T17d (B4): the persistence boundary keeps the carried reasons.
  expect(snapshot.failedDerivationReasons).toEqual({
    sketch_derivation_2_mirror: ["axisMissing"],
  });
  expect(() =>
    requireSolvedSketchSnapshot({
      ...snapshot,
      failedDerivationReasons: { sketch_derivation_2_mirror: ["axisBent"] },
    }),
  ).toThrow(/failedDerivationReasons/);
}, 120_000);

// T17d (B4, [TECH] T17-6; logic lane, seams: the workspace snapshot's
// worker-transport validation (`normalizeWorkspaceSnapshot`), the solved
// snapshot's runtime validation).
// The carried reasons round-trip; they must name exactly the failed
// relationships, each with one or more distinct reasons from the closed
// union. Red on base: the field is absent from the solve and unknown to
// every seam (typia rejects it as an extra property).
test("T17d B4: failedDerivationReasons cross the worker transport and runtime validation; mismatched, empty, duplicate, unknown and missing reasons are rejected", async () => {
  const { session } = mirroredSession("free");
  const broken = deleteSelectedSketchGeometry(enterSketchSession(session), [
    entityRef(session, eid("axis")),
  ]);
  const snapshot = broken.liveSolve!.solvedSnapshot;
  const [derivationId] = snapshot.failedDerivationIds ?? [];
  expect(derivationId, "premise: the mirror failed").toBeDefined();
  const reasons = { [derivationId!]: ["axisMissing"] };
  expect(snapshot.failedDerivationReasons).toEqual(reasons);
  expect(validateSolvedSketchSnapshot(snapshot).success).toBe(true);
  const messages = (value: unknown) => {
    const result = validateSolvedSketchSnapshot(value);
    return result.success ? [] : result.issues.map((issue) => issue.message);
  };
  const exactly =
    "Failed derived relationship reasons must name exactly the failed relationships.";
  const distinct =
    "A failed derived relationship must carry one or more distinct reasons.";
  expect(
    messages({
      ...snapshot,
      failedDerivationReasons: { other: ["axisMissing"] },
    }),
  ).toContain(exactly);
  expect(
    messages({ ...snapshot, failedDerivationReasons: undefined }),
  ).toContain(exactly);
  expect(
    messages({ ...snapshot, failedDerivationReasons: { [derivationId!]: [] } }),
  ).toContain(distinct);
  expect(
    messages({
      ...snapshot,
      failedDerivationReasons: {
        [derivationId!]: ["axisMissing", "axisMissing"],
      },
    }),
  ).toContain(distinct);
  expect(
    validateSolvedSketchSnapshot({
      ...snapshot,
      failedDerivationReasons: { [derivationId!]: ["axisBent"] },
    }).success,
    "the reason union is closed",
  ).toBe(false);

  // Worker transport: the committed record's reasons survive the workspace
  // snapshot's validation; an unknown reason is refused there.
  const adapter = new MockKernelAdapter();
  const request = {
    contractVersion: CONTRACT_VERSION,
    documentId: "doc_workspace",
  } as const;
  const before = await adapter.getDocumentSnapshot(request);
  const commit = await adapter.commitSketch({
    ...request,
    baseRevisionId: before.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_t17d",
      projectionRequestId: "request_t17d:project",
      validationRequestId: "request_t17d:validate",
      solveRequestId: "request_t17d:solve",
      regionRequestId: "request_t17d:regions",
    },
    sketchId: null,
    sketchLabel: "Broken mirror",
    plane: before.snapshot.document.sketches[0]!.plane,
    definition: broken.definition,
  } as never);
  const workspace = (await adapter.getDocumentSnapshot(request)).snapshot;
  const recordIndex = workspace.document.sketches.findIndex(
    (entry) => entry.sketchId === commit.sketchId,
  );
  const transported = normalizeWorkspaceSnapshot(structuredClone(workspace));
  expect(
    transported.document.sketches[recordIndex]!.sketch.solvedSnapshot
      .failedDerivationReasons,
  ).toEqual(reasons);
  const forged = structuredClone(workspace);
  forged.document.sketches[
    recordIndex
  ]!.sketch.solvedSnapshot!.failedDerivationReasons = {
    [derivationId!]: ["axisBent"],
  } as never;
  expect(() => normalizeWorkspaceSnapshot(forged)).toThrow();
}, 120_000);

// cadara-lyi: the snapshot boundary still validates every mesh, but returns an
// exact valid mesh as is, so an unchanged mesh keeps its identity (and the
// viewport its GPU geometry) across snapshots.
test("snapshot normalization validates meshes and keeps an exact valid mesh's identity", async () => {
  const adapter = new MockKernelAdapter();
  const workspace = (
    await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
    })
  ).snapshot;
  const meshIndex = workspace.document.render.records.findIndex(
    (record) => record.geometry.kind === "mesh",
  );
  expect(meshIndex).toBeGreaterThanOrEqual(0);
  const normalized = normalizeWorkspaceSnapshot(workspace);
  expect(normalized.document.render.records[meshIndex]!.geometry).toBe(
    workspace.document.render.records[meshIndex]!.geometry,
  );

  const forged = structuredClone(workspace);
  const geometry = forged.document.render.records[meshIndex]!.geometry;
  if (geometry.kind !== "mesh") throw new Error("Expected a mesh.");
  geometry.triangleIndices = new Uint32Array([
    0,
    1,
    geometry.vertexPositions.length / 3,
  ]);
  expect(() => normalizeWorkspaceSnapshot(forged)).toThrow(
    "Mesh triangle indices must reference existing vertex positions.",
  );
});
