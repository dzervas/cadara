import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";
import type { ChamferWidthOptions } from "@/contracts/modeling/advanced-solid";
import { prepareChamferFeatureDefinition } from "@/core/feature-authoring/features/chamfer";
import {
  createGeometryAssetRecordFromReference,
  encodeGeometryAssetData,
  type BakedMeshGeometryAssetData,
} from "@/contracts/modeling/geometry-assets";
import { hashGeometryAssetBytes } from "@/domain/modeling/geometry-asset-store";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { BAKED_BODY_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";

async function solidWorkflow() {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId!,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 10,
      intent: "fulfill",
    });
    return w;
  } catch (error) {
    await w.close();
    throw error;
  }
}
function topology(result: SemanticResult) {
  return result.discovery!.model!.bodies[0]!.topology!;
}
function cornerEdge(result: SemanticResult) {
  const edge = topology(result).find(
    (s) =>
      s.entityClass === "edge" &&
      s.boundingBox &&
      Math.abs(s.boundingBox.low[0]) < 1e-5 &&
      Math.abs(s.boundingBox.high[0]) < 1e-5 &&
      Math.abs(s.boundingBox.low[1]) < 1e-5 &&
      Math.abs(s.boundingBox.high[1]) < 1e-5 &&
      s.boundingBox.high[2] - s.boundingBox.low[2] > 9.99,
  )!.reference;
  expect(edge.kind).toBe("edge");
  expect(
    result.discovery!.references.some(
      (r) => JSON.stringify(r.target) === JSON.stringify(edge),
    ),
  ).toBe(true);
  return edge;
}
function assertFillet(result: SemanticResult, radius: number) {
  const faces = topology(result).filter((s) => s.entityClass === "face");
  expect(faces).toHaveLength(7);
  const cylinder = faces.find((s) => s.geometryType === "cylinder")!;
  expect(cylinder.definingData!.radius).toBeCloseTo(radius, 5);
  const origin = cylinder.definingData!.axisOrigin as number[];
  expect(origin[0]).toBeCloseTo(radius, 5);
  expect(origin[1]).toBeCloseTo(radius, 5);
  expect(result.completion.geometry.kind).toBe("current");
  expect(result.completion.persistence.kind).toBe("committed");
}
function assertChamfer(result: SemanticResult, offsets: readonly number[]) {
  const faces = topology(result).filter((s) => s.entityClass === "face");
  expect(faces).toHaveLength(7);
  const bevel = faces.find(
    (s) =>
      s.geometryType === "plane" &&
      s.definingData &&
      Math.abs((s.definingData.normal as number[])[0]!) > 1e-5 &&
      Math.abs((s.definingData.normal as number[])[1]!) > 1e-5,
  )!;
  expect(bevel, JSON.stringify(faces)).toBeDefined();
  const spans = [0, 1]
    .map((i) => bevel.boundingBox!.high[i]! - bevel.boundingBox!.low[i]!)
    .sort((a, b) => a - b);
  const expected = [...offsets].sort((a, b) => a - b);
  spans.forEach((n, i) => expect(n).toBeCloseTo(expected[i]!, 5));
  expect(bevel.boundingBox!.high[2] - bevel.boundingBox!.low[2]).toBeCloseTo(
    10,
    5,
  );
  expect(result.completion.geometry.kind).toBe("current");
  expect(result.completion.persistence.kind).toBe("committed");
}

test("canonical chamfer preparation preserves variants and refuses unresolved width forms", () => {
  const participants = [
    {
      role: "edge" as const,
      targets: [
        {
          kind: "edge" as const,
          bodyId: "body_part" as const,
          edgeId: "edge_side" as const,
        },
      ],
    },
  ] as const;
  for (const options of [
    { widthForm: "equalOffsets", distance: 1 },
    { widthForm: "twoOffsets", distance1: 1, distance2: 2 },
    { widthForm: "offsetAngle", distance: 1, angle: 30 },
  ] satisfies ChamferWidthOptions[]) {
    const definition = prepareChamferFeatureDefinition({
      participants,
      options,
    })!;
    expect(definition.parameters.participants).toEqual(participants);
    expect(definition.parameters.options).toEqual(
      Object.fromEntries(
        Object.entries(options).map(([key, value]) => [
          key,
          { source: "literal", value },
        ]),
      ),
    );
  }
  expect(
    prepareChamferFeatureDefinition({
      participants,
      options: {
        widthForm: { source: "expression", valueText: "variant" },
        distance: 1,
      },
    }),
  ).toBeNull();
});

