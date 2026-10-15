import { expect, test } from "vitest";

import {
  validateSketchDefinition,
  validateSketchRecord,
} from "@/contracts/sketch/runtime-schema";
import type {
  DimensionDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import {
  makeReferenceDimensionCases,
  makeReferenceDimensionSketch,
  withDimensions,
} from "@/contracts/sketch/reference-dimension.fixtures";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
} from "@/contracts/modeling/authored-values";
import {
  offsetSeedSession,
  withOffset,
} from "@/domain/editor/sketch-offset.fixtures";
import { eid } from "@/domain/editor/sketch-mirror.fixtures";
import { readFileSync } from "node:fs";
import {
  validateDeriveSketchRegionsRequest,
  validateSolveSketchRequest,
} from "@/contracts/solver/runtime-schema";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { DEFAULT_MOCK_SKETCH_PLANE_FRAME } from "@/domain/solver/mock-sketch-solver-adapter";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  FIXTURE_SKETCH_ID,
  literalResolvedDefinition,
} from "@/contracts/sketch/region-extraction.fixtures";

// Lane: logic. Seam: strict current sketch-record runtime contract.
test("invalid and stale sketch derivations cannot carry consumable regions", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const current = snapshot.snapshot.document.sketches[0]!.sketch;
  expect(validateSketchRecord(current).success).toBe(true);

  const invalidWithCachedRegions = structuredClone(current);
  invalidWithCachedRegions.derivedValidity = {
    state: "invalid",
    diagnostics: [
      {
        code: "missing-geometry",
        severity: "error",
        message: "Missing geometry.",
        target: null,
      },
    ],
  };
  expect(validateSketchRecord(invalidWithCachedRegions).success).toBe(false);

  const staleWithCachedRegions = structuredClone(current);
  staleWithCachedRegions.derivedValidity = {
    state: "stale",
    diagnostics: [],
  };
  expect(validateSketchRecord(staleWithCachedRegions).success).toBe(false);
});

test("equal-offset persists as a strict normal constraint", () => {
  const point = (index: number, x: number, y: number) => ({
    pointId: `sketch_point_equal_offset_${index}`,
    label: `Point ${index}`,
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_equal_offset",
      pointId: `sketch_point_equal_offset_${index}`,
    },
    position: [x, y],
    isConstruction: false,
  });
  const points = [
    point(0, 0, 0),
    point(1, 4, 0),
    point(2, 0, 2),
    point(3, 4, 2),
    point(4, 0, 6),
    point(5, 4, 6),
    point(6, 0, 8),
    point(7, 4, 8),
  ];
  const entities = [0, 1, 2, 3].map((index) => ({
    kind: "lineSegment",
    entityId: `sketch_entity_equal_offset_${index}`,
    label: `Line ${index}`,
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_equal_offset",
      entityId: `sketch_entity_equal_offset_${index}`,
    },
    isConstruction: false,
    startPointId: points[index * 2]!.pointId,
    endPointId: points[index * 2 + 1]!.pointId,
  }));
  const constraint = {
    constraintId: "constraint_equal_offset",
    kind: "equalOffset",
    label: "Equal offsets",
    pairs: [
      {
        seedEntityId: entities[0]!.entityId,
        offsetEntityId: entities[1]!.entityId,
        side: "left",
      },
      {
        seedEntityId: entities[2]!.entityId,
        offsetEntityId: entities[3]!.entityId,
        side: "right",
      },
    ],
  };
  const definition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: entities.map((entry) => entry.entityId),
    entities,
    constraintIds: [constraint.constraintId],
    constraints: [constraint],
    dimensionIds: [],
    dimensions: [],
  };

  const persisted = JSON.parse(JSON.stringify(definition));
  expect(validateSketchDefinition(persisted).success).toBe(true);
  expect(persisted.constraints).toEqual([constraint]);

  const unknown = structuredClone(persisted);
  unknown.constraints[0].kind = "offsetRelationship";
  expect(validateSketchDefinition(unknown).success).toBe(false);

  const malformed = structuredClone(persisted);
  malformed.constraints[0].pairs = [malformed.constraints[0].pairs[0]];
  expect(validateSketchDefinition(malformed).success).toBe(false);

  const invalidSide = structuredClone(persisted);
  invalidSide.constraints[0].pairs[1].side = "outside";
  expect(validateSketchDefinition(invalidSide).success).toBe(false);
});

