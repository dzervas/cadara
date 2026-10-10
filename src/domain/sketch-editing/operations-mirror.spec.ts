/**
 * T15b: mirror relationships under sketch-editing operations. Logic lane;
 * seams: the Trim/Split/Fillet operations and mirror creation, then the core
 * solve and the validity/profile gate.
 */
import { describe, expect, test } from "vitest";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchEntityDefinition,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import { querySketchEditIntersections } from "@/contracts/sketch/edit-intersections";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  deriveSketchValidity,
  getConsumableSketchRegions,
} from "@/contracts/sketch/derived-validity";
import { MIRROR_DIAGNOSTIC_CODES } from "@/contracts/sketch/mirror-requirements";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { createSessionCommitFactories } from "@/domain/editor/sketch-session/internals";
import {
  createSketchDerivedTransformContribution,
  createSketchFilletMutation,
  createSketchSplitMutation,
  createSketchTrimMutation,
} from "@/domain/sketch-editing/operations";

const TAU = 1e-3;
const tolerances = createDocumentSolverTolerances({
  modelingTolerance: TAU,
  angularToleranceRadians: 1e-6,
});
type P = readonly [number, number];
const pid = (id: string) => `sketch_point_${id}` as SketchPointId;
const eid = (id: string) => `sketch_entity_${id}` as SketchEntityId;
const target = (id: string) => ({
  kind: "sketchEntity" as const,
  sketchId: "sketch_primary" as const,
  entityId: eid(id),
});
const point = (id: string, position: P, isConstruction = false) =>
  ({
    pointId: pid(id),
    label: id,
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_primary",
      pointId: pid(id),
    },
    position: [position[0], position[1]],
    isConstruction,
  }) as SketchPointDefinition;
const line = (id: string, a: string, b: string, isConstruction = false) =>
  ({
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction,
    startPointId: pid(a),
    endPointId: pid(b),
  }) as SketchEntityDefinition;
const circle = (id: string, c: string, radius: number) =>
  ({
    kind: "circle",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    centerPointId: pid(c),
    radius,
  }) as SketchEntityDefinition;