test("production fillet discovers a current durable edge and updates independently inspected cylindrical geometry", async () => {
  const w = await solidWorkflow();
  try {
    const edge = cornerEdge(w.current());
    const created = await w.execute({
      operation: "fillet.create",
      parameters: {
        edgeTargets: [edge],
        radius: { source: "literal", value: 1 },
      },
      intent: "fulfill",
    });
    assertFillet(created, 1);
    const featureId = created.discovery!.model!.features.find(
      (f) => f.kind === "fillet",
    )!.featureId;
    const updated = await w.execute({
      operation: "fillet.update",
      featureId,
      parameters: {
        edgeTargets: [edge],
        radius: { source: "literal", value: 2 },
      },
      intent: "fulfill",
    });
    assertFillet(updated, 2);
    expect(
      updated.discovery!.model!.features.find((f) => f.kind === "fillet")!
        .featureId,
    ).toBe(featureId);
    // The consumed original corner is not a new selection after the operation.
    expect(
      updated.discovery!.references.some(
        (r) => JSON.stringify(r.target) === JSON.stringify(edge),
      ),
    ).toBe(false);
    const state = updated.discovery!.state;
    const stale = await w.run({
      operation: "chamfer.create",
      parameters: {
        participants: [{ role: "edge", targets: [edge] }],
        options: { distance: 0.5 },
      },
      intent: "fulfill",
    });
    expect(stale.outcome, JSON.stringify(stale)).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(stale.completion.live.kind).toBe("applied");
    expect(stale.completion.live.state!.revisionId).not.toBe(state.revisionId);
  } finally {
    await w.close();
  }
}, 180000);

test("production equal, unequal and degree-angle chamfers create and update actual bevel planes", async () => {
  const w = await solidWorkflow();
  try {
    const edge = cornerEdge(w.current());
    for (const [options, offsets, next, nextOffsets] of [
      [
        { widthForm: "equalOffsets", distance: 1 },
        [1, 1],
        { widthForm: "equalOffsets", distance: 2 },
        [2, 2],
      ],
      [
        { widthForm: "twoOffsets", distance1: 1, distance2: 2 },
        [1, 2],
        { widthForm: "twoOffsets", distance1: 2, distance2: 3 },
        [2, 3],
      ],
      [
        { widthForm: "offsetAngle", distance: 1, angle: 30 },
        [1, Math.tan(Math.PI / 6)],
        { widthForm: "offsetAngle", distance: 2, angle: 30 },
        [2, 2 * Math.tan(Math.PI / 6)],
      ],
    ] as const) {
      const participants = [{ role: "edge", targets: [edge] }];
      const created = await w.execute({
        operation: "chamfer.create",
        parameters: { participants, options },
        intent: "fulfill",
      });
      assertChamfer(created, offsets);
      const featureId = created.discovery!.model!.features.find(
        (f) => f.kind === "chamfer",
      )!.featureId;
      const updated = await w.execute({
        operation: "chamfer.update",
        featureId,
        parameters: { participants, options: next },
        intent: "fulfill",
      });
      assertChamfer(updated, nextOffsets);
      expect(
        updated.discovery!.model!.features.find((f) => f.kind === "chamfer")!
          .featureId,
      ).toBe(featureId);
      await w.execute({
        operation: "feature.delete",
        featureId,
        intent: "fulfill",
      });
      expect(
        topology(w.current()).filter((s) => s.entityClass === "face"),
      ).toHaveLength(6);
    }
  } finally {
    await w.close();
  }
}, 180000);

