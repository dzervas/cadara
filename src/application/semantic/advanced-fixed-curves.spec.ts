import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

const curves = [
  {
    primitive: {
      kind: "ellipticalArc",
      points: [
        [10, 20],
        [15, 20],
        [10, 23],
        [15, 20],
        [10, 23],
      ],
    },
    kind: "ellipticalArc",
    positions: [
      [10, 20],
      [15, 20],
      [15, 20],
      [10, 23],
    ],
  },
  {
    primitive: {
      kind: "conic",
      points: [
        [0, 0],
        [4, 5],
        [8, 0],
      ],
    },
    kind: "conic",
    positions: [
      [0, 0],
      [4, 5],
      [8, 0],
    ],
  },
  {
    primitive: {
      kind: "bezierCurve",
      controlPoints: [
        [0, 0],
        [2, 4],
        [6, 4],
        [8, 0],
      ],
    },
    kind: "bezierCurve",
    positions: [
      [0, 0],
      [2, 4],
      [6, 4],
      [8, 0],
    ],
  },
  {
    primitive: {
      kind: "controlPointSpline",
      controlPoints: [
        [0, 0],
        [2, 4],
        [6, 4],
        [8, 0],
      ],
    },
    kind: "bezierCurve",
    positions: [
      [0, 0],
      [2, 4],
      [6, 4],
      [8, 0],
    ],
  },
  {
    primitive: {
      kind: "profileText",
      anchor: [10, 20],
      heightPoint: [13, 20],
      text: "CAD",
      horizontalAlign: "center",
      verticalAlign: "baseline",
    },
    kind: "profileText",
    positions: [[10, 20]],
  },
];

for (const row of curves)
  it(`authors ${row.primitive.kind}, edits its defining points and refuses unsupported profiles`, async () => {
    const f = await createSketchWorkflow();
    try {
      const created = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: row.primitive,
        construction: false,
        intent: "fulfill",
      });
      const sketch = created.discovery!.sketch!;
      expect(sketch.entities).toMatchObject([{ kind: row.kind }]);
      expect(sketch.points.map((p) => p.position)).toEqual(row.positions);
      if (row.kind === "ellipticalArc")
        expect(sketch.entities[0]).toMatchObject({
          minorRadius: 3,
          sweepDirection: "counterClockwise",
        });
      if (row.kind === "conic")
        expect(sketch.entities[0]).toMatchObject({ rho: 0.5 });
      if (row.kind === "bezierCurve")
        expect(sketch.entities[0]).toMatchObject({ degree: 3 });
      if (row.kind === "profileText")
        expect(sketch.entities[0]).toMatchObject({
          text: {
            content: "CAD",
            height: 3,
            rotationRadians: 0,
            horizontalAlign: "center",
            verticalAlign: "baseline",
          },
        });
      expect(sketch.profiles).toEqual([]);
      expect(
        created.diagnostics.some((d) => d.code === "region-unsupported-curve"),
      ).toBe(true);
      const entity = sketch.entities[0]!;
      const target = created.discovery!.references.find(
        (r) =>
          r.target.kind === "sketchEntity" &&
          r.target.entityId === entity.entityId,
      )!.target;
      const translated = await f.execute({
        operation: "sketch.geometry.update",
        draft: created.discovery!.state.draft,
        edit: { kind: "translate", target, delta: [1, 2] },
        intent: "fulfill",
      });
      expect(
        translated.discovery!.sketch!.points.map((p) => p.position),
      ).toEqual(row.positions.map(([x, y]) => [x! + 1, y! + 2]));
      expect(translated.discovery!.sketch!.entities[0]!.entityId).toBe(
        entity.entityId,
      );
      const refused = await f.run({
        operation: "sketch.publish",
        draft: translated.discovery!.state.draft,
        requireProfiles: true,
      });
      expect(refused.outcome).toEqual({
        kind: "rejected",
        reasonCode: "profiles-unusable",
      });
      expect(refused.completion.live.kind).toBe("unchanged");
      const published = await f.execute({
        operation: "sketch.publish",
        draft: translated.discovery!.state.draft,
        requireProfiles: false,
      });
      const reopened = await f.execute({
        operation: "sketch.open",
        sketchId: published.discovery!.sketch!.sketchId,
      });
      expect(reopened.discovery!.sketch!.entities[0]!.entityId).toBe(
        entity.entityId,
      );
      expect(reopened.discovery!.sketch!.points.map((p) => p.position)).toEqual(
        translated.discovery!.sketch!.points.map((p) => p.position),
      );
      expect(reopened.discovery!.sketch!.profiles).toEqual([]);
    } finally {
      await f.close();
    }
  }, 30000);
