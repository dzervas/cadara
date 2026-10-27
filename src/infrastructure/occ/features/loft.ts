import type {
  FeatureBooleanOperation,
  FeatureBooleanScope,
} from "@/contracts/modeling/schema";
import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import {
  getAuthoredLiteralValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import { getAdvancedParticipant } from "@/contracts/modeling/advanced-solid";
import type { Vec3 } from "@/core/modeling/vector-frame-math";
import {
  buildRegionProfileFace,
  getExtrusionNormalForPlanarFace,
} from "@/infrastructure/occ/sketch-profile";
import {
  add,
  cross,
  dot,
  magnitude,
  scale,
  subtract,
  toGpVec,
  toVec3FromGpPoint,
} from "@/infrastructure/occ/geometry";
import { extractPlanarFaceData } from "@/infrastructure/occ/planes";
import { withOccTemporaries } from "@/infrastructure/occ/exact-edges";
import {
  combineOccCleanupError,
  releaseDiscardedOccAuthoringStateObjects,
  type OccDisposable,
} from "@/infrastructure/occ/memory";
import type { OpenCascadeInstance } from "@/infrastructure/occ/kernel-capabilities";
import {
  requireSketchSnapshot,
  requireRegion,
  requireSolidBody,
  requireFace,
  requireEdge,
  requireVertex,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/infrastructure/occ/features/shared";
import { applyBooleanPolicy } from "@/infrastructure/occ/features/boolean-operations";
import { getSweepLinearPathData } from "@/infrastructure/occ/features/sweep";
import {
  createUnsupportedProducerTopologyStage,
  formatGeneratedProducerTopologySourceKey,
  formatGeneratedAdjacencyTopologySourceKey,
} from "@/infrastructure/occ/topology-stage";
import { getOccDurableRefKey } from "@/infrastructure/occ/topology";

function buildLoftSectionWire(
  context: OccFeatureExecutionContext,
  profile: DurableRef,
) {
  if (profile.kind === "region") {
    const sketch = requireSketchSnapshot(context, profile.sketchId);
    const region = requireRegion(sketch, profile.regionId, profile.selector);

    if (region.loops.some((loop) => loop.role === "inner")) {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC loft does not support profiles with inner loops yet.",
      );
    }

    const face = buildRegionProfileFace(
      context.oc,
      {
        plane: sketch.plane,
        sketch: sketch.sketch,
        modelingTolerance: context.modelingTolerance,
      },
      region,
    ).face;
    return context.oc.BRepTools.OuterWire(face);
  }

  if (profile.kind === "face") {
    const body = requireSolidBody(context, profile.bodyId, "loft");
    const face = requireFace(context, body, profile.faceId);
    getExtrusionNormalForPlanarFace(context.oc, face, "positive");
    return context.oc.BRepTools.OuterWire(face);
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC loft profiles must be region or planar face targets.",
  );
}

function getLoftOptionLiteral(value: unknown) {
  return getAuthoredLiteralValue(value as MaybeAuthoredValue<unknown>);
}

function getLoftPathSectionCount(
  definition: AdvancedSolidFeatureDefinition & { kind: "loft" },
) {
  const pathOptions = definition.parameters.options?.path;
  const sectionCount =
    typeof pathOptions === "object" &&
    pathOptions !== null &&
    !Array.isArray(pathOptions)
      ? getLoftOptionLiteral(
          (pathOptions as { sectionCount?: unknown }).sectionCount,
        )
      : getLoftOptionLiteral(definition.parameters.options?.sectionCount);

  if (sectionCount === undefined || sectionCount === null) {
    return 5;
  }

  if (
    typeof sectionCount === "number" &&
    Number.isInteger(sectionCount) &&
    sectionCount > 0
  ) {
    return sectionCount;
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC loft path section count must be a positive integer.",
  );
}

function getLoftGuideContinuity(
  definition: AdvancedSolidFeatureDefinition & { kind: "loft" },
) {
  return (
    getLoftOptionLiteral(definition.parameters.options?.guideContinuity) ??
    "none"
  );
}

function getLoftProfileConditions(
  definition: AdvancedSolidFeatureDefinition & { kind: "loft" },
) {
  const value = definition.parameters.options?.profileConditions;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertSupportedLoftProfileConditions(
  definition: AdvancedSolidFeatureDefinition & { kind: "loft" },
) {
  const profileConditions = getLoftProfileConditions(definition);
  const startCondition =
    getLoftOptionLiteral(profileConditions.startCondition) ?? "none";
  const endCondition =
    getLoftOptionLiteral(profileConditions.endCondition) ?? "none";
  const supportedConditions = ["none", "normal", "tangent"];

  if (
    !supportedConditions.includes(String(startCondition)) ||
    !supportedConditions.includes(String(endCondition))
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft profile condition option is invalid.",
    );
  }

  for (const [key, value] of [
    ["startMagnitude", profileConditions.startMagnitude],
    ["endMagnitude", profileConditions.endMagnitude],
  ] as const) {
    const literal = getLoftOptionLiteral(value);
    if (
      literal !== undefined &&
      literal !== null &&
      (typeof literal !== "number" || !Number.isFinite(literal) || literal <= 0)
    ) {
      throw new Error(
        `advanced-feature-unsupported-kernel-case: OCC loft ${key} must be a positive number.`,
      );
    }
  }

  // ThruSections.SetContinuity/SetCriteriumWeight control approximation,
  // not endpoint derivatives or their magnitudes. Never substitute those.
  if (
    startCondition !== "none" ||
    endCondition !== "none" ||
    [profileConditions.startMagnitude, profileConditions.endMagnitude].some(
      (value) => {
        const literal = getLoftOptionLiteral(value);
        return literal !== undefined && literal !== null && literal !== 1;
      },
    )
  ) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft endpoint conditions and magnitudes are not supported by the current loft builder.",
    );
  }
}

