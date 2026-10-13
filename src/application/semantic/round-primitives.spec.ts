import { expect, it } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";
import type {
  SemanticCommand,
  SemanticResult,
  SemanticSketchPrimitive,
} from "@/contracts/semantic/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";

async function createSketchWorkflow() {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  const { session, initialization } = opened;
  let current: SemanticResult | undefined;
  let sequence = 0;
  async function run(input: Record<string, unknown>) {
    const { documentId, revisionId, repositoryHeads } =
      current?.completion.live.state ?? initialization.state;
    const command = {
      version: 1,
      commandId: `round-${++sequence}`,
      basis: { documentId, revisionId, repositoryHeads },
      ...input,
    };
    const checked = validateSemanticCommand(command);
    expect(checked.success, JSON.stringify(checked)).toBe(true);
    const result = await session.execute(command as SemanticCommand);
    current = result;
    expect(
      validateSemanticResult(result.correlation, result).success,
      JSON.stringify(result),
    ).toBe(true);
    return result;
  }
  async function execute(input: Record<string, unknown>) {
    const result = await run(input);
    expect(result.outcome.kind, JSON.stringify(result)).toBe("completed");
    return result;
  }
  try {
    await execute({ operation: "sketch.begin", plane: "xy" });
    return {
      run,
      execute,
      current: () => current!,
      close: () => session.close(),
    };
  } catch (error) {
    await session.close();
    throw error;
  }
}

it("authors a circle through the production contribution owner and extrudes its independently expected native bounds", async () => {
  const f = await createSketchWorkflow();
  const { execute } = f;
  try {
    const circle = await execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [10, 20], radius: 3 },
      construction: false,
      intent: "fulfill",
    });
    expect(circle.discovery!.sketch!.entities).toMatchObject([
      { kind: "circle", radius: 3 },
    ]);
    expect(circle.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [10, 20],
    ]);
    expect(circle.discovery!.sketch!.profiles).toHaveLength(1);
    const published = await execute({
      operation: "sketch.publish",
      draft: f.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const solid = await execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 4,
      intent: "fulfill",
    });
    expect(solid.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [7, 17, 0],
      max: [13, 23, 4],
    });
  } finally {
    await f.close();
  }
}, 30000);