test("ordinary splines round-trip only in the current aggregate format", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const definition = structuredClone(
    snapshot.snapshot.document.sketches[0]!.sketch.definition,
  );
  const [first, second] = definition.pointIds;
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  definition.entityIds.push("sketch_entity_spline_contract");
  definition.entities.push({
    kind: "spline",
    entityId: "sketch_entity_spline_contract",
    label: "Spline contract",
    target: {
      kind: "sketchEntity",
      sketchId: definition.points[0]!.target.sketchId,
      entityId: "sketch_entity_spline_contract",
    },
    isConstruction: false,
    pointOccurrenceIds: ["occurrence-a", "occurrence-b"],
    pointOccurrences: [
      {
        occurrenceId: "occurrence-a",
        pointId: first!,
        tangent: { kind: "automatic" },
      },
      {
        occurrenceId: "occurrence-b",
        pointId: second!,
        tangent: { kind: "authored", vector: [0, 0] },
      },
    ],
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
  });

  const roundTrip = JSON.parse(JSON.stringify(definition));
  expect(validateSketchDefinition(roundTrip).success).toBe(true);

  const oldFormat = structuredClone(roundTrip) as Record<string, unknown>;
  const oldEntity = (oldFormat.entities as Array<Record<string, unknown>>).at(
    -1,
  )!;
  delete oldEntity.pointOccurrenceIds;
  delete oldEntity.pointOccurrences;
  delete oldEntity.closure;
  delete oldEntity.interpolationPolicy;
  oldEntity.fitPointIds = [first, second];
  oldEntity.degree = 3;
  expect(validateSketchDefinition(oldFormat).success).toBe(false);
});

test("T10g option B: endSpanParameterLengths is structural here; a bad value loads as an invalid spline", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const base = structuredClone(
    snapshot.snapshot.document.sketches[0]!.sketch.definition,
  );
  const [first, second] = base.points;
  base.entityIds.push("sketch_entity_spline_trimmed");
  base.entities.push({
    kind: "spline",
    entityId: "sketch_entity_spline_trimmed",
    label: "Trimmed spline",
    target: {
      kind: "sketchEntity",
      sketchId: first!.target.sketchId,
      entityId: "sketch_entity_spline_trimmed",
    },
    isConstruction: false,
    pointOccurrenceIds: ["occurrence-a", "occurrence-b"],
    pointOccurrences: [
      {
        occurrenceId: "occurrence-a",
        pointId: first!.pointId,
        tangent: { kind: "authored", vector: [1, 0] },
      },
      {
        occurrenceId: "occurrence-b",
        pointId: second!.pointId,
        tangent: { kind: "automatic" },
      },
    ],
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
    endSpanParameterLengths: { start: 0.75 },
  });
  const withFields = (fields: unknown) => {
    const definition = JSON.parse(JSON.stringify(base));
    definition.entities.at(-1).endSpanParameterLengths = fields;
    return definition;
  };
  const splineOf = (definition: SketchDefinition) => {
    const entity = definition.entities.at(-1)!;
    if (entity.kind !== "spline") throw new Error("Expected the spline");
    return reconstructSplineAggregate(
      entity,
      Object.fromEntries(
        definition.points.map((point) => [point.pointId, point.position]),
      ),
    );
  };

  const persisted = validateSketchDefinition(JSON.parse(JSON.stringify(base)));
  expect(persisted.success).toBe(true);
  if (persisted.success)
    expect(splineOf(persisted.data).validity).toBe("valid");
  expect(
    validateSketchDefinition(withFields({ start: 0.75, end: 0.75 })).success,
  ).toBe(true);

  // Structure: a non-empty object of known numeric keys.
  const empty = validateSketchDefinition(withFields({}));
  expect(empty.success).toBe(false);
  if (!empty.success)
    expect(empty.issues.map((issue) => issue.path)).toEqual([
      `entities.${base.entities.length - 1}.endSpanParameterLengths`,
    ]);
  expect(
    validateSketchDefinition(withFields({ start: 1, middle: 2 })).success,
  ).toBe(false);
  expect(validateSketchDefinition(withFields({ start: "1" })).success).toBe(
    false,
  );

  // Values (A-7): judged by reconstructSpline, so the document still loads.
  for (const fields of [{ start: 0 }, { end: -2 }, { start: 1, end: 2 }]) {
    const loaded = validateSketchDefinition(withFields(fields));
    expect(loaded.success, JSON.stringify(fields)).toBe(true);
    if (loaded.success)
      expect(splineOf(loaded.data)).toEqual({
        validity: "invalid",
        diagnostics: [{ code: "invalid-end-span-parameter-length" }],
        spans: [],
      });
  }
});

