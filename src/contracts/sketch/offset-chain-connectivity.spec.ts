import { describe, expect, test } from "vitest";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchToolCommitContribution } from "@/core/sketch-tools/definition";
import { splineSketchToolDefinition } from "@/core/sketch-tools/tools/spline";
import { lineSketchToolDefinition } from "@/core/sketch-tools/tools/line";
import { appendInferredSnapConstraints } from "@/domain/editor/sketch-session/tools";
import { createSessionCommitFactories } from "@/domain/editor/sketch-session/internals";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import {
  computeOffsetChain,
  offsetSeedCurveFromEntity,
} from "@/contracts/sketch/offset-geometry";
import type {
  ConstraintId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";

const pointId = (name: string) => `sketch_point_${name}` as SketchPointId;
const entityId = (name: string) => `sketch_entity_${name}` as SketchEntityId;
const constraintId = (name: string) => `constraint_${name}` as ConstraintId;

function factories(sequence: number) {
  return createSessionCommitFactories(sequence, "sketch_offset_test" as never);
}

function definition(...patches: readonly SketchToolCommitContribution[]) {
  return {
    points: patches.flatMap((patch) => patch.points),
    entities: patches.flatMap((patch) => patch.entities),
    constraints: patches.flatMap((patch) => patch.constraints ?? []),
  } as Pick<SketchDefinition, "points" | "entities" | "constraints">;
}

function legacyPieces(
  authored: Pick<SketchDefinition, "points" | "entities">,
  seedIds: readonly SketchEntityId[],
) {
  const positions = new Map(
    authored.points.map((point) => [point.pointId, point.position]),
  );
  const curves = seedIds.map((seedId) =>
    offsetSeedCurveFromEntity(
      authored.entities.find((entity) => entity.entityId === seedId)!,
      (pointId) => positions.get(pointId) ?? null,
    ),
  );
  const resolvedCurves = curves.filter(
    (curve): curve is NonNullable<typeof curve> => curve !== null,
  );
  if (resolvedCurves.length !== curves.length) {
    throw new Error("Native authoring fixture must resolve to offset seeds.");
  }
  const result = computeOffsetChain({ curves: resolvedCurves, distance: 0.01 });
  if (!result.ok)
    throw new Error("Native authoring fixture must be offsettable.");
  return result.order;
}

function endpointSnap(id: SketchPointId, point: readonly [number, number]) {
  return {
    key: `endpoint:${id}`,
    kind: "endpoint" as const,
    point,
    rawPointer: point,
    distance: 0,
    priority: 0,
    sources: [{ kind: "localPoint" as const, pointId: id }],
    preview: { label: "endpoint", glyph: "endpoint" as const },
  };
}

function committedSpline(factory = factories(1)) {
  return splineSketchToolDefinition.createCommitContribution({
    sequence: 1,
    start: [0, 0],
    end: [2, 0],
    points: [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    isConstruction: false,
    factories: factory,
  });
}

describe("declared offset-chain connectivity", () => {
  test("native line endpoint reuse joins a spline by its shared authored point ID", () => {
    const factory = factories(1);
    const spline = committedSpline(factory);
    const splineEntity = spline.entities[0]!;
    expect(splineEntity.kind).toBe("spline");
    if (splineEntity.kind !== "spline") return;
    const endpointId = splineEntity.pointOccurrences.at(-1)!.pointId;
    const line = lineSketchToolDefinition.createCommitContribution({
      sequence: 2,
      start: [2, 0],
      end: [3, 0],
      isConstruction: false,
      factories: factory,
    });
    const authoredLine = appendInferredSnapConstraints({
      previousDefinition: definition(spline) as SketchDefinition,
      patch: line,
      activeTool: "line",
      startSnap: endpointSnap(endpointId, [2, 0]),
      endSnap: null,
      sequence: 2,
      createConstraintId: constraintId,
    });
    const lineEntity = authoredLine.entities[0]!;
    expect(lineEntity.kind).toBe("lineSegment");
    if (lineEntity.kind !== "lineSegment") return;
    expect(lineEntity.startPointId).toBe(endpointId);
    expect(authoredLine.constraints ?? []).toEqual([]);

    const authoredDefinition = definition(spline, authoredLine);
    const seedIds = [lineEntity.entityId, splineEntity.entityId];
    const connectivity = extractDeclaredOffsetChainConnectivity({
      definition: authoredDefinition,
      seedIds,
    });
    expect(connectivity.ok && connectivity.pieces).toEqual(
      legacyPieces(authoredDefinition, seedIds),
    );
    expect(connectivity).toEqual({
      ok: true,
      closed: false,
      pieces: [
        { seedEntityId: splineEntity.entityId, reversed: false },
        { seedEntityId: lineEntity.entityId, reversed: false },
      ],
      joins: [{ kind: "sharedPoint", pointId: endpointId }],
    });
  });

  test("native spline snaps retain distinct IDs and expose their coincident residual", () => {
    const factory = factories(1);
    const first = committedSpline(factory);
    const firstEntity = first.entities[0]!;
    expect(firstEntity.kind).toBe("spline");
    if (firstEntity.kind !== "spline") return;
    const endpointId = firstEntity.pointOccurrences.at(-1)!.pointId;
    const second = splineSketchToolDefinition.createCommitContribution({
      sequence: 2,
      start: [2, 0],
      end: [4, 0],
      points: [
        [2, 0],
        [3, 1],
        [4, 0],
      ],
      isConstruction: false,
      factories: factory,
    });
    const authoredSecond = appendInferredSnapConstraints({
      previousDefinition: definition(first) as SketchDefinition,
      patch: second,
      activeTool: "spline",
      startSnap: endpointSnap(endpointId, [2, 0]),
      endSnap: null,
      sequence: 2,
      createConstraintId: constraintId,
    });
    const secondEntity = authoredSecond.entities[0]!;
    expect(secondEntity.kind).toBe("spline");
    if (secondEntity.kind !== "spline") return;
    const secondStartId = secondEntity.pointOccurrences[0]!.pointId;
    const coincidence = (authoredSecond.constraints ?? []).find(
      (constraint) => constraint.kind === "coincident",
    );
    expect(secondStartId).not.toBe(endpointId);
    expect(coincidence).toMatchObject({
      kind: "coincident",
      pointIds: [secondStartId, endpointId],
    });
    if (!coincidence || coincidence.kind !== "coincident") return;

    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: definition(first, authoredSecond),
        seedIds: [firstEntity.entityId, secondEntity.entityId],
      }),
    ).toEqual({
      ok: true,
      closed: false,
      pieces: [
        { seedEntityId: firstEntity.entityId, reversed: false },
        { seedEntityId: secondEntity.entityId, reversed: false },
      ],
      joins: [
        {
          kind: "coincidentConstraint",
          constraintId: coincidence.constraintId,
          pointIds: [secondStartId, endpointId],
        },
      ],
    });
  });

  test("preserves legacy seed order for a closed two-piece loop and leaves a single circle endpoint-free", () => {
    const first = entityId("closed-first");
    const second = entityId("closed-second");
    const a = pointId("closed-a");
    const b = pointId("closed-b");
    const definition = {
      points: [
        { pointId: a },
        { pointId: b },
        { pointId: pointId("center") },
      ] as never,
      entities: [
        {
          kind: "lineSegment",
          entityId: first,
          startPointId: a,
          endPointId: b,
        },
        {
          kind: "lineSegment",
          entityId: second,
          startPointId: b,
          endPointId: a,
        },
        {
          kind: "circle",
          entityId: entityId("circle"),
          centerPointId: pointId("center"),
        },
      ] as never,
      constraints: [],
    } as Pick<SketchDefinition, "points" | "entities" | "constraints">;
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [first, second],
      }),
    ).toEqual({
      ok: true,
      closed: true,
      pieces: [
        { seedEntityId: first, reversed: false },
        { seedEntityId: second, reversed: false },
      ],
      joins: [
        { kind: "sharedPoint", pointId: b },
        { kind: "sharedPoint", pointId: a },
      ],
    });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [entityId("circle")],
      }),
    ).toEqual({
      ok: true,
      closed: true,
      pieces: [{ seedEntityId: entityId("circle"), reversed: false }],
      joins: [],
    });
  });

  test("equal coordinates without a shared ID or coincidence are disconnected", () => {
    const factory = factories(1);
    const first = committedSpline(factory);
    const second = splineSketchToolDefinition.createCommitContribution({
      sequence: 2,
      start: [2, 0],
      end: [4, 0],
      points: [
        [2, 0],
        [3, 0],
        [4, 0],
      ],
      isConstruction: false,
      factories: factory,
    });
    const firstEntity = first.entities[0]!;
    const secondEntity = second.entities[0]!;
    expect(firstEntity.kind).toBe("spline");
    expect(secondEntity.kind).toBe("spline");
    if (firstEntity.kind !== "spline" || secondEntity.kind !== "spline") return;

    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: definition(first, second),
        seedIds: [firstEntity.entityId, secondEntity.entityId],
      }),
    ).toMatchObject({ ok: false, code: "disconnected" });
  });

  test("a line attached to an interior spline fit point is degree>2, not a terminal join", () => {
    const spline = {
      // Handwritten malformed-definition adversary: entities omit normal metadata only.
      points: [
        { pointId: pointId("a") },
        { pointId: pointId("interior") },
        { pointId: pointId("b") },
        { pointId: pointId("c") },
        { pointId: pointId("attached") },
      ],
      constraints: [
        {
          kind: "coincident",
          constraintId: constraintId("interior-attachment"),
          pointIds: [pointId("interior"), pointId("attached")],
        },
      ],
      entities: [
        {
          kind: "spline",
          entityId: entityId("through"),
          pointOccurrenceIds: ["a", "interior", "b"],
          pointOccurrences: [
            {
              occurrenceId: "a",
              pointId: pointId("a"),
              tangent: { kind: "automatic" },
            },
            {
              occurrenceId: "interior",
              pointId: pointId("interior"),
              tangent: { kind: "automatic" },
            },
            {
              occurrenceId: "b",
              pointId: pointId("b"),
              tangent: { kind: "automatic" },
            },
          ],
          closure: "open",
          interpolationPolicy: "centripetal-mean-arm-v1",
        },
        {
          kind: "lineSegment",
          entityId: entityId("attached"),
          startPointId: pointId("attached"),
          endPointId: pointId("c"),
        },
      ],
    } as unknown as Pick<
      SketchDefinition,
      "points" | "entities" | "constraints"
    >;
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: spline,
        seedIds: [entityId("through"), entityId("attached")],
      }),
    ).toMatchObject({ ok: false, code: "degree>2" });
  });

  test("declared edge cases fail closed", () => {
    const line = (name: string, start: string, end: string) => ({
      kind: "lineSegment",
      entityId: entityId(name),
      startPointId: pointId(start),
      endPointId: pointId(end),
    });
    const base = {
      points: ["a", "b", "c", "center"].map((name) => ({
        pointId: pointId(name),
      })),
      entities: [line("first", "a", "b"), line("second", "b", "c")],
      constraints: [],
    } as unknown as Pick<
      SketchDefinition,
      "points" | "entities" | "constraints"
    >;

    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: base,
        seedIds: [entityId("first"), entityId("first")],
      }),
    ).toMatchObject({ ok: false, code: "multipleDeclarations" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: {
          ...base,
          entities: [
            ...base.entities,
            {
              kind: "circle",
              entityId: entityId("circle"),
              centerPointId: pointId("center"),
            },
          ],
        } as never,
        seedIds: [entityId("first"), entityId("circle")],
      }),
    ).toMatchObject({ ok: false, code: "disconnected" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: {
          ...base,
          constraints: [
            {
              kind: "coincident",
              constraintId: constraintId("missing"),
              pointIds: [pointId("b"), pointId("missing")],
            },
          ],
        } as never,
        seedIds: [entityId("first"), entityId("second")],
      }),
    ).toMatchObject({ ok: false, code: "missingConstraint" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: {
          ...base,
          entities: [line("bad", "a", "a")],
        } as never,
        seedIds: [entityId("bad")],
      }),
    ).toMatchObject({ ok: false, code: "unsupportedSeed" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: {
          ...base,
          entities: [line("missing", "a", "ghost")],
        } as never,
        seedIds: [entityId("missing")],
      }),
    ).toMatchObject({ ok: false, code: "unsupportedSeed" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: {
          ...base,
          entities: [
            {
              kind: "circle",
              entityId: entityId("missing-center"),
              centerPointId: pointId("ghost"),
            },
          ],
        } as never,
        seedIds: [entityId("missing-center")],
      }),
    ).toMatchObject({ ok: false, code: "unsupportedSeed" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: {
          ...base,
          constraints: [
            {
              kind: "coincident",
              constraintId: constraintId("self-pair"),
              pointIds: [pointId("a"), pointId("a")],
            },
          ],
        } as never,
        seedIds: [entityId("first")],
      }),
    ).toMatchObject({ ok: false, code: "multipleDeclarations" });
  });

  test("uses canonical spline occurrence order and preserves middle-seed traversal", () => {
    const spline = entityId("spline");
    const middle = entityId("middle");
    const tail = entityId("tail");
    const definition = {
      points: ["a", "b", "c", "d", "fit"].map((name) => ({
        pointId: pointId(name),
      })),
      entities: [
        {
          kind: "spline",
          entityId: spline,
          pointOccurrenceIds: ["last", "fit", "first"],
          pointOccurrences: [
            {
              occurrenceId: "first",
              pointId: pointId("a"),
              tangent: { kind: "automatic" },
            },
            {
              occurrenceId: "fit",
              pointId: pointId("fit"),
              tangent: { kind: "automatic" },
            },
            {
              occurrenceId: "last",
              pointId: pointId("b"),
              tangent: { kind: "automatic" },
            },
          ],
          closure: "open",
          interpolationPolicy: "centripetal-mean-arm-v1",
        },
        {
          kind: "lineSegment",
          entityId: middle,
          startPointId: pointId("a"),
          endPointId: pointId("c"),
        },
        {
          kind: "lineSegment",
          entityId: tail,
          startPointId: pointId("c"),
          endPointId: pointId("d"),
        },
      ],
      constraints: [],
    } as never;
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [middle, spline, tail],
      }),
    ).toEqual({
      ok: true,
      closed: false,
      pieces: [
        { seedEntityId: spline, reversed: false },
        { seedEntityId: middle, reversed: false },
        { seedEntityId: tail, reversed: false },
      ],
      joins: [
        { kind: "sharedPoint", pointId: pointId("a") },
        { kind: "sharedPoint", pointId: pointId("c") },
      ],
    });
  });

  test("closed spline declarations remain loops and reject declared attachments", () => {
    // Handwritten non-native contract fixtures: no current tool authors closed splines.
    const smooth = entityId("smooth");
    const attached = entityId("attached");
    const positional = entityId("positional");
    const unrelated = entityId("unrelated");
    const definition = {
      points: ["a", "b", "c", "d", "e"].map((name) => ({
        pointId: pointId(name),
      })),
      entities: [
        {
          kind: "spline",
          entityId: smooth,
          pointOccurrenceIds: ["a", "b", "c"],
          pointOccurrences: ["a", "b", "c"].map((name) => ({
            occurrenceId: name,
            pointId: pointId(name),
            tangent: { kind: "automatic" },
          })),
          closure: "smooth",
          interpolationPolicy: "centripetal-mean-arm-v1",
        },
        {
          kind: "lineSegment",
          entityId: attached,
          startPointId: pointId("a"),
          endPointId: pointId("d"),
        },
        {
          kind: "lineSegment",
          entityId: unrelated,
          startPointId: pointId("d"),
          endPointId: pointId("e"),
        },
        {
          kind: "spline",
          entityId: positional,
          pointOccurrenceIds: ["p0", "p1", "p2"],
          pointOccurrences: [
            {
              occurrenceId: "p0",
              pointId: pointId("a"),
              tangent: { kind: "automatic" },
            },
            {
              occurrenceId: "p1",
              pointId: pointId("b"),
              tangent: { kind: "automatic" },
            },
            {
              occurrenceId: "p2",
              pointId: pointId("e"),
              tangent: { kind: "automatic" },
            },
          ],
          closure: "positional",
          interpolationPolicy: "centripetal-mean-arm-v1",
        },
      ],
      constraints: [
        {
          kind: "coincident",
          constraintId: constraintId("close"),
          pointIds: [pointId("a"), pointId("e")],
        },
      ],
    } as unknown as Pick<
      SketchDefinition,
      "points" | "entities" | "constraints"
    >;
    expect(
      extractDeclaredOffsetChainConnectivity({ definition, seedIds: [smooth] }),
    ).toMatchObject({ ok: true, closed: true, joins: [] });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [smooth, attached],
      }),
    ).toMatchObject({ ok: false, code: "degree>2" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: { ...definition, constraints: [] },
        seedIds: [smooth, unrelated],
      }),
    ).toMatchObject({ ok: false, code: "disconnected" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [positional],
      }),
    ).toMatchObject({ ok: true, closed: true, joins: [] });
  });

  test("a positional spline with one declared terminal ID is a closed self-loop", () => {
    // Handwritten non-native contract fixture: no current tool authors closed splines.
    const spline = entityId("self-loop");
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: {
          points: ["a", "b"].map((name) => ({ pointId: pointId(name) })),
          entities: [
            {
              kind: "spline",
              entityId: spline,
              pointOccurrenceIds: ["first", "middle", "last"],
              pointOccurrences: [
                {
                  occurrenceId: "first",
                  pointId: pointId("a"),
                  tangent: { kind: "automatic" },
                },
                {
                  occurrenceId: "middle",
                  pointId: pointId("b"),
                  tangent: { kind: "automatic" },
                },
                {
                  occurrenceId: "last",
                  pointId: pointId("a"),
                  tangent: { kind: "automatic" },
                },
              ],
              closure: "positional",
              interpolationPolicy: "centripetal-mean-arm-v1",
            },
          ],
          constraints: [],
        } as never,
        seedIds: [spline],
      }),
    ).toMatchObject({ ok: true, closed: true, joins: [] });
  });

  test("transitive coincidence through an unselected point is declared ambiguity", () => {
    const definition = {
      points: ["a", "b", "u", "x", "y"].map((name) => ({
        pointId: pointId(name),
      })),
      entities: [
        {
          kind: "lineSegment",
          entityId: entityId("left"),
          startPointId: pointId("x"),
          endPointId: pointId("a"),
        },
        {
          kind: "lineSegment",
          entityId: entityId("right"),
          startPointId: pointId("b"),
          endPointId: pointId("y"),
        },
      ],
      constraints: [
        {
          kind: "coincident",
          constraintId: constraintId("au"),
          pointIds: [pointId("a"), pointId("u")],
        },
        {
          kind: "coincident",
          constraintId: constraintId("ub"),
          pointIds: [pointId("u"), pointId("b")],
        },
      ],
    } as never;
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [entityId("left"), entityId("right")],
      }),
    ).toMatchObject({ ok: false, code: "multipleDeclarations" });
  });

  test("redundant or transitive coincidence declarations fail instead of collapsing IDs", () => {
    const first = entityId("first");
    const second = entityId("second");
    const third = entityId("third");
    const a = pointId("a");
    const b = pointId("b");
    const c = pointId("c");
    const result = extractDeclaredOffsetChainConnectivity({
      definition: {
        points: [
          { pointId: a },
          { pointId: b },
          { pointId: c },
          { pointId: pointId("x") },
          { pointId: pointId("y") },
          { pointId: pointId("z") },
        ] as never,
        entities: [
          {
            kind: "lineSegment",
            entityId: first,
            startPointId: pointId("x"),
            endPointId: a,
          },
          {
            kind: "lineSegment",
            entityId: second,
            startPointId: b,
            endPointId: pointId("y"),
          },
          {
            kind: "lineSegment",
            entityId: third,
            startPointId: c,
            endPointId: pointId("z"),
          },
        ] as never,
        constraints: [
          {
            kind: "coincident",
            constraintId: constraintId("ab"),
            pointIds: [a, b],
          },
          {
            kind: "coincident",
            constraintId: constraintId("bc"),
            pointIds: [b, c],
          },
        ] as never,
      },
      seedIds: [first, second, third],
    });
    expect(result).toMatchObject({ ok: false, code: "multipleDeclarations" });
  });

  test("rejects open seeds that declare their own closure", () => {
    const openSpline = entityId("open-self");
    const constrainedSpline = entityId("open-constraint-self");
    const line = entityId("line-self");
    const definition = {
      points: ["a", "b", "m", "x", "y"].map((name) => ({
        pointId: pointId(name),
      })),
      entities: [
        {
          kind: "spline",
          entityId: openSpline,
          pointOccurrenceIds: ["first", "middle", "last"],
          pointOccurrences: ["a", "m", "a"].map((name, index) => ({
            occurrenceId: ["first", "middle", "last"][index]!,
            pointId: pointId(name),
            tangent: { kind: "automatic" },
          })),
          closure: "open",
          interpolationPolicy: "centripetal-mean-arm-v1",
        },
        {
          kind: "spline",
          entityId: constrainedSpline,
          pointOccurrenceIds: ["first", "middle", "last"],
          pointOccurrences: ["a", "m", "b"].map((name, index) => ({
            occurrenceId: ["first", "middle", "last"][index]!,
            pointId: pointId(name),
            tangent: { kind: "automatic" },
          })),
          closure: "open",
          interpolationPolicy: "centripetal-mean-arm-v1",
        },
        {
          kind: "lineSegment",
          entityId: line,
          startPointId: pointId("x"),
          endPointId: pointId("y"),
        },
      ],
      constraints: [
        {
          kind: "coincident",
          constraintId: constraintId("spline-self"),
          pointIds: [pointId("a"), pointId("b")],
        },
        {
          kind: "coincident",
          constraintId: constraintId("line-self"),
          pointIds: [pointId("x"), pointId("y")],
        },
      ],
    } as never;
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [openSpline],
      }),
    ).toMatchObject({ ok: false, code: "unsupportedSeed" });
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [constrainedSpline],
      }),
    ).toMatchObject({ ok: false, code: "unsupportedSeed" });
    expect(
      extractDeclaredOffsetChainConnectivity({ definition, seedIds: [line] }),
    ).toMatchObject({ ok: false, code: "unsupportedSeed" });
  });

  test("reports arbitrary unselected coincidence components as multiple declarations", () => {
    const left = entityId("left");
    const right = entityId("right");
    const definition = {
      points: ["a", "b", "u", "v", "w", "x", "y"].map((name) => ({
        pointId: pointId(name),
      })),
      entities: [
        {
          kind: "lineSegment",
          entityId: left,
          startPointId: pointId("x"),
          endPointId: pointId("a"),
        },
        {
          kind: "lineSegment",
          entityId: right,
          startPointId: pointId("b"),
          endPointId: pointId("y"),
        },
      ],
      constraints: [
        {
          kind: "coincident",
          constraintId: constraintId("au"),
          pointIds: [pointId("a"), pointId("u")],
        },
        {
          kind: "coincident",
          constraintId: constraintId("uv"),
          pointIds: [pointId("u"), pointId("v")],
        },
        {
          kind: "coincident",
          constraintId: constraintId("uw"),
          pointIds: [pointId("u"), pointId("w")],
        },
        {
          kind: "coincident",
          constraintId: constraintId("wv"),
          pointIds: [pointId("w"), pointId("v")],
        },
        {
          kind: "coincident",
          constraintId: constraintId("vb"),
          pointIds: [pointId("v"), pointId("b")],
        },
      ],
    } as never;
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition,
        seedIds: [left, right],
      }),
    ).toMatchObject({ ok: false, code: "multipleDeclarations" });
  });

  test("native line reuse onto an interior spline fit point is degree>2", () => {
    const factory = factories(1);
    const spline = committedSpline(factory);
    const splineEntity = spline.entities[0]!;
    expect(splineEntity.kind).toBe("spline");
    if (splineEntity.kind !== "spline") return;
    const fitPointId = splineEntity.pointOccurrences[1]!.pointId;
    const line = lineSketchToolDefinition.createCommitContribution({
      sequence: 2,
      start: [1, 0],
      end: [1, 2],
      isConstruction: false,
      factories: factory,
    });
    const authoredLine = appendInferredSnapConstraints({
      previousDefinition: definition(spline) as SketchDefinition,
      patch: line,
      activeTool: "line",
      startSnap: endpointSnap(fitPointId, [1, 0]),
      endSnap: null,
      sequence: 2,
      createConstraintId: constraintId,
    });
    const lineEntity = authoredLine.entities[0]!;
    expect(lineEntity.kind).toBe("lineSegment");
    if (lineEntity.kind !== "lineSegment") return;
    expect(lineEntity.startPointId).toBe(fitPointId);
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: definition(spline, authoredLine),
        seedIds: [splineEntity.entityId, lineEntity.entityId],
      }),
    ).toMatchObject({ ok: false, code: "degree>2" });
  });

  test("a smooth closed spline with a repeated interior point has degree>2", () => {
    // Handwritten non-native contract fixture: no current tool authors closed splines.
    const spline = entityId("repeated-interior");
    expect(
      extractDeclaredOffsetChainConnectivity({
        definition: {
          points: ["a", "m", "c"].map((name) => ({
            pointId: pointId(name),
          })),
          entities: [
            {
              kind: "spline",
              entityId: spline,
              pointOccurrenceIds: ["first", "middle", "repeat", "last"],
              pointOccurrences: ["a", "m", "a", "c"].map((name, index) => ({
                occurrenceId: ["first", "middle", "repeat", "last"][index]!,
                pointId: pointId(name),
                tangent: { kind: "automatic" },
              })),
              closure: "smooth",
              interpolationPolicy: "centripetal-mean-arm-v1",
            },
          ],
          constraints: [],
        } as never,
        seedIds: [spline],
      }),
    ).toMatchObject({ ok: false, code: "degree>2" });
  });
});