function assertLoftGuideTargetsResolve(
  context: OccFeatureExecutionContext,
  guideCurveTargets: readonly DurableRef[],
) {
  for (const target of guideCurveTargets) {
    if (target.kind === "edge") {
      requireEdge(context, requireSolidBody(context, target.bodyId, "loft"), target.edgeId);
      continue;
    }

    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft guide curves must be durable edge targets.",
    );
  }
}

function getSupportedLoftConnection(
  context: OccFeatureExecutionContext,
  definition: AdvancedSolidFeatureDefinition & { kind: "loft" },
  profileTargets: readonly DurableRef[],
) {
  const connections = definition.parameters.options?.matchConnections;
  if (connections === undefined) {
    return;
  }

  if (!Array.isArray(connections)) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft match connections must be a connection list.",
    );
  }

  if (connections.length === 0) {
    return;
  }

  if (connections.length !== 1 || profileTargets.length !== 2) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft match connections require one vertex connection across exactly two ordered profiles.",
    );
  }

  const [connection] = connections as readonly {
    from?: DurableRef;
    to?: DurableRef;
  }[];
  for (const endpoint of [connection?.from, connection?.to]) {
    if (endpoint?.kind === "edge") {
      requireEdge(
        context,
        requireSolidBody(context, endpoint.bodyId, "loft"),
        endpoint.edgeId,
      );
    } else if (endpoint?.kind === "vertex") {
      requireVertex(
        context,
        requireSolidBody(context, endpoint.bodyId, "loft"),
        endpoint.vertexId,
      );
    } else {
      throw new Error(
        "advanced-feature-unsupported-kernel-case: OCC loft match connections require durable edge or vertex endpoints.",
      );
    }
  }

  if (connection?.from?.kind !== "vertex" || connection.to?.kind !== "vertex") {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft match connections are not supported for edge pairing; use one vertex pair.",
    );
  }
  return { from: connection.from, to: connection.to };
}

type Own = <T extends OccDisposable>(value: T) => T;
type VertexRef = Extract<DurableRef, { kind: "vertex" }>;

function unsupportedMatching(reason: string): never {
  throw new Error(
    `advanced-feature-unsupported-kernel-case: OCC loft vertex matching ${reason}.`,
  );
}