// T13d (D9), contract seam: a numeric dimension is driving (value) or a
// reference (`reference: true`, no value), never both; arc endpoint bindings
// cannot be references; the same-version JSON round trip keeps the marker.
test("T13d D9′: validation accepts driving and reference shapes of every numeric kind and rejects invalid ones", () => {
  const cases = makeReferenceDimensionCases();
  const sketch = makeReferenceDimensionSketch();
  const check = (dimensions: readonly unknown[]) =>
    validateSketchDefinition(
      JSON.parse(
        JSON.stringify(
          withDimensions(sketch, dimensions as DimensionDefinition[]),
        ),
      ),
    ).success;

  for (const entry of cases) {
    expect(check([entry.driving]), `${entry.name}: driving`).toBe(true);
    expect(check([entry.reference]), `${entry.name}: reference`).toBe(true);
    const valueKey =
      entry.driving.kind === "lineAngle" ? "valueRadians" : "value";
    // D9′ (review A-2): a reference may keep its last driving value.
    expect(
      check([
        { ...entry.reference, [valueKey]: createLiteralAuthoredValue(1) },
      ]),
      `${entry.name}: a reference keeping a value is accepted`,
    ).toBe(true);
    expect(
      check([{ ...entry.driving, reference: true }]),
      `${entry.name}: a driving dimension marked reference is a reference`,
    ).toBe(true);
    expect(
      check([{ ...entry.reference, reference: "yes" }]),
      `${entry.name}: a non-true marker is rejected`,
    ).toBe(false);
    expect(
      check([{ ...entry.reference, reference: false }]),
      `${entry.name}: reference: false is rejected`,
    ).toBe(false);
    expect(
      check([{ ...entry.driving, reference: false }]),
      `${entry.name}: a driving dimension with reference: false is rejected`,
    ).toBe(false);
    const neither: Record<string, unknown> = { ...entry.driving };
    delete neither[valueKey];
    expect(
      check([neither]),
      `${entry.name}: neither a value nor the reference marker is rejected`,
    ).toBe(false);
  }

  const binding = {
    dimensionId: "dimension_arc_start",
    kind: "arcStartPointCoincident",
    label: "Arc start",
    entityId: "sketch_entity_arc",
    pointId: "sketch_point_g",
  };
  expect(check([binding]), "premise: the binding is valid").toBe(true);
  expect(
    check([{ ...binding, reference: true }]),
    "an arc endpoint binding cannot be a reference",
  ).toBe(false);
  expect(
    check([{ ...binding, kind: "arcEndPointCoincident", reference: true }]),
  ).toBe(false);

  const roundTrip = JSON.parse(
    JSON.stringify(
      withDimensions(
        sketch,
        cases.map((entry) => entry.reference),
      ),
    ),
  );
  const validated = validateSketchDefinition(roundTrip);
  expect(validated.success).toBe(true);
  expect(
    validated.success && validated.data.dimensions,
    "same-version round trip keeps every reference dimension exactly",
  ).toEqual(cases.map((entry) => entry.reference));
});