it("authors a three-point circle with structural perimeter requirements and a real closed profile", async () => {
  const f = await createSketchWorkflow();
  try {
    const circle = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "threePointCircle",
        points: [
          [13, 20],
          [10, 23],
          [7, 20],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    const sketch = circle.discovery!.sketch!;
    expect(sketch.entities).toMatchObject([{ kind: "circle", radius: 3 }]);
    expect(sketch.points.map((p) => p.position)).toEqual([
      [10, 20],
      [13, 20],
      [10, 23],
      [7, 20],
    ]);
    expect(sketch.profiles).toHaveLength(1);
    expect(
      circle.discovery!.references.filter(
        (r) => r.target.kind === "constraint",
      ),
    ).toHaveLength(3);
  } finally {
    await f.close();
  }
}, 30000);

it("refuses degenerate round inputs without changing the private draft, even for author-invalid intent", async () => {
  const f = await createSketchWorkflow();
  try {
    const before = f.current().discovery!;
    const invalid: SemanticSketchPrimitive[] = [
      { kind: "circle", center: [0, 0], radius: 0 },
      { kind: "inscribedPolygon", center: [0, 0], radius: -1 },
      { kind: "circumscribedPolygon", center: [0, 0], radius: 0 },
      {
        kind: "threePointCircle",
        points: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      },
      {
        kind: "threePointArc",
        points: [
          [0, 0],
          [1, 1],
          [0, 0],
        ],
      },
      { kind: "centerPointArc", center: [0, 0], start: [3, 0], end: [3, 0] },
      { kind: "centerPointArc", center: [0, 0], start: [0, 0], end: [3, 0] },
      {
        kind: "tangentArc",
        start: [0, 0],
        direction: [0, 0],
        end: [3, 3],
        source: null,
      },
      {
        kind: "tangentArc",
        start: [0, 0],
        direction: [1, 0],
        end: [3, 0],
        source: null,
      },
    ];
    for (const primitive of invalid)
      for (const intent of ["fulfill", "author-invalid"]) {
        const refused = await f.run({
          operation: "sketch.author",
          draft: before.state.draft,
          primitive,
          construction: false,
          intent,
        });
        expect(refused.outcome, JSON.stringify(refused)).toEqual({
          kind: "rejected",
          reasonCode: "invalid-primitive",
        });
        expect(refused.completion.live).toEqual({
          kind: "unchanged",
          state: before.state,
        });
        expect(refused.diagnostics[0]!.message.length).toBeGreaterThan(0);
        const inspected = await f.execute({
          operation: "sketch.inspect",
          draft: before.state.draft,
        });
        expect(inspected.discovery!.sketch).toEqual(before.sketch);
        expect(inspected.discovery!.state.draft).toEqual(before.state.draft);
      }
  } finally {
    await f.close();
  }
}, 30000);

const arcs: {
  primitive: SemanticSketchPrimitive;
  center: SketchPoint;
  start: SketchPoint;
  end: SketchPoint;
  constraints: number;
}[] = [
  {
    primitive: {
      kind: "centerPointArc",
      center: [0, 0],
      start: [3, 0],
      end: [0, 3],
    },
    center: [0, 0],
    start: [3, 0],
    end: [0, 3],
    constraints: 0,
  },
  {
    primitive: {
      kind: "threePointArc",
      points: [
        [3, 0],
        [0, 3],
        [-3, 0],
      ],
    },
    center: [0, 0],
    start: [3, 0],
    end: [-3, 0],
    constraints: 1,
  },
  {
    primitive: {
      kind: "tangentArc",
      start: [0, 0],
      direction: [1, 0],
      end: [3, 3],
      source: null,
    },
    center: [0, 3],
    start: [0, 0],
    end: [3, 3],
    constraints: 0,
  },
];
for (const row of arcs)
  it(`authors ${row.primitive.kind} with solved endpoint bindings and fail-closed open profiles`, async () => {
    const f = await createSketchWorkflow();
    try {
      const authored = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: row.primitive,
        construction: false,
        intent: "fulfill",
      });
      const sketch = authored.discovery!.sketch!;
      const arc = sketch.entities[0]!;
      expect(arc.kind).toBe("arc");
      expect(arc.radius).toBeCloseTo(3, 7);
      expect(
        sketch.points.find((p) => p.pointId === arc.pointIds[2])!.position,
      ).toEqual(row.center);
      expect(
        sketch.points.find((p) => p.pointId === arc.pointIds[0])!.position,
      ).toEqual(row.start);
      expect(
        sketch.points.find((p) => p.pointId === arc.pointIds[1])!.position,
      ).toEqual(row.end);
      expect(
        authored.discovery!.references.filter(
          (r) => r.target.kind === "constraint",
        ),
      ).toHaveLength(row.constraints);
      expect(sketch.requirements).toHaveLength(2);
      expect(sketch.profiles).toEqual([]);
      const refused = await f.run({
        operation: "sketch.publish",
        draft: authored.discovery!.state.draft,
        requireProfiles: true,
      });
      expect(refused.outcome).toEqual({
        kind: "rejected",
        reasonCode: "profiles-unusable",
      });
      expect(refused.completion.live.kind).toBe("unchanged");
      const published = await f.execute({
        operation: "sketch.publish",
        draft: authored.discovery!.state.draft,
        requireProfiles: false,
      });
      await f.execute({
        operation: "sketch.open",
        sketchId: published.discovery!.sketch!.sketchId,
      });
      expect(f.current().discovery!.sketch!.entities[0]!.entityId).toBe(
        arc.entityId,
      );
      expect(f.current().discovery!.sketch!.entities[0]!.radius).toBeCloseTo(
        3,
        7,
      );
      expect(f.current().discovery!.sketch!.requirements).toHaveLength(2);
    } finally {
      await f.close();
    }
  }, 30000);