const out = (seed: string, output: string, sp: string[], op: string[]) => ({
  seedEntityId: eid(seed),
  outputEntityId: eid(output),
  instanceIndex: 1,
  seedPointIds: sp.map(pid),
  outputPointIds: op.map(pid),
});
function sketch(
  points: SketchPointDefinition[],
  entities: SketchEntityDefinition[],
  outputs: ReturnType<typeof out>[] = [],
  seeds: string[] = [],
): SketchDefinition {
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((entry) => entry.pointId),
    points,
    entityIds: entities.map((entry) => entry.entityId),
    entities,
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    derivedRelationships:
      outputs.length === 0
        ? []
        : [
            {
              derivationId: "derivation_mirror",
              kind: "mirror",
              label: "Mirror",
              seedEntityIds: seeds.map(eid),
              mirrorReference: { kind: "lineEntity", entityId: eid("axis") },
              outputs,
            },
          ],
  } as SketchDefinition;
}
const solve = (definition: SketchDefinition) =>
  solveSketchDefinitionCore({
    definition,
    tolerances,
    modelingTolerance: TAU,
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;
const queries = createCertifiedNeutralCurveQueryCapabilityForTest();
const factories = () =>
  createSessionCommitFactories(7, "sketch_primary" as never);

/** The verdict a broken map must reach: one stale-map error, sketch invalid, no profile. */
function expectStale(definition: SketchDefinition) {
  const snapshot = solve(definition);
  expect(
    snapshot.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.code),
  ).toEqual([MIRROR_DIAGNOSTIC_CODES.mapStale]);
  expect(snapshot.failedDerivationIds).toEqual(["derivation_mirror"]);
  const validity = deriveSketchValidity({ solvedSnapshot: snapshot });
  expect(validity.state).toBe("invalid");
  expect(
    getConsumableSketchRegions({
      derivedValidity: validity,
      regions: [{} as never],
    }),
  ).toEqual([]);
}

describe("stale maps after topology edits (T-15; review probe R1–R6)", () => {
  /** Seed line ab above the axis (y = 0), its copy mab, cutters k1/k3 and q1/q3. */
  const lineBase = () =>
    sketch(
      [
        point("a", [0, 1]),
        point("b", [4, 1]),
        point("k1a", [1, 0.5]),
        point("k1b", [1, 1.5]),
        point("k3a", [3, 0.5]),
        point("k3b", [3, 1.5]),
        point("x0", [-1, 0], true),
        point("x1", [6, 0], true),
        point("ma", [0, -1]),
        point("mb", [4, -1]),
        point("q1a", [1, -0.5]),
        point("q1b", [1, -1.5]),
        point("q3a", [3, -0.5]),
        point("q3b", [3, -1.5]),
      ],
      [
        line("ab", "a", "b"),
        line("k1", "k1a", "k1b"),
        line("k3", "k3a", "k3b"),
        line("axis", "x0", "x1", true),
        line("mab", "ma", "mb"),
        line("q1", "q1a", "q1b"),
        line("q3", "q3a", "q3b"),
      ],
      [out("ab", "mab", ["a", "b"], ["ma", "mb"])],
      ["ab"],
    );

  test("control: the untouched mirror is valid and its profile gate open", () => {
    const snapshot = solve(lineBase());
    expect(snapshot.failedDerivationIds).toBeUndefined();
    expect(deriveSketchValidity({ solvedSnapshot: snapshot }).state).toBe(
      "current",
    );
  });

  for (const [label, edited] of [
    ["R1 trim of the seed", "ab"],
    ["R2 trim of the copy", "mab"],
  ] as const)
    test(`${label} between its cutters leaves derived-mirror-map-stale`, async () => {
      const definition = lineBase();
      const solvedSnapshot = solve(definition);
      const intersections = await querySketchEditIntersections(
        {
          definition,
          solvedSnapshot,
          projectedReferences: [],
          modelingTolerance: TAU,
          operation: { kind: "trim", targetEntityId: eid(edited) },
        },
        queries,
      );
      expect(intersections.kind).toBe("verified");
      if (intersections.kind !== "verified") return;
      const mutation = createSketchTrimMutation({
        definition,
        targetEntityId: eid(edited),
        intersections,
        solvedSnapshot,
        factories: factories(),
      });
      expect(mutation.message).toBeNull();
      expectStale(mutation.definition!);
    });

  test("R3 split of the seed leaves derived-mirror-map-stale", async () => {
    const definition = lineBase();
    const solvedSnapshot = solve(definition);
    const intersections = await querySketchEditIntersections(
      {
        definition,
        solvedSnapshot,
        projectedReferences: [],
        modelingTolerance: TAU,
        operation: {
          kind: "split",
          targetEntityId: eid("ab"),
          boundaryEntityId: eid("k1"),
          pick: [1, 1],
        },
      },
      queries,
    );
    expect(intersections.kind).toBe("verified");
    if (intersections.kind !== "verified") return;
    const mutation = createSketchSplitMutation({
      definition,
      targetEntityId: eid("ab"),
      intersections,
      solvedSnapshot,
      sequence: 7,
      factories: factories(),
    });
    expect(mutation.message).toBeNull();
    expectStale(mutation.definition!);
  });

  test("R4 trim of a seed circle (it becomes an arc: a kind change) leaves derived-mirror-map-stale", async () => {
    const definition = sketch(
      [
        point("c", [2, 4]),
        point("k1a", [2, 2.5]),
        point("k1b", [2, 5.5]),
        point("x0", [-1, 0], true),
        point("x1", [6, 0], true),
        point("mc", [2, -4]),
      ],
      [
        circle("c", "c", 1),
        line("k1", "k1a", "k1b"),
        line("axis", "x0", "x1", true),
        circle("mc", "mc", 1),
      ],
      [out("c", "mc", ["c"], ["mc"])],
      ["c"],
    );
    const solvedSnapshot = solve(definition);
    const intersections = await querySketchEditIntersections(
      {
        definition,
        solvedSnapshot,
        projectedReferences: [],
        modelingTolerance: TAU,
        operation: { kind: "trim", targetEntityId: eid("c") },
      },
      queries,
    );
    expect(intersections.kind).toBe("verified");
    if (intersections.kind !== "verified") return;
    const mutation = createSketchTrimMutation({
      definition,
      targetEntityId: eid("c"),
      intersections,
      solvedSnapshot,
      factories: factories(),
    });
    expect(mutation.message).toBeNull();
    expectStale(mutation.definition!);
  });

  /** A seed corner a–b–c above the axis and its mirrored corner. */
  const corner = () =>
    sketch(
      [
        point("a", [0, 1]),
        point("b", [4, 1]),
        point("c", [4, 4]),
        point("x0", [-1, 0], true),
        point("x1", [6, 0], true),
        point("ma", [0, -1]),
        point("mb", [4, -1]),
        point("mc", [4, -4]),
      ],
      [
        line("ab", "a", "b"),
        line("bc", "b", "c"),
        line("axis", "x0", "x1", true),
        line("mab", "ma", "mb"),
        line("mbc", "mb", "mc"),
      ],
      [
        out("ab", "mab", ["a", "b"], ["ma", "mb"]),
        out("bc", "mbc", ["b", "c"], ["mb", "mc"]),
      ],
      ["ab", "bc"],
    );
  for (const [label, entities] of [
    ["R5 fillet of the seed corner", ["ab", "bc"]],
    ["R6 fillet of the copied corner", ["mab", "mbc"]],
  ] as const)
    test(`${label} leaves derived-mirror-map-stale`, () => {
      const mutation = createSketchFilletMutation({
        definition: corner(),
        entityIds: entities.map(eid),
        radius: 0.5,
        sequence: 7,
        factories: factories(),
      });
      expect(mutation.valid).toBe(true);
      expectStale(mutation.definition!);
    });
});

describe("mirror creation (T-7, A-9, T-5)", () => {
  const base = () =>
    sketch(
      [
        point("a", [1, 1], true),
        point("b", [3, 2]),
        point("x0", [-1, 0]),
        point("x1", [6, 0]),
        point("y0", [-1, -1]),
        point("y1", [-1 + 5e-4, -1]),
      ],
      [
        line("ab", "a", "b"),
        line("axis", "x0", "x1"),
        line("short", "y0", "y1"),
      ],
    );
  const create = (
    entityIds: string[],
    mirrorDatumAxis: "xAxis" | "yAxis" | null = null,
  ) =>
    createSketchDerivedTransformContribution({
      definition: base(),
      operatorKind: "mirror",
      entityIds: entityIds.map(eid),
      value: null,
      sequence: 10,
      factories: createSessionCommitFactories(10, "sketch_primary" as never),
      modelingTolerance: TAU,
      mirrorDatumAxis,
    });

  test("MC1: a sketch datum axis is accepted as the axis (every picked entity is a seed); the outputs are its exact reflection", () => {
    const result = create(["ab"], "yAxis");
    expect(result.valid).toBe(true);
    const relationship = result.contribution!.derivedRelationships![0]!;
    expect(
      relationship.kind === "mirror" && relationship.mirrorReference,
    ).toEqual({ kind: "sketchDatum", datum: "yAxis" });
    expect(relationship.seedEntityIds).toEqual([eid("ab")]);
    expect(result.contribution!.points.map((entry) => entry.position)).toEqual([
      [-1, 1],
      [-3, 2],
    ]);
  });

  test("MC2 (A-9): output points copy their seed point's construction flag at creation", () => {
    const result = create(["ab", "axis"]);
    expect(result.valid).toBe(true);
    expect(
      result.contribution!.points.map((entry) => [
        entry.position,
        entry.isConstruction,
      ]),
    ).toEqual([
      [[1, -1], true],
      [[3, -2], false],
    ]);
  });

  test("MC3: an axis shorter than τ is refused with the owner's message, never created with unmoved outputs", () => {
    const result = create(["ab", "short"]);
    expect(result.valid).toBe(false);
    expect(result.contribution).toBeNull();
    expect(result.message).toBe(
      "The mirror axis is shorter than the modeling tolerance; pick a longer line or a sketch axis.",
    );
    expect(result.message).not.toContain("sketch_derivation_");
  });
});
