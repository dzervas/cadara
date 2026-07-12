import type { BakedBodyFeatureParameters } from "@/contracts/modeling/schema";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import type { BakedMeshGeometryAssetData } from "@/contracts/modeling/geometry-assets";
import { validateBakedMeshGeometryAssetData } from "@/contracts/modeling/geometry-assets.runtime-schema";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import {
  allocateBodyId,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
  type OccMaterializedBakedShape,
} from "@/domain/modeling/occ/features/shared";
import type { DurableRef } from "@/contracts/shared/references";
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
    const result = validateBakedMeshGeometryAssetData(
      JSON.parse(new TextDecoder().decode(bytes)) as unknown,
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function toMeshTriangles(
  data: BakedMeshGeometryAssetData,
  indices: readonly (readonly [number, number, number])[] = data.indices,
) {
  return indices.map((triangle) => {
    const a = data.vertices[triangle[0]];
    const b = data.vertices[triangle[1]];
    const c = data.vertices[triangle[2]];
    if (!a || !b || !c)
      throw new Error("Baked mesh triangle references a missing vertex.");
    return [a, b, c] as const;
  });
}

type MeshPoint = readonly [number, number, number];

/**
 * Quantize a vertex position to a coincidence key. The Onshape ground-truth
 * payload duplicates coincident vertices bit-for-bit (adjacent faces of the same
 * body reference the same tessellation vertex), so a fine grid deduplicates true
 * coincidences while keeping genuinely distinct vertices apart.
 */
function quantizeKey(point: MeshPoint, quantum: number) {
  return `${Math.round(point[0] / quantum)},${Math.round(point[1] / quantum)},${Math.round(point[2] / quantum)}`;
}

type MeshTriangles = ReturnType<typeof toMeshTriangles>;

type DeclaredMeshComponent = {
  sourceComponentKey: string;
  triangles: MeshTriangles;
};

function getDeclaredMeshComponents(
  data: BakedMeshGeometryAssetData,
): DeclaredMeshComponent[] {
  // v1 assets written before component metadata existed are intentionally not
  // reverse-engineered: their full buffer is one component or it fails.
  const ranges = data.components ?? [
    {
      sourceComponentKey: "legacy-unpartitioned-mesh",
      indexStart: 0,
      indexCount: data.indices.length,
    },
  ];
  return ranges.map((component) => ({
    sourceComponentKey: component.sourceComponentKey,
    triangles: toMeshTriangles(
      data,
      data.indices.slice(
        component.indexStart,
        component.indexStart + component.indexCount,
      ),
    ),
  }));
}

function validateClosedComponent(
  componentTriangles: MeshTriangles,
  quantum: number,
) {
  if (componentTriangles.length === 0) {
    throw new Error("Baked mesh component contains no triangles.");
  }

  const directedEdgeCounts = new Map<string, number>();
  const undirectedEdgeCounts = new Map<string, number>();
  for (const triangle of componentTriangles) {
    if (
      triangle.some((point) =>
        point.some((coordinate) => !Number.isFinite(coordinate)),
      )
    ) {
      throw new Error("Baked mesh contains a non-finite vertex coordinate.");
    }
    const keys = triangle.map((point) => quantizeKey(point, quantum));
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) {
      throw new Error("Baked mesh contains a degenerate triangle.");
    }
    for (const [left, right] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const keyA = keys[left]!;
      const keyB = keys[right]!;
      const directedKey = `${keyA}>${keyB}`;
      const undirectedKey = keyA < keyB ? `${keyA}~${keyB}` : `${keyB}~${keyA}`;
      directedEdgeCounts.set(
        directedKey,
        (directedEdgeCounts.get(directedKey) ?? 0) + 1,
      );
      undirectedEdgeCounts.set(
        undirectedKey,
        (undirectedEdgeCounts.get(undirectedKey) ?? 0) + 1,
      );
    }
  }

  for (const [edge, count] of undirectedEdgeCounts) {
    if (count !== 2) {
      throw new Error(
        `Baked mesh is not a closed two-manifold shell: edge ${edge} has ${count} incident triangles.`,
      );
    }
    const [first, second] = edge.split("~");
    if (
      directedEdgeCounts.get(`${first}>${second}`) !== 1 ||
      directedEdgeCounts.get(`${second}>${first}`) !== 1
    ) {
      throw new Error(
        `Baked mesh has inconsistent triangle orientation at edge ${edge}.`,
      );
    }
  }
}

