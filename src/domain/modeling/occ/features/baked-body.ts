import type { BakedBodyFeatureParameters } from "@/contracts/modeling/schema";
import type { FeatureId } from "@/contracts/shared/ids";
import type { BakedMeshGeometryAssetData } from "@/contracts/modeling/geometry-assets";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import {
  allocateBodyId,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import { trackNewSolidBody } from "@/domain/modeling/occ/topology";

function createBakedBodyDiagnostic(
  parameters: BakedBodyFeatureParameters,
  reason: "assetMissing" | "formatInvalid" | "materializationFailed",
  message: string,
) {
  return {
    code: `baked-body-${reason}`,
    severity: "error" as const,
    message,
    target: null,
    detail: {
      kind: "bakedBody" as const,
      reason,
      assetId: parameters.assetId,
      format: parameters.format,
      message,
    },
  };
}

function parseBakedMesh(bytes: Uint8Array): BakedMeshGeometryAssetData | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as BakedMeshGeometryAssetData;
    return parsed.kind === "bakedMeshGeometry" &&
      parsed.schemaVersion === "baked-mesh-geometry/v1alpha1"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function toMeshTriangles(data: BakedMeshGeometryAssetData) {
  return data.indices.map((triangle) => {
    const a = data.vertices[triangle[0]];
    const b = data.vertices[triangle[1]];
    const c = data.vertices[triangle[2]];
    if (!a || !b || !c) {
      throw new Error("Baked mesh triangle references a missing vertex.");
    }
    return [a, b, c] as const;
  });
}

function makeTriangleFace(
  context: OccFeatureExecutionContext,
  triangle: ReturnType<typeof toMeshTriangles>[number],
) {
  const polygon = new context.oc.BRepBuilderAPI_MakePolygon_1();
  const points = triangle.map((point) => toGpPnt(context.oc, point));
  try {
    for (const point of points) {
      polygon.Add_1(point);
    }
    polygon.Close();
    if (!polygon.IsDone()) {
      throw new Error("Could not build triangle wire for baked mesh.");
    }
    const face = new context.oc.BRepBuilderAPI_MakeFace_15(polygon.Wire(), true);
    if (!face.IsDone()) {
      deleteOccObject(face);
      throw new Error("Could not build triangle face for baked mesh.");
    }
    return face.Face();
  } finally {
    for (const point of points) {
      deleteOccObject(point);
    }
    deleteOccObject(polygon);
  }
}

function materializeBakedMeshShape(
  context: OccFeatureExecutionContext,
  assetId: BakedBodyFeatureParameters["assetId"],
  data: BakedMeshGeometryAssetData,
) {
  const cached = context.bakedShapeCache.get(assetId);
  if (cached) {
    return cached;
  }

  const meshTriangles = toMeshTriangles(data);
  const sewing = new context.oc.BRepBuilderAPI_Sewing(
    context.modelingTolerance * 10,
    true,
    true,
    true,
    false,
  );
  try {
    for (const triangle of meshTriangles) {
      sewing.Add(makeTriangleFace(context, triangle));
    }
    sewing.Perform(new context.oc.Message_ProgressRange_1());
    const shell = context.oc.TopoDS.Shell_1(sewing.SewedShape());
    const solidBuilder = new context.oc.BRepBuilderAPI_MakeSolid_3(shell);
    if (!solidBuilder.IsDone()) {
      deleteOccObject(solidBuilder);
      deleteOccObject(shell);
      throw new Error("Could not make a solid from sewn baked mesh faces.");
    }
    const shape = solidBuilder.Solid();
    const materialized = { shape, meshTriangles };
    context.bakedShapeCache.set(assetId, materialized);
    deleteOccObject(solidBuilder);
    deleteOccObject(shell);
    return materialized;
  } finally {
    deleteOccObject(sewing);
  }
}

export function executeBakedBodyFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: BakedBodyFeatureParameters,
): OccFeatureExecutionResult {
  const resolved = context.resolvedGeometryAssets.get(parameters.assetId);
  if (!resolved) {
    const diagnostic = createBakedBodyDiagnostic(
      parameters,
      "assetMissing",
      `Baked geometry asset ${parameters.assetId} is unavailable.`,
    );
    return {
      bodies: [...context.bodies],
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: [],
      entities: [],
      renderRecords: [],
      historyInvalidations: new Map(),
      diagnostics: [diagnostic],
    };
  }

  if (resolved.format !== parameters.format || parameters.format !== "baked-mesh") {
    const diagnostic = createBakedBodyDiagnostic(
      parameters,
      "formatInvalid",
      `Baked geometry asset ${parameters.assetId} has unsupported or mismatched format ${resolved.format}.`,
    );
    return {
      bodies: [...context.bodies],
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: [],
      entities: [],
      renderRecords: [],
      historyInvalidations: new Map(),
      diagnostics: [diagnostic],
    };
  }

  const data = parseBakedMesh(resolved.bytes);
  if (!data) {
    const diagnostic = createBakedBodyDiagnostic(
      parameters,
      "formatInvalid",
      `Baked geometry asset ${parameters.assetId} bytes are not valid baked mesh geometry.`,
    );
    return {
      bodies: [...context.bodies],
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: [],
      entities: [],
      renderRecords: [],
      historyInvalidations: new Map(),
      diagnostics: [diagnostic],
    };
  }

  try {
    const materialized = materializeBakedMeshShape(context, parameters.assetId, data);
    const bodyId = allocateBodyId(ownerFeatureId);
    const body = trackNewSolidBody(context.oc, {
      bodyId,
      label: parameters.label,
      ownerFeatureId,
      shape: materialized.shape,
      meshExportFallback: materialized.meshTriangles,
    });

    return {
      bodies: [...context.bodies, body],
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: [{ kind: "body", bodyId }],
      entities: [],
      renderRecords: [],
      historyInvalidations: new Map(),
    };
  } catch (error) {
    const diagnostic = createBakedBodyDiagnostic(
      parameters,
      "materializationFailed",
      error instanceof Error ? error.message : "Baked geometry materialization failed.",
    );
    return {
      bodies: [...context.bodies],
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: [],
      entities: [],
      renderRecords: [],
      historyInvalidations: new Map(),
      diagnostics: [diagnostic],
    };
  }
}