// T17p2 (F-2), logic lane, contract seam: the persistence validators
// (`validateSketchDefinition`, `validateSketchRecord`, and the file-open
// `parseAuthoredModelDocument`). A sketch dimension value has one
// representation, the authored wrapper; a bare number (driving, or a
// reference's kept value) or any other non-wrapper is rejected with a
// readable reason, never converted. Red on base: the field was typed `any`,
// so every such value was accepted.
test("T17p2 F-2: a bare or non-wrapper dimension value in a current-version sketch is rejected explicitly, by every persistence entry point", async () => {
  const cases = makeReferenceDimensionCases();
  const sketch = makeReferenceDimensionSketch();
  const definition = (dimensions: readonly unknown[]) =>
    JSON.parse(
      JSON.stringify(
        withDimensions(sketch, dimensions as DimensionDefinition[]),
      ),
    );
  const issues = (dimensions: readonly unknown[]) => {
    const result = validateSketchDefinition(definition(dimensions));
    return result.success ? [] : result.issues;
  };
  for (const entry of cases) {
    const valueKey =
      entry.driving.kind === "lineAngle" ? "valueRadians" : "value";
    const wrapped = (entry.driving as Record<string, unknown>)[valueKey] as {
      source: "literal";
      value: number;
    };
    expect(wrapped.source, `${entry.name}: premise, wrapped`).toBe("literal");
    expect(issues([entry.driving]), `${entry.name}: wrapped`).toEqual([]);
    for (const [name, value] of [
      ["bare number", wrapped.value],
      ["string", "garbage"],
      ["null", null],
      ["bare wrapper value", { source: "literal", value: "5" }],
    ] as const) {
      const found = issues([{ ...entry.driving, [valueKey]: value }]);
      expect(
        found.length,
        `${entry.name}: ${name} is rejected`,
      ).toBeGreaterThan(0);
      if (name === "bare wrapper value") continue;
      expect(found[0], `${entry.name}: ${name}: the readable reason`).toEqual({
        path: `dimensions.0.${valueKey}`,
        expected: "an authored value",
        value,
        message: `Sketch dimension ‘${entry.driving.label}’ stores its value as ${JSON.stringify(value)}; a dimension value must be an authored value ({"source": "literal", "value": …} or {"source": "expression", "valueText": …}). Bare values are not supported and are not converted.`,
      });
    }
    // D9′: a reference may keep a value, but only an authored one.
    expect(
      issues([{ ...entry.reference, [valueKey]: wrapped.value }]).length,
      `${entry.name}: a reference keeping a bare value is rejected`,
    ).toBeGreaterThan(0);
  }

  // The stored record and the file-open path reject the same shape.
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const record = structuredClone(
    snapshot.snapshot.document.sketches[0]!.sketch,
  );
  expect(validateSketchRecord(JSON.parse(JSON.stringify(record))).success).toBe(
    true,
  );
  const [first] = record.definition.dimensions;
  expect(first?.kind, "premise: the seed's first dimension").toBe("distance");
  const bareRecord = JSON.parse(JSON.stringify(record));
  bareRecord.definition.dimensions[0].value = 8;
  const recordResult = validateSketchRecord(bareRecord);
  expect(recordResult.success).toBe(false);
  expect(!recordResult.success && recordResult.issues[0]?.path).toBe(
    "definition.dimensions.0.value",
  );

  const logo = JSON.parse(readFileSync("public/logo.cadara", "utf8"));
  expect(
    parseAuthoredModelDocument(logo).ok,
    "the shipped logo (wrapped values) opens",
  ).toBe(true);
  const bareLogo = structuredClone(logo);
  const logoDimension = bareLogo.sketches[0].definition.dimensions[0];
  expect(logoDimension.value, "premise: the logo's wrapped value").toEqual({
    source: "literal",
    value: 20,
  });
  logoDimension.value = 20;
  expect(parseAuthoredModelDocument(bareLogo)).toEqual({
    ok: false,
    diagnostic: {
      reasonCode: "invalid-authored-document",
      message: `Sketch dimension ‘${logoDimension.label}’ stores its value as 20; a dimension value must be an authored value ({"source": "literal", "value": …} or {"source": "expression", "valueText": …}). Bare values are not supported and are not converted.`,
    },
  });
});