test("native body-only mesh inspection and edge treatment never fabricate subtopology", async () => {
  let text = "";
  const w = await createSketchWorkflow({
    nativeFileIO: {
      read: async () => text,
      write: async (_path, value) => {
        text = value;
        return {
          kind: "written",
          bytesWritten: new TextEncoder().encode(value).length,
          diagnostics: [],
        };
      },
    },
  });
  try {
    await w.execute({
      operation: "sketch.discard",
      draft: w.current().discovery!.state.draft,
    });
    await w.execute({ operation: "document.save", path: "mesh.cadara" });
    const document: AuthoredModelDocument = JSON.parse(text);
    const mesh: BakedMeshGeometryAssetData = {
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      indices: [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
      components: [
        { sourceComponentKey: "tetrahedron", indexStart: 0, indexCount: 4 },
      ],
    };
    const bytes = encodeGeometryAssetData(mesh);
    const reference = {
      assetId: "asset_mesh" as const,
      format: "baked-mesh" as const,
      hash: await hashGeometryAssetBytes(bytes),
      byteLength: bytes.byteLength,
    };
    document.assets.records = [
      {
        ...createGeometryAssetRecordFromReference(reference),
        data: mesh,
        ownerFeatureIds: ["feature_mesh"],
      },
    ];
    document.features = [
      {
        featureId: "feature_mesh",
        label: "Mesh",
        suppressed: false,
        definition: {
          kind: "bakedBody",
          featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
          parameters: {
            ...reference,
            label: "Mesh",
            provenance: { source: "fileImport" },
            replacement: { kind: "append" },
          },
        },
      },
    ];
    document.featureOrder = ["feature_mesh"];
    document.historyOrder = [{ kind: "feature", featureId: "feature_mesh" }];
    document.cursor = { kind: "feature", featureId: "feature_mesh" };
    text = JSON.stringify(document);
    const opened = await w.execute({
      operation: "document.open",
      path: "mesh.cadara",
      basis: null,
    });
    expect(opened.discovery!.model!.bodies).toHaveLength(1);
    const body = opened.discovery!.model!.bodies[0]!;
    expect(body.bounds).toBeNull();
    expect(body.topology).toBeNull();
    expect(
      opened.discovery!.references.some((r) =>
        ["face", "edge", "vertex"].includes(r.target.kind),
      ),
    ).toBe(false);
    const refused = await w.run({
      operation: "fillet.create",
      parameters: {
        edgeTargets: [
          { kind: "edge", bodyId: body.bodyId, edgeId: "edge_invented" },
        ],
        radius: { source: "literal", value: 1 },
      },
      intent: "fulfill",
    });
    expect(refused.outcome, JSON.stringify(refused)).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(refused.completion.live.kind).toBe("applied");
    expect(refused.completion.geometry.kind).toBe("failed");
    expect(
      refused.discovery!.model!.bodies.every((b) => b.topology === null),
    ).toBe(true);
  } finally {
    await w.close();
  }
}, 180000);

test("edge treatment failures cannot fulfill missing edges or infeasible geometry", async () => {
  const w = await solidWorkflow();
  try {
    const edge = cornerEdge(w.current());
    const before = w.current().discovery!.state;
    for (const radius of [0, -1, 1000]) {
      const result = await w.run({
        operation: "fillet.create",
        parameters: {
          edgeTargets: [edge],
          radius: { source: "literal", value: radius },
        },
        intent: "fulfill",
      });
      expect(result.outcome, JSON.stringify(result)).toEqual(
        radius === 1000
          ? { kind: "rejected", reasonCode: "occ-rebuild-failure" }
          : { kind: "failed", failures: ["execution"] },
      );
      expect(result.completion.live.kind).toBe("unchanged");
      expect(result.completion.live.state).toEqual(before);
    }
    for (const options of [
      { widthForm: "equalOffsets", distance: -1 },
      { widthForm: "twoOffsets", distance1: 1, distance2: 0 },
      { widthForm: "offsetAngle", distance: 1, angle: 90 },
      { widthForm: "equalOffsets", distance: 1000 },
    ]) {
      const result = await w.run({
        operation: "chamfer.create",
        parameters: {
          participants: [{ role: "edge", targets: [edge] }],
          options,
        },
        intent: "fulfill",
      });
      expect(result.outcome, JSON.stringify(result)).toEqual(
        options.distance === 1000
          ? {
              kind: "rejected",
              reasonCode: "advanced-feature-unsupported-kernel-case",
            }
          : { kind: "rejected", reasonCode: "chamfer-incomplete" },
      );
      expect(result.completion.live.kind).toBe("unchanged");
      expect(result.completion.live.state).toEqual(before);
    }
    const missing = await w.run({
      operation: "fillet.create",
      parameters: {
        edgeTargets: [{ ...edge, edgeId: "edge_missing" }],
        radius: { source: "literal", value: 1 },
      },
      intent: "fulfill",
    });
    expect(missing.outcome, JSON.stringify(missing)).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(missing.completion.live.kind).toBe("applied");
    expect(missing.completion.persistence.kind).toBe("committed");
    expect(missing.completion.geometry.kind).toBe("failed");
    const featureId = missing.discovery!.model!.features.find(
      (f) => f.kind === "fillet",
    )!.featureId;
    const restored = await w.execute({
      operation: "fillet.update",
      featureId,
      parameters: {
        edgeTargets: [edge],
        radius: { source: "literal", value: 1 },
      },
      intent: "fulfill",
    });
    assertFillet(restored, 1);
    const invalidParameters = {
      edgeTargets: [{ ...edge, edgeId: "edge_missing" }],
      radius: { source: "literal", value: 1 },
    };
    const failedUpdate = await w.run({
      operation: "fillet.update",
      featureId,
      parameters: invalidParameters,
      intent: "fulfill",
    });
    expect(failedUpdate.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(failedUpdate.completion.live.kind).toBe("applied");
    expect(failedUpdate.completion.persistence.kind).toBe("committed");
    expect(failedUpdate.completion.geometry.kind).toBe("failed");
    expect(
      failedUpdate.discovery!.model!.bodies.every((b) => b.topology === null),
    ).toBe(true);
    const deliberate = await w.run({
      operation: "fillet.update",
      featureId,
      parameters: invalidParameters,
      intent: "author-invalid",
    });
    expect(deliberate.outcome.kind).toBe("accepted-invalid");
    expect(deliberate.completion.live.kind).toBe("applied");
    expect(deliberate.completion.geometry.kind).toBe("invalid-editable");
  } finally {
    await w.close();
  }
}, 180000);
