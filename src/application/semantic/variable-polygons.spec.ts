import { expect, test } from "vitest";
import type { SemanticDiscovery } from "@/contracts/semantic/schema";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

function signedArea(sketch: NonNullable<SemanticDiscovery["sketch"]>) {
  const positions = new Map(
    sketch.points.map((point) => [point.pointId, point.position]),
  );
  return sketch.entities.reduce((area, entity) => {
    if (entity.kind !== "lineSegment") return area;
    const start = positions.get(entity.pointIds[0]!)!;
    const end = positions.get(entity.pointIds[1]!)!;
    return area + (start[0] * end[1] - end[0] * start[1]) / 2;
  }, 0);
}

for (const [width, depth] of [
  [150, 70],
  [104, 74],
] as const) {
  test(`variable-driven enclosure hexagon retains its branch and profile at width ${width}, depth ${depth}`, async () => {
    const w = await createSketchWorkflow();
    try {
      await w.execute({ operation: "sketch.discard", draft: w.draft() });
      const variables = new Map<string, string>();
      for (const [name, valueText] of Object.entries({
        width: "100",
        depth: "70",
        mountingInset: "8",
        socketDiameter: "2.6",
      })) {
        const added = await w.execute({
          operation: "variable.add",
          name,
          valueText,
          intent: "fulfill",
        });
        variables.set(
          name,
          added.discovery!.variables!.find(
            (variable) => variable.name === name,
          )!.variableId,
        );
      }
      await w.execute({ operation: "sketch.begin", plane: "xy" });
      const authored = await w.author({
        kind: "inscribedPolygon",
        center: [-42, -27],
        radius: 1.3,
      });
      const sketch = authored.discovery!.sketch!;
      const circle = sketch.entities.find(
        (entity) => entity.kind === "circle",
      )!;
      const side = sketch.entities.filter(
        (entity) => entity.kind === "lineSegment",
      )[1]!;
      const sideTarget = w.ref(side.entityId);
      if (sideTarget.kind !== "sketchEntity")
        throw new Error("Expected polygon side reference");
      const draftSketchId = sideTarget.sketchId;
      await w.execute({
        operation: "sketch.requirement.add",
        draft: w.draft(),
        tool: "constraintVertical",
        targets: [w.ref(side.entityId)],
        mode: "driving",
        value: null,
        intent: "fulfill",
      });
      for (const [tool, target, value, expression] of [
        [
          "dimensionHorizontal",
          circle.pointIds[0]!,
          42,
          "abs(-width/2+mountingInset)",
        ],
        [
          "dimensionVertical",
          circle.pointIds[0]!,
          27,
          "abs(-depth/2+mountingInset)",
        ],
        ["dimensionRadius", circle.entityId, 1.3, "socketDiameter/2"],
      ] as const) {
        const prior = new Set(
          w
            .current()
            .discovery!.sketch!.requirements.map(
              (requirement) => requirement.dimensionId,
            ),
        );
        const added = await w.execute({
          operation: "sketch.requirement.add",
          draft: w.draft(),
          tool,
          targets:
            tool === "dimensionRadius"
              ? [w.ref(target)]
              : [
                  w.ref(target),
                  {
                    kind: "sketchDatumReference",
                    sketchId: draftSketchId,
                    datumId: "origin",
                    geometryKind: "point",
                  },
                ],
          mode: "driving",
          value,
          intent: "fulfill",
        });
        const dimensionId = added.discovery!.sketch!.requirements.find(
          (requirement) =>
            requirement.dimensionId && !prior.has(requirement.dimensionId),
        )!.dimensionId;
        await w.execute({
          operation: "sketch.dimension.update",
          draft: w.draft(),
          dimensionId,
          value: expression,
          intent: "fulfill",
        });
      }
      const published = await w.execute({
        operation: "sketch.publish",
        draft: w.draft(),
        requireProfiles: true,
      });
      const initial = published.discovery!.sketch!;
      const initialArea = signedArea(initial);
      expect(initialArea).toBeCloseTo((3 * Math.sqrt(3) * 1.3 ** 2) / 2, 7);
      const solid = await w.execute({
        operation: "extrude.create",
        profile: {
          kind: "region",
          sketchId: initial.sketchId,
          regionId: initial.profiles[0]!.regionId,
        },
        depth: 1,
        intent: "fulfill",
      });
      const bodyId = solid.discovery!.model!.bodies[0]!.bodyId;
      for (const [name, valueText] of [
        ["width", String(width)],
        ["depth", String(depth)],
      ] as const) {
        const changed = await w.execute({
          operation: "variable.update",
          variableId: variables.get(name),
          name,
          valueText,
          intent: "fulfill",
        });
        expect(changed.completion.geometry.kind).toBe("current");
        expect(changed.discovery!.model!.bodies[0]!.bodyId).toBe(bodyId);
      }
      const bounds = w.current().discovery!.model!.bodies[0]!.bounds!;
      const centerX = -width / 2 + 8;
      const centerY = -depth / 2 + 8;
      expect(bounds.min[0]).toBeCloseTo(centerX - (Math.sqrt(3) * 1.3) / 2, 5);
      expect(bounds.max[0]).toBeCloseTo(centerX + (Math.sqrt(3) * 1.3) / 2, 5);
      const opened = await w.execute({
        operation: "sketch.open",
        sketchId: initial.sketchId,
      });
      const edited = opened.discovery!.sketch!;
      expect(edited.profiles.map((profile) => profile.regionId)).toEqual(
        initial.profiles.map((profile) => profile.regionId),
      );
      expect(bounds.min[1]).toBeCloseTo(centerY - 1.3, 5);
      expect(bounds.max[1]).toBeCloseTo(centerY + 1.3, 5);
    } finally {
      await w.close();
    }
  }, 30000);
}