// T13d (D9), contract seam: the stored-record and authored-document entry
// points (persistence, collaborative sync, file open, modeling service and
// the OCC adapter all parse documents through parseAuthoredModelDocument)
// enforce the same one-representation invariant.
test("T13d D9′: sketch records and authored documents carry reference dimensions and reject invalid shapes", async () => {
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const cases = makeReferenceDimensionCases();
  const sketch = makeReferenceDimensionSketch();
  const circle = cases.find((entry) => entry.name === "circleRadius")!;
  const shapes = {
    reference: [circle.reference, ...cases.map((entry) => entry.driving)],
    neither: [{ ...circle.reference, reference: undefined }],
    falseMarker: [{ ...circle.reference, reference: false }],
  };
  const record = (dimensions: readonly unknown[]) => {
    const current = structuredClone(
      snapshot.snapshot.document.sketches[0]!.sketch,
    );
    current.definition = withDimensions(
      sketch,
      dimensions as DimensionDefinition[],
    );
    return JSON.parse(JSON.stringify(current));
  };
  const document = (dimensions: readonly unknown[]) => {
    const authored = createAuthoredModelDocumentFromSnapshot(snapshot.snapshot);
    authored.sketches[0]!.definition = withDimensions(
      sketch,
      dimensions as DimensionDefinition[],
    );
    return JSON.parse(JSON.stringify(authored));
  };
  expect(validateSketchRecord(record(shapes.reference)).success).toBe(true);
  // D9′ (review A-2): a reference that kept a value opens, as a reference.
  const kept = { ...circle.reference, value: createLiteralAuthoredValue(2) };
  expect(validateSketchRecord(record([kept])).success).toBe(true);
  const keptDocument = parseAuthoredModelDocument(document([kept]));
  expect(keptDocument.ok).toBe(true);
  expect(
    keptDocument.ok &&
      keptDocument.document.sketches[0]!.definition.dimensions[0],
  ).toEqual(kept);
  const parsed = parseAuthoredModelDocument(document(shapes.reference));
  expect(
    parsed.ok,
    "an authored document opens with a reference dimension",
  ).toBe(true);
  expect(
    parsed.ok && parsed.document.sketches[0]!.definition.dimensions[0],
    "the document round trip keeps the reference dimension",
  ).toEqual(circle.reference);
  for (const [name, dimensions] of Object.entries(shapes)) {
    if (name === "reference") continue;
    expect(
      validateSketchRecord(record(dimensions)).success,
      `record: ${name}`,
    ).toBe(false);
    expect(
      parseAuthoredModelDocument(document(dimensions)).ok,
      `document: ${name}`,
    ).toBe(false);
  }
});