for (const row of [
  {
    kind: "inscribedPolygon",
    extent: [2.598076211353316, 3],
    constraints: 11,
    circles: 1,
  },
  {
    kind: "circumscribedPolygon",
    extent: [3, 3.4641016151377544],
    constraints: 17,
    circles: 2,
  },
] as const)
  it(`authors the production six-sided ${row.kind} with regularity requirements and native bounds`, async () => {
    const f = await createSketchWorkflow();
    try {
      const authored = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: row.kind, center: [0, 0], radius: 3 },
        construction: false,
        intent: "fulfill",
      });
      const sketch = authored.discovery!.sketch!;
      expect(
        sketch.entities.filter((e) => e.kind === "lineSegment"),
      ).toHaveLength(6);
      expect(
        sketch.entities.filter((e) => e.kind === "circle" && e.construction),
      ).toHaveLength(row.circles);
      expect(
        authored.discovery!.references.filter(
          (r) => r.target.kind === "constraint",
        ),
      ).toHaveLength(row.constraints);
      expect(sketch.profiles).toHaveLength(1);
      const published = await f.execute({
        operation: "sketch.publish",
        draft: f.current().discovery!.state.draft,
        requireProfiles: true,
      });
      const s = published.discovery!.sketch!;
      const solid = await f.execute({
        operation: "extrude.create",
        profile: {
          kind: "region",
          sketchId: s.sketchId,
          regionId: s.profiles[0]!.regionId,
        },
        depth: 4,
        intent: "fulfill",
      });
      const bounds = solid.discovery!.model!.bodies[0]!.bounds!;
      for (let axis = 0; axis < 2; axis++) {
        expect(bounds.min[axis]).toBeCloseTo(-row.extent[axis]!, 6);
        expect(bounds.max[axis]).toBeCloseTo(row.extent[axis]!, 6);
      }
      expect(bounds.min[2]).toBe(0);
      expect(bounds.max[2]).toBe(4);
    } finally {
      await f.close();
    }
  }, 30000);