function validateSingleConnectedShell(
  componentTriangles: MeshTriangles,
  quantum: number,
) {
  const parent = componentTriangles.map((_, index) => index);
  const find = (value: number): number => {
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]!]!;
      value = parent[value]!;
    }
    return value;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[leftRoot] = rightRoot;
  };
  const edgeUses = new Map<string, number[]>();
  for (const [triangleIndex, triangle] of componentTriangles.entries()) {
    const keys = triangle.map((point) => quantizeKey(point, quantum));
    for (const [left, right] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const keyA = keys[left]!;
      const keyB = keys[right]!;
      const edgeKey = keyA < keyB ? `${keyA}~${keyB}` : `${keyB}~${keyA}`;
      const uses = edgeUses.get(edgeKey) ?? [];
      uses.push(triangleIndex);
      edgeUses.set(edgeKey, uses);
    }
  }
  for (const uses of edgeUses.values()) {
    if (uses.length === 2) union(uses[0]!, uses[1]!);
  }
  if (new Set(componentTriangles.map((_, index) => find(index))).size !== 1) {
    throw new Error(
      "Declared baked mesh component contains disconnected shells; source must provide one explicit component per solid.",
    );
  }
}

/**
 * Build a single faceted solid from one connected component by constructing a
 * shell with SHARED vertices and edges (deduplicated by quantized position),
 * then closing it into a solid. This deliberately avoids `BRepBuilderAPI_Sewing`,
 * whose tolerance-based edge matching is O(n^2)-ish and takes minutes on dense
 * multi-thousand-triangle studio bakes; sharing topology directly is linear and
 * yields a connected shell without the pairwise search.
 */
function buildComponentSolid(
  context: OccFeatureExecutionContext,
  componentTriangles: MeshTriangles,
  quantum: number,
): InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Shape"]> | null {
  const oc = context.oc;
  validateClosedComponent(componentTriangles, quantum);
  validateSingleConnectedShell(componentTriangles, quantum);
  const vertexByKey = new Map<
    string,
    InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Vertex"]>
  >();
  const edgeByKey = new Map<
    string,
    {
      edge: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Edge"]>;
      startKey: string;
      endKey: string;
    }
  >();

  const vertexFor = (point: MeshPoint, key: string) => {
    const existing = vertexByKey.get(key);
    if (existing) {
      return existing;
    }
    const gpPnt = toGpPnt(oc, point);
    const maker = new oc.BRepBuilderAPI_MakeVertex(gpPnt);
    try {
      const vertex = maker.Vertex();
      vertexByKey.set(key, vertex);
      return vertex;
    } finally {
      deleteOccObject(maker);
      deleteOccObject(gpPnt);
    }
  };

  const edgeFor = (
    keyA: string,
    keyB: string,
    vertexA: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Vertex"]>,
    vertexB: InstanceType<OccFeatureExecutionContext["oc"]["TopoDS_Vertex"]>,
  ) => {
    const edgeKey = keyA < keyB ? `${keyA}~${keyB}` : `${keyB}~${keyA}`;
    const existing = edgeByKey.get(edgeKey);
    if (existing) {
      // A shell shares each underlying edge, but the two incident faces must use
      // opposite edge orientations. Reversing returns a temporary wrapper over
      // the same TShape, which is retained only through wire construction.
      if (existing.startKey === keyA && existing.endKey === keyB) {
        return { edge: existing.edge, temporary: false };
      }
      const reversed = existing.edge.Reversed();
      try {
        return { edge: oc.TopoDS.Edge_1(reversed), temporary: true };
      } finally {
        deleteOccObject(reversed);
      }
    }
    const maker = new oc.BRepBuilderAPI_MakeEdge_2(vertexA, vertexB);
    try {
      if (!maker.IsDone()) {
        return null;
      }
      const edge = maker.Edge();
      edgeByKey.set(edgeKey, { edge, startKey: keyA, endKey: keyB });
      return { edge, temporary: false };
    } finally {
      deleteOccObject(maker);
    }
  };

  const builder = new oc.BRep_Builder();
  // TopoDS_Shell is explicitly bound in opencascade-recipe.yaml: production
  // browser OCC must construct the shell before its faces can become a solid.
  const shell = new oc.TopoDS_Shell();
  try {
    builder.MakeShell(shell);
    let faceCount = 0;

    for (const triangle of componentTriangles) {
      const keys = triangle.map((point) => quantizeKey(point, quantum));
      const vertices = triangle.map((point, index) =>
        vertexFor(point, keys[index]!),
      );
      const edge01 = edgeFor(keys[0]!, keys[1]!, vertices[0]!, vertices[1]!);
      const edge12 = edgeFor(keys[1]!, keys[2]!, vertices[1]!, vertices[2]!);
      const edge20 = edgeFor(keys[2]!, keys[0]!, vertices[2]!, vertices[0]!);
      if (!edge01 || !edge12 || !edge20) {
        throw new Error("Could not construct a baked mesh edge.");
      }

      const wireMaker = new oc.BRepBuilderAPI_MakeWire_4(
        edge01.edge,
        edge12.edge,
        edge20.edge,
      );
      let wire: InstanceType<
        OccFeatureExecutionContext["oc"]["TopoDS_Wire"]
      > | null = null;
      let faceMaker: InstanceType<
        OccFeatureExecutionContext["oc"]["BRepBuilderAPI_MakeFace_15"]
      > | null = null;
      let face: InstanceType<
        OccFeatureExecutionContext["oc"]["TopoDS_Face"]
      > | null = null;
      try {
        if (!wireMaker.IsDone()) {
          throw new Error("Could not construct a baked mesh triangle wire.");
        }
        wire = wireMaker.Wire();
        faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
        if (!faceMaker.IsDone()) {
          throw new Error("Could not construct a baked mesh triangle face.");
        }
        face = faceMaker.Face();
        builder.Add(shell, face);
        faceCount += 1;
      } finally {
        // `Wire()` and `Face()` are temporary wrapper handles. `Add` copies the
        // face into the shell, so neither alias is retained by this function.
        deleteOccObject(face);
        deleteOccObject(faceMaker);
        deleteOccObject(wire);
        deleteOccObject(wireMaker);
        if (edge01.temporary) deleteOccObject(edge01.edge);
        if (edge12.temporary) deleteOccObject(edge12.edge);
        if (edge20.temporary) deleteOccObject(edge20.edge);
      }
    }

    if (faceCount !== componentTriangles.length) {
      throw new Error(
        `Baked mesh materialized ${faceCount} of ${componentTriangles.length} triangles.`,
      );
    }

    const solidMaker = new oc.BRepBuilderAPI_MakeSolid_3(shell);
    try {
      if (!solidMaker.IsDone()) {
        throw new Error(
          "Could not make a solid from a closed baked mesh shell.",
        );
      }
      // `Solid()` returns the durable handle owned by the caller/cache.
      return solidMaker.Solid();
    } finally {
      deleteOccObject(solidMaker);
    }
  } finally {
    deleteOccObject(shell);
    deleteOccObject(builder);
    for (const { edge } of edgeByKey.values()) {
      deleteOccObject(edge);
    }
    for (const vertex of vertexByKey.values()) {
      deleteOccObject(vertex);
    }
  }
}