// T17p2 review R-1, logic lane, contract seam: file open
// (`parseAuthoredModelDocument`). The readable bare-value reason is for
// current-version files only: a file of an unsupported document or sketch
// version reports its version, whatever its dimension values look like.
test("T17p2 R-1: an unsupported-version file with a bare dimension value reports its version, not the bare value", () => {
  const logo = JSON.parse(readFileSync("public/logo.cadara", "utf8"));
  const bare = structuredClone(logo);
  bare.sketches[0].definition.dimensions[0].value = 20;
  const message = (document: unknown) => {
    const parsed = parseAuthoredModelDocument(document);
    return parsed.ok ? null : parsed.diagnostic.message;
  };
  expect(
    message(bare),
    "premise: current versions give the bare reason",
  ).toMatch(/stores its value as 20/);
  const oldDocument = structuredClone(bare);
  oldDocument.schemaVersion = "authored-model-document/v1alpha0";
  const oldSketch = structuredClone(bare);
  oldSketch.sketches[0].definition.schemaVersion = "sketch-definition/v1alpha1";
  for (const [name, document] of [
    ["document version", oldDocument],
    ["sketch version", oldSketch],
  ] as const)
    expect(message(document), name).toBe(
      "Authored model document schema version is not supported.",
    );
});

// T17p3, logic lane, contract seam: the persistence validators
// (`validateSketchDefinition`, `validateSketchRecord`, and the file-open
// `parseAuthoredModelDocument`). An offset relationship's distance has one
// representation, the authored wrapper (the Offset tool writes a literal
// one); a bare number or any other non-wrapper is rejected with a readable
// reason, never converted. Red on base: the field was typed `any` and the
// validator accepted a finite bare number.
test("T17p3: a bare or non-wrapper offset distance in a current-version sketch is rejected explicitly, by every persistence entry point", async () => {
  const { session, relationship } = withOffset(
    offsetSeedSession(),
    [eid("l1"), eid("l2")],
    1,
  );
  const authored = JSON.parse(JSON.stringify(session.definition));
  const index = authored.derivedRelationships.findIndex(
    (entry: { derivationId: string }) =>
      entry.derivationId === relationship.derivationId,
  );
  expect(
    authored.derivedRelationships[index].distance,
    "premise: the Offset tool authored a literal wrapper",
  ).toEqual(createLiteralAuthoredValue(0.5));
  const withDistance = (distance: unknown) => {
    const definition = structuredClone(authored);
    definition.derivedRelationships[index].distance = distance;
    return definition;
  };
  const issues = (distance: unknown) => {
    const result = validateSketchDefinition(withDistance(distance));
    return result.success ? [] : result.issues;
  };
  const reason = (distance: unknown) =>
    `Sketch offset ‘${relationship.label}’ stores its distance as ${JSON.stringify(distance)}; an offset distance must be an authored value ({"source": "literal", "value": …} or {"source": "expression", "valueText": …}). Bare values are not supported and are not converted.`;
  expect(issues(createLiteralAuthoredValue(0.5)), "literal").toEqual([]);
  expect(
    issues(createExpressionAuthoredValue("wall / 2")),
    "expression",
  ).toEqual([]);
  for (const [name, value] of [
    ["bare number", 0.5],
    ["string", "garbage"],
    ["null", null],
  ] as const)
    expect(issues(value)[0], `${name}: the readable reason`).toEqual({
      path: `derivedRelationships.${index}.distance`,
      expected: "an authored value",
      value,
      message: reason(value),
    });
  for (const [name, value] of [
    ["non-numeric literal", { source: "literal", value: "5" }],
    ["non-finite literal", createLiteralAuthoredValue(Number.NaN)],
  ] as const)
    expect(issues(value).length, `${name} is rejected`).toBeGreaterThan(0);

  // The stored record and the file-open path reject the same shape.
  const snapshot = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const record = (distance: unknown) => {
    const current = structuredClone(
      snapshot.snapshot.document.sketches[0]!.sketch,
    );
    current.definition = withDistance(distance);
    return JSON.parse(JSON.stringify(current));
  };
  expect(
    validateSketchRecord(record(createLiteralAuthoredValue(0.5))).success,
    "premise: the record opens with the wrapper",
  ).toBe(true);
  const recordResult = validateSketchRecord(record(0.5));
  expect(!recordResult.success && recordResult.issues[0]).toEqual({
    path: `definition.derivedRelationships.${index}.distance`,
    expected: "an authored value",
    value: 0.5,
    message: reason(0.5),
  });
  const document = (distance: unknown) => {
    const current = createAuthoredModelDocumentFromSnapshot(snapshot.snapshot);
    current.sketches[0]!.definition = withDistance(distance);
    return JSON.parse(JSON.stringify(current));
  };
  expect(
    parseAuthoredModelDocument(document(createLiteralAuthoredValue(0.5))).ok,
    "premise: the file opens with the wrapper",
  ).toBe(true);
  expect(parseAuthoredModelDocument(document(0.5))).toEqual({
    ok: false,
    diagnostic: {
      reasonCode: "invalid-authored-document",
      message: reason(0.5),
    },
  });

  // As T17p2 R-1: an unsupported-version file reports its version first.
  const oldDocument = document(0.5);
  oldDocument.schemaVersion = "authored-model-document/v1alpha0";
  const oldSketch = document(0.5);
  oldSketch.sketches[0].definition.schemaVersion = "sketch-definition/v1alpha1";
  for (const [name, file] of [
    ["document version", oldDocument],
    ["sketch version", oldSketch],
  ] as const) {
    const parsed = parseAuthoredModelDocument(file);
    expect(!parsed.ok && parsed.diagnostic.message, name).toBe(
      "Authored model document schema version is not supported.",
    );
  }
});