function buildMatchedLoftSections(
  context: OccFeatureExecutionContext,
  profiles: readonly DurableRef[],
  connection: { from: VertexRef; to: VertexRef },
  own: Own,
) {
  const { oc, modelingTolerance: tolerance } = context;
  const sections = profiles.map((profile, index) => {
    if (profile.kind !== "face") {
      unsupportedMatching("requires durable planar face boundaries");
    }
    const body = requireSolidBody(context, profile.bodyId, "loft");
    const face = requireFace(context, body, profile.faceId);
    const { frame, plane } = extractPlanarFaceData(oc, face);
    own(plane);
    const wires = own(new oc.TopExp_Explorer_2(
      face,
      oc.TopAbs_ShapeEnum.TopAbs_WIRE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    ));
    let wireCount = 0;
    while (wires.More()) {
      wireCount++;
      wires.Next();
    }
    if (wireCount !== 1) {
      unsupportedMatching("requires one closed boundary without holes");
    }
    const wire = own(oc.BRepTools.OuterWire(face));
    if (!wire.Closed_1()) unsupportedMatching("requires closed boundaries");
    const endpoint = index === 0 ? connection.from : connection.to;
    if (endpoint.bodyId !== body.bodyId) {
      unsupportedMatching("endpoints must belong to their ordered profile faces");
    }
    const selected = requireVertex(context, body, endpoint.vertexId);
    return { profile, body, wire, frame, selected };
  });
  const normal = sections[0]!.frame.normal;
  if (magnitude(cross(normal, sections[1]!.frame.normal)) > 1e-12) {
    unsupportedMatching(
      "requires parallel section planes; other frames are not qualified",
    );
  }
  const separation = dot(
    subtract(sections[1]!.frame.origin, sections[0]!.frame.origin), normal,
  );
  if (Math.abs(separation) <= tolerance) {
    unsupportedMatching("requires separated section planes");
  }

  const readBoundary = (section: (typeof sections)[number]) => {
    const explorer = own(new oc.BRepTools_WireExplorer_2(section.wire));
    const edges: InstanceType<OpenCascadeInstance["TopoDS_Edge"]>[] = [];
    const vertices: InstanceType<OpenCascadeInstance["TopoDS_Vertex"]>[] = [];
    const points: Vec3[] = [];
    while (explorer.More()) {
      const edge = own(explorer.Current());
      const curve = own(new oc.BRepAdaptor_Curve_2(edge));
      if (curve.GetType() !== oc.GeomAbs_CurveType.GeomAbs_Line) {
        unsupportedMatching("currently requires straight-edged boundaries");
      }
      edges.push(edge);
      const vertex = own(explorer.CurrentVertex());
      vertices.push(vertex);
      points.push(toVec3FromGpPoint(own(oc.BRep_Tool.Pnt(vertex))));
      explorer.Next();
    }
    if (points.length < 3) {
      unsupportedMatching("has ambiguous or degenerate winding");
    }
    // Inspect the actual traversal, not the face's orientation flag or the
    // support normal's sign: opposite box faces and reversed plane normals
    // can give different traversal directions in the SAME section frame.
    const origin = points[0]!;
    const area = points.reduce((sum, point, i) => sum + dot(
      cross(
        subtract(point, origin),
        subtract(points[(i + 1) % points.length]!, origin),
      ), normal,
    ), 0);
    if (Math.abs(area) <= tolerance * tolerance) {
      unsupportedMatching("has ambiguous or degenerate winding");
    }
    return { edges, vertices, points, area };
  };
  let boundaries = sections.map(readBoundary);
  if (boundaries[0]!.edges.length !== boundaries[1]!.edges.length) {
    unsupportedMatching("requires equal edge counts");
  }
  // Normalize BEFORE finding/rotating starts. Reversal changes the outgoing
  // edge at the selected vertex; reversing a rotated list loses that identity.
  if (boundaries[0]!.area * boundaries[1]!.area < 0) {
    sections[1]!.wire.Reverse();
    boundaries = [boundaries[0]!, readBoundary(sections[1]!)];
  }
  const ordered = boundaries.map((boundary, sectionIndex) => {
    const start = boundary.vertices.findIndex(vertex =>
      vertex.IsSame(sections[sectionIndex]!.selected),
    );
    if (start < 0) {
      unsupportedMatching("endpoint is not an exact vertex of its profile boundary");
    }
    const rotate = <T,>(values: readonly T[]) =>
      values.map((_, i) => values[(i + start) % values.length]!);
    const edges = rotate(boundary.edges);
    const builder = own(new oc.BRepBuilderAPI_MakeWire_1());
    for (const edge of edges) builder.Add_1(edge);
    const wire = own(builder.Wire());
    const check = own(new oc.BRepTools_WireExplorer_2(wire));
    if (!own(check.CurrentVertex()).IsSame(sections[sectionIndex]!.selected)) {
      unsupportedMatching("could not preserve the selected vertex identity");
    }
    return {
      wire, edges,
      vertices: rotate(boundary.vertices), points: rotate(boundary.points),
    };
  });

  // BRepCheck accepts folded ThruSections surfaces. Certify this deliberately
  // bounded polygonal case instead: every intermediate polygon must remain
  // strictly convex. Each supporting-half-plane determinant is quadratic in
  // section t, so its exact minimum is at an endpoint or its stationary point.
  // Together with parallel separated planes this excludes self-intersection,
  // collapsed edges and zero side-surface D1U x D1V throughout the loft.
  const count = ordered[0]!.points.length;
  const sign = Math.sign(boundaries[0]!.area);
  for (let i = 0; i < count; i++) {
    const edge0 = subtract(
      ordered[0]!.points[(i + 1) % count]!, ordered[0]!.points[i]!,
    );
    const edge1 = subtract(
      ordered[1]!.points[(i + 1) % count]!, ordered[1]!.points[i]!,
    );
    const de = subtract(edge1, edge0);
    for (let j = 0; j < count; j++) {
      if (j === i || j === (i + 1) % count) continue;
      const r0 = subtract(ordered[0]!.points[j]!, ordered[0]!.points[i]!);
      const dr = subtract(
        subtract(ordered[1]!.points[j]!, ordered[1]!.points[i]!), r0,
      );
      const a = sign * dot(cross(de, dr), normal);
      const b = sign * dot(add(cross(de, r0), cross(edge0, dr)), normal);
      const c = sign * dot(cross(edge0, r0), normal);
      const values = [c, a + b + c];
      const stationary = a > 0 ? -b / (2 * a) : -1;
      if (stationary > 0 && stationary < 1) values.push(c - b * b / (4 * a));
      const clearance = tolerance * Math.max(magnitude(edge0), magnitude(edge1), tolerance);
      if (Math.min(...values) <= clearance) {
        unsupportedMatching(
          "has degenerate, non-convex or self-intersecting correspondence",
        );
      }
    }
  }
  return { sections, ordered };
}