function materializeBakedMeshShape(
  context: OccFeatureExecutionContext,
  assetId: BakedBodyFeatureParameters["assetId"],
  data: BakedMeshGeometryAssetData,
): OccMaterializedBakedShape[] {
  const cached = context.bakedShapeCache.get(assetId);
  if (cached) {
    return cached;
  }

  const declaredComponents = getDeclaredMeshComponents(data);
  const quantum = Math.max(context.modelingTolerance * 1e-3, 1e-9);

  const materialized: OccMaterializedBakedShape[] = [];
  try {
    for (const component of declaredComponents) {
      const shape = buildComponentSolid(context, component.triangles, quantum);
      if (shape)
        materialized.push({ shape, meshTriangles: component.triangles });
    }

    if (materialized.length === 0) {
      throw new Error("Baked mesh produced no solids after materialization.");
    }

    context.bakedShapeCache.set(assetId, materialized);
    return materialized;
  } catch (error) {
    for (const { shape } of materialized) {
      deleteOccObject(shape);
    }
    throw error;
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

  if (
    resolved.format !== parameters.format ||
    parameters.format !== "baked-mesh"
  ) {
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
    const materialized = materializeBakedMeshShape(
      context,
      parameters.assetId,
      data,
    );
    const bodyIdFor = (index: number): BodyId =>
      materialized.length === 1
        ? allocateBodyId(ownerFeatureId)
        : (`${allocateBodyId(ownerFeatureId)}_${index + 1}` as BodyId);
    const labelFor = (index: number) =>
      materialized.length === 1
        ? parameters.label
        : `${parameters.label} ${index + 1}`;

    const newBodies = materialized.map(
      (component: OccMaterializedBakedShape, index: number) =>
        trackNewSolidBody(context.oc, {
          bodyId: bodyIdFor(index),
          label: labelFor(index),
          ownerFeatureId,
          shape: component.shape,
          meshExportFallback: component.meshTriangles,
          // Baked bodies are non-parametric: their geometry is materialized
          // wholesale from the asset on every rebuild and no downstream feature
          // references individual baked faces by naming signature. Seeding
          // topology naming is therefore unnecessary AND the sole O(n^2) cost
          // that makes dense studio bakes (tens of thousands of faces)
          // untrackable; skipping it keeps materialization linear.
          seedNaming: false,
        }),
    );
    const producedTargets: DurableRef[] = newBodies.map((body) => ({
      kind: "body",
      bodyId: body.bodyId,
    }));

    const replacedBodyIds =
      parameters.replacement.kind === "replaceBodies"
        ? new Set(parameters.replacement.bodyIds)
        : null;
    return {
      bodies: [
        ...context.bodies.filter((body) => !replacedBodyIds?.has(body.bodyId)),
        ...newBodies,
      ],
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets,
      entities: [],
      renderRecords: [],
      historyInvalidations: new Map(),
    };
  } catch (error) {
    const diagnostic = createBakedBodyDiagnostic(
      parameters,
      "materializationFailed",
      error instanceof Error
        ? error.message
        : "Baked geometry materialization failed.",
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