// T17p2 (F-2), logic lane, contract seam: the solver request validators
// (the worker transport's Typia boundary). Solver requests carry the
// resolved definition: every numeric kind, driving (a number) and reference
// (no value), validates and dispatches on `kind`; the authored wrappers are
// refused there. Red against a per-kind `Omit`-mapped resolved type (Typia
// could not dispatch it: "kind must match \"distance\"", seen in the
// browser's region derivation before the resolved view became one plain
// union).
test("T17p2 F-2: solver requests carry the resolved definition; every numeric kind validates, the authored wrappers do not", () => {
  const cases = makeReferenceDimensionCases();
  const sketch = makeReferenceDimensionSketch();
  const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  };
  const request = (definition: unknown, solvedSnapshot: unknown) => ({
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: "request_t17p2",
    documentId: "doc_t17p2",
    revisionId: "rev_t17p2",
    sketchId: FIXTURE_SKETCH_ID,
    definition,
    solvedSnapshot,
    projectedReferences: [],
    modelingTolerance: 1e-3,
  });
  const solveRequest = (definition: unknown) => ({
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: "request_t17p2_solve",
    documentId: "doc_t17p2",
    revisionId: "rev_t17p2",
    sketchId: FIXTURE_SKETCH_ID,
    plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
    tolerances,
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
    definition,
    projectedReferences: [],
  });
  for (const [name, dimensions] of [
    [
      "driving",
      cases
        .filter((entry) => entry.measured !== null)
        .map((entry) => entry.driving),
    ],
    ["reference", cases.map((entry) => entry.reference)],
  ] as const) {
    const authored = withDimensions(sketch, dimensions);
    const resolved = JSON.parse(
      JSON.stringify(literalResolvedDefinition(authored)),
    );
    const solved = solveSketchDefinitionCore({
      definition: resolved,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot;
    const derive = validateDeriveSketchRegionsRequest(
      request(resolved, JSON.parse(JSON.stringify(solved))),
    );
    expect(
      derive.success ? [] : derive.issues.slice(0, 2),
      `${name}: the region request validates`,
    ).toEqual([]);
    const solve = validateSolveSketchRequest(solveRequest(resolved));
    expect(
      solve.success ? [] : solve.issues.slice(0, 2),
      `${name}: the solve request validates`,
    ).toEqual([]);
    if (name === "driving")
      expect(
        validateSolveSketchRequest(
          solveRequest(JSON.parse(JSON.stringify(authored))),
        ).success,
        "the authored wrappers are not a solver input",
      ).toBe(false);
  }
});