function collectMatchedLoftSourceShapes(
  oc: OpenCascadeInstance,
  ownerFeatureId: FeatureId,
  builder: InstanceType<OpenCascadeInstance["BRepOffsetAPI_ThruSections"]>,
  matched: ReturnType<typeof buildMatchedLoftSections>,
  own: Own,
) {
  type Shape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  const sourceShapes = new Map<string, Shape[]>();
  const edgesOf = (shape: Shape) => {
    const explorer = own(new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    ));
    const edges: Shape[] = [];
    while (explorer.More()) {
      edges.push(own(explorer.Current()));
      explorer.Next();
    }
    return edges;
  };
  for (const [sectionIndex, section] of matched.sections.entries()) {
    const key = (
      sourceKind: "face" | "edge" | "vertex",
      sourcePublicId: Parameters<typeof formatGeneratedProducerTopologySourceKey>[0]["sourcePublicId"],
      role: string,
    ) => formatGeneratedProducerTopologySourceKey({
      featureId: ownerFeatureId, bodyId: section.body.bodyId,
      sourceKind, sourcePublicId, role,
    });
    sourceShapes.set(key("face", section.profile.faceId, "loft-cap"), [
      own(sectionIndex === 0 ? builder.FirstShape() : builder.LastShape()),
    ]);
    const sideKeys: string[] = [];
    for (const edge of matched.ordered[sectionIndex]!.edges) {
      const id = [...section.body.edgesById].find(([, candidate]) =>
        candidate.IsSame(edge),
      )?.[0];
      if (!id) unsupportedMatching("could not identify an exact input boundary edge");
      sourceShapes.set(key("edge", id, "loft-boundary"), [edge]);
      if (sectionIndex === 0) {
        const sideKey = key("edge", id, "loft-side");
        sourceShapes.set(sideKey, [own(builder.GeneratedFace(edge))]);
        sideKeys.push(sideKey);
      }
    }
    for (const [index, vertex] of matched.ordered[sectionIndex]!.vertices.entries()) {
      const id = [...section.body.verticesById].find(([, candidate]) =>
        candidate.IsSame(vertex),
      )?.[0];
      if (!id) unsupportedMatching("could not identify an exact input boundary vertex");
      sourceShapes.set(key("vertex", id, "loft-boundary"), [vertex]);
      if (sectionIndex === 0) {
        // The shipped ThruSections.Generated(vertex) can repeat a different
        // connector. Use exact incidence of the two GeneratedFace(edge)
        // witnesses instead; no coordinate or enumeration-based identity.
        const adjacentKeys = [
          sideKeys[(index + sideKeys.length - 1) % sideKeys.length]!, sideKeys[index]!,
        ];
        const other = edgesOf(sourceShapes.get(adjacentKeys[1]!)![0]!);
        const shared = edgesOf(sourceShapes.get(adjacentKeys[0]!)![0]!).filter(edge =>
          other.some(candidate => candidate.IsSame(edge)),
        );
        sourceShapes.set(formatGeneratedAdjacencyTopologySourceKey({
          featureId: ownerFeatureId, bodyId: section.body.bodyId,
          adjacentSourceKeys: adjacentKeys, role: "loft-connector",
        }), shared);
      }
    }
  }
  return sourceShapes;
}