it("retains tangent-source and arc endpoint requirements through publication, native save and private undo/redo", async () => {
  const f = await createSketchWorkflow();
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-round-"));
  try {
    const line = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [-3, 0], end: [0, 0] },
      construction: false,
      intent: "fulfill",
    });
    const source = line.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const authored = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "tangentArc",
        start: [0, 0],
        direction: [1, 0],
        end: [3, 3],
        source,
      },
      construction: false,
      intent: "fulfill",
    });
    const arc = authored.discovery!.sketch!.entities.find(
      (e) => e.kind === "arc",
    )!;
    expect(arc.radius).toBeCloseTo(3, 7);
    expect(
      authored.discovery!.references.filter(
        (r) => r.target.kind === "constraint",
      ),
    ).toHaveLength(2);
    await f.execute({
      operation: "history.undo",
      draft: f.current().discovery!.state.draft,
    });
    expect(f.current().discovery!.sketch!.entities).toHaveLength(1);
    await f.execute({
      operation: "history.redo",
      draft: f.current().discovery!.state.draft,
    });
    expect(
      f.current().discovery!.sketch!.entities.find((e) => e.kind === "arc")!
        .entityId,
    ).toBe(arc.entityId);
    const published = await f.execute({
      operation: "sketch.publish",
      draft: f.current().discovery!.state.draft,
      requireProfiles: false,
    });
    const path = resolve(directory, "round.cadara");
    await f.execute({ operation: "document.save", path });
    const document: AuthoredModelDocument = JSON.parse(
      await readFile(path, "utf8"),
    );
    const definition = document.sketches.find(
      (s) => s.sketchId === published.discovery!.sketch!.sketchId,
    )!.definition;
    expect(definition.constraints.map((c) => c.kind)).toEqual([
      "tangent",
      "pointOnCurve",
    ]);
    const tangent = definition.constraints.find((c) => c.kind === "tangent")!;
    expect(tangent.entityIds).toContain(arc.entityId);
    if (source.kind !== "sketchEntity") throw new Error("Missing source");
    expect(tangent.entityIds).toContain(source.entityId);
    expect(definition.dimensions).toHaveLength(2);
    await f.execute({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    expect(
      f.current().discovery!.sketch!.entities.find((e) => e.kind === "arc")!
        .entityId,
    ).toBe(arc.entityId);
    expect(f.current().discovery!.sketch!.requirements).toHaveLength(2);
    await f.execute({
      operation: "sketch.discard",
      draft: f.current().discovery!.state.draft,
    });
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

for (const row of [
  {
    primitive: { kind: "line", start: [-3, 0], end: [0, 0] },
    start: [-1, 0],
    direction: [1, 0],
    end: [2, 3],
  },
  {
    primitive: { kind: "circle", center: [0, 0], radius: 3 },
    start: [3, 0],
    direction: [0, 1],
    end: [6, 3],
  },
  {
    primitive: {
      kind: "centerPointArc",
      center: [0, 0],
      start: [3, 0],
      end: [0, 3],
    },
    start: [0, 3],
    direction: [-1, 0],
    end: [-3, 6],
  },
] as const)
  it(`uses the production ${row.primitive.kind} tangent source with structural tangency`, async () => {
    const f = await createSketchWorkflow();
    try {
      const authored = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: row.primitive,
        construction: row.primitive.kind !== "centerPointArc",
        intent: "fulfill",
      });
      const source = authored.discovery!.references.find(
        (r) => r.target.kind === "sketchEntity",
      )!.target;
      const tangent = await f.execute({
        operation: "sketch.author",
        draft: authored.discovery!.state.draft,
        primitive: {
          kind: "tangentArc",
          start: row.start,
          direction: row.direction,
          end: row.end,
          source,
        },
        construction: true,
        intent: "fulfill",
      });
      expect(tangent.discovery!.sketch!.entities.at(-1)!.radius).toBeCloseTo(
        3,
        6,
      );
      expect(
        tangent.discovery!.references.filter(
          (r) => r.target.kind === "constraint",
        ),
      ).toHaveLength(2);
      expect(tangent.discovery!.sketch!.entities.at(-1)!.construction).toBe(
        true,
      );
    } finally {
      await f.close();
    }
  }, 30000);

it("refuses foreign, missing, unsupported, centered and construction-endpoint tangent sources without authoring", async () => {
  for (const primitive of [
    { kind: "point", position: [0, 0] },
    { kind: "line", start: [-3, 0], end: [0, 0] },
    { kind: "circle", center: [0, 0], radius: 3 },
  ] as const) {
    const f = await createSketchWorkflow();
    try {
      const authored = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive,
        construction: true,
        intent: "fulfill",
      });
      const source = authored.discovery!.references.find(
        (r) => r.target.kind === "sketchEntity",
      )!.target;
      if (source.kind !== "sketchEntity") throw new Error("Missing source");
      for (const target of [
        source,
        { ...source, sketchId: "sketch_foreign" },
        { ...source, entityId: "sketch_entity_missing" },
      ]) {
        const refused = await f.run({
          operation: "sketch.author",
          draft: authored.discovery!.state.draft,
          primitive: {
            kind: "tangentArc",
            start: [0, 0],
            direction: [1, 0],
            end: [3, 3],
            source: target,
          },
          construction: false,
          intent: "fulfill",
        });
        expect(refused.outcome).toEqual({
          kind: "rejected",
          reasonCode: "tangent-source-unavailable",
        });
        expect(refused.completion.live).toEqual({
          kind: "unchanged",
          state: authored.discovery!.state,
        });
        const inspected = await f.execute({
          operation: "sketch.inspect",
          draft: authored.discovery!.state.draft,
        });
        expect(inspected.discovery!.sketch).toEqual(authored.discovery!.sketch);
      }
    } finally {
      await f.close();
    }
  }
}, 30000);