function transformLoftSectionWire(input: {
  context: OccFeatureExecutionContext;
  wire: InstanceType<OpenCascadeInstance["TopoDS_Wire"]>;
  translation: Vec3;
}) {
  const transform = new input.context.oc.gp_Trsf_1();
  transform.SetTranslation_1(toGpVec(input.context.oc, input.translation));
  const builder = new input.context.oc.BRepBuilderAPI_Transform_2(
    input.wire,
    transform,
    true,
  );
  builder.Build(new input.context.oc.Message_ProgressRange_1());

  if (!builder.IsDone()) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft path section transform failed.",
    );
  }

  return input.context.oc.TopoDS.Wire_1(builder.Shape());
}

function addPathDrivenLoftSections(input: {
  context: OccFeatureExecutionContext;
  loftBuilder: InstanceType<OpenCascadeInstance["BRepOffsetAPI_ThruSections"]>;
  startWire: InstanceType<OpenCascadeInstance["TopoDS_Wire"]>;
  pathTarget: DurableRef;
  sectionCount: number;
}) {
  const path = getSweepLinearPathData(input.context, input.pathTarget);

  for (let index = 1; index <= input.sectionCount; index += 1) {
    input.loftBuilder.AddWire(
      transformLoftSectionWire({
        context: input.context,
        wire: input.startWire,
        translation: scale(path.delta, index / (input.sectionCount + 1)),
      }),
    );
  }
}

function buildLoftFeatureShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "loft" },
  own: Own,
) {
  const profileTargets =
    getAdvancedParticipant(definition, "profile")?.targets ?? [];
  const pathTargets = getAdvancedParticipant(definition, "path")?.targets ?? [];
  const guideCurveTargets =
    getAdvancedParticipant(definition, "guideCurve")?.targets ?? [];

  if (profileTargets.length < 2) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft requires at least two ordered profile targets.",
    );
  }

  if (pathTargets.length > 1) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft supports at most one path target.",
    );
  }

  if (pathTargets.length > 0 && guideCurveTargets.length > 0) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft does not support combining path and guide curves yet.",
    );
  }

  const guideContinuity = getLoftGuideContinuity(definition);
  if (guideCurveTargets.length > 0) {
    assertLoftGuideTargetsResolve(context, guideCurveTargets);
    if (guideContinuity !== "none" && guideContinuity !== "normalToGuide") {
      throw new Error(
        `advanced-feature-unsupported-kernel-case: OCC loft does not support ${String(guideContinuity)} guide continuity yet.`,
      );
    }
    // MakePipeShell's auxiliary spine is a sweep framing input, not a
    // general interpolation constraint through these ordered loft sections.
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft guide curves are not supported by the current loft builder.",
    );
  } else if (guideContinuity !== "none") {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC loft guide continuity requires guide curves.",
    );
  }

  assertSupportedLoftProfileConditions(definition);
  const connection = getSupportedLoftConnection(context, definition, profileTargets);
  if (connection && pathTargets.length > 0) {
    unsupportedMatching("cannot be combined with a path");
  }

  if (pathTargets.length > 0 && profileTargets.length !== 2) {
    throw new Error(
      "advanced-feature-unsupported-kernel-case: OCC path loft currently supports exactly two ordered profile targets.",
    );
  }

  const matched = connection
    ? buildMatchedLoftSections(context, profileTargets, connection, own)
    : undefined;
  // Two certified polygonal sections use bilinear ruled sides, not a fitted
  // surface that could invalidate the all-section convexity proof above.
  const loftBuilder = own(new context.oc.BRepOffsetAPI_ThruSections(
    true,
    !!matched,
    context.modelingTolerance,
  ));
  loftBuilder.CheckCompatibility(!matched);

  if (matched) {
    for (const section of matched.ordered) loftBuilder.AddWire(section.wire);
  } else if (pathTargets.length > 0) {
    const startWire = buildLoftSectionWire(context, profileTargets[0]!);
    loftBuilder.AddWire(startWire);
    addPathDrivenLoftSections({
      context,
      loftBuilder,
      startWire,
      pathTarget: pathTargets[0]!,
      sectionCount: getLoftPathSectionCount(definition),
    });
    loftBuilder.AddWire(buildLoftSectionWire(context, profileTargets[1]!));
  } else {
    for (const profile of profileTargets) {
      loftBuilder.AddWire(buildLoftSectionWire(context, profile));
    }
  }

  loftBuilder.Build(own(new context.oc.Message_ProgressRange_1()));

  if (!loftBuilder.IsDone()) {
    throw new Error("OCC loft build failed.");
  }

  const shape = own(loftBuilder.Shape());
  return {
    shape,
    sourceShapes: matched
      ? collectMatchedLoftSourceShapes(context.oc, ownerFeatureId, loftBuilder, matched, own)
      : undefined,
  };
}

function getLoftBooleanPolicy(
  definition: AdvancedSolidFeatureDefinition & { kind: "loft" },
): {
  operation: FeatureBooleanOperation;
  booleanScope: FeatureBooleanScope;
} {
  const intent = definition.parameters.operationIntent ?? "create";

  if (intent === "create") {
    return {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    };
  }

  throw new Error(
    "advanced-feature-unsupported-kernel-case: OCC loft does not support boolean composition yet.",
  );
}

export function executeLoftFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "loft" },
): OccFeatureExecutionResult {
  return withOccTemporaries(own => {
    const policy = getLoftBooleanPolicy(definition);
    const { shape, sourceShapes } = buildLoftFeatureShape(
      context, ownerFeatureId, definition, own,
    );
    const result = applyBooleanPolicy(
      context,
      ownerFeatureId,
      policy.operation,
      policy.booleanScope,
      shape,
      { sourceShapes },
    );
    const topologyStage = createUnsupportedProducerTopologyStage({
      featureId: ownerFeatureId,
      bodies: result.bodies,
      producedTargets: result.producedTargets,
    });
    try {
      if (sourceShapes) {
        for (const output of topologyStage.outputs.values()) {
          const claims = new Map([...result.featureSourceTargets ?? []].filter(([, targets]) => {
            const target = targets[0];
            return targets.length === 1 && target &&
              (target.kind === "face" || target.kind === "edge" || target.kind === "vertex") &&
              target.bodyId === output.body.bodyId;
          }));
          const body = output.body;
          const claimedKeys = new Set([...claims.values()].flat().map(getOccDurableRefKey));
          const count = body.facesById.size + body.edgesById.size + body.verticesById.size;
          if (claims.size !== sourceShapes.size || claimedKeys.size !== count) {
            unsupportedMatching("could not qualify complete exact builder topology history");
          }
          output.sourceTargets = claims;
        }
      }
    } catch (error) {
      try {
        releaseDiscardedOccAuthoringStateObjects({ bodies: result.bodies }, [context]);
      } catch (cleanupError) {
        throw combineOccCleanupError(error, cleanupError);
      }
      throw error;
    }

    return {
      bodies: result.bodies,
      constructions: [...context.constructions],
      constructionPlanes: new Map(context.constructionPlanes),
      producedTargets: result.producedTargets,
      entities: [],
      renderRecords: [],
      historyInvalidations: result.historyInvalidations,
      topologyStage,
    };
  });
}
