import type {
  AdvancedSolidFeatureAuthoringDescriptor,
  AdvancedSolidFeatureDefinition,
  HoleDirection,
  HoleStyle,
  HoleTermination,
} from "@/contracts/modeling/advanced-solid";
import {
  getAdvancedParticipant,
  HOLE_OPTION_DESCRIPTORS,
  validateAdvancedSolidFeatureDefinition,
} from "@/contracts/modeling/advanced-solid";
import {
  getAuthoredLiteralValue,
  isExpressionAuthoredValue,
  type MaybeAuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { FeatureBooleanScope } from "@/contracts/modeling/schema";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import {
  add,
  dot,
  mapSketchPointToWorld,
  negate,
  normalize,
  scale,
  toGpDir,
  toGpPnt,
  type Vec3,
} from "@/domain/modeling/occ/geometry";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import {
  requireSolidBody,
  requireSketchSnapshot,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import { getShapeVertexPoints } from "@/domain/modeling/occ/features/extrude";
import {
  applyBooleanPolicy,
  runBoolean,
} from "@/domain/modeling/occ/features/boolean-operations";
import { createUnsupportedProducerTopologyStage } from "@/domain/modeling/occ/topology-stage";

const HOLE_DESCRIPTOR = {
  featureKind: "hole",
  participants: [
    {
      role: "location",
      label: "Hole locations",
      required: true,
      cardinality: { min: 1, max: null },
      acceptedKinds: ["sketchPoint"],
    },
    {
      role: "body",
      label: "Body targets",
      required: true,
      cardinality: { min: 1, max: null },
      acceptedKinds: ["body"],
    },
  ],
  options: HOLE_OPTION_DESCRIPTORS,
} as const satisfies AdvancedSolidFeatureAuthoringDescriptor;

interface ResolvedHoleOptions {
  style: HoleStyle;
  direction: HoleDirection;
  mainDiameter: number;
  termination: HoleTermination;
  depth: number | null;
  counterboreDiameter: number | null;
  counterboreDepth: number | null;
  countersinkDiameter: number | null;
  countersinkAngleDegrees: number | null;
}

interface HoleLocation {
  origin: Vec3;
  axisDirection: Vec3;
  radialDirection: Vec3;
}

function unsupported(message: string): never {
  throw new Error(`advanced-feature-unsupported-kernel-case: ${message}`);
}

function requireLiteralOption<T>(
  value: MaybeAuthoredValue<T> | undefined,
  label: string,
): T {
  if (value === undefined || isExpressionAuthoredValue(value)) {
    unsupported(`OCC hole requires a literal ${label} option.`);
  }

  const literal = getAuthoredLiteralValue(value);
  if (literal === null) {
    unsupported(`OCC hole requires a resolved literal ${label} option.`);
  }

  return literal;
}

function optionalLiteralOption<T>(
  value: MaybeAuthoredValue<T> | undefined,
  label: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireLiteralOption(value, label);
}

function requirePositiveNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    unsupported(`OCC hole ${label} must be a positive literal number.`);
  }
  return value;
}

function resolveHoleOptions(
  definition: AdvancedSolidFeatureDefinition & { kind: "hole" },
): ResolvedHoleOptions {
  const options = definition.parameters.options ?? {};
  const style = optionalLiteralOption(
    options.style as MaybeAuthoredValue<HoleStyle> | undefined,
    "style",
  ) ?? "simple";
  if (style !== "simple" && style !== "counterbore" && style !== "countersink") {
    unsupported("OCC hole style must be simple, counterbore, or countersink.");
  }

  const direction = optionalLiteralOption(
    options.direction as MaybeAuthoredValue<HoleDirection> | undefined,
    "direction",
  ) ?? "forward";
  if (direction !== "forward" && direction !== "reverse") {
    unsupported("OCC hole direction must be forward or reverse.");
  }

  const termination = requireLiteralOption(
    options.termination as MaybeAuthoredValue<HoleTermination> | undefined,
    "termination",
  );
  if (termination !== "blind" && termination !== "throughAll") {
    unsupported("OCC hole termination must be blind or throughAll.");
  }

  const mainDiameter = requirePositiveNumber(
    requireLiteralOption(
      options.mainDiameter as MaybeAuthoredValue<number> | undefined,
      "mainDiameter",
    ),
    "mainDiameter",
  );
  const depth =
    termination === "blind"
      ? requirePositiveNumber(
          requireLiteralOption(
            options.depth as MaybeAuthoredValue<number> | undefined,
            "depth",
          ),
          "depth",
        )
      : null;

  const counterboreDiameter =
    style === "counterbore"
      ? requirePositiveNumber(
          requireLiteralOption(
            options.counterboreDiameter as MaybeAuthoredValue<number> | undefined,
            "counterboreDiameter",
          ),
          "counterboreDiameter",
        )
      : null;
  const counterboreDepth =
    style === "counterbore"
      ? requirePositiveNumber(
          requireLiteralOption(
            options.counterboreDepth as MaybeAuthoredValue<number> | undefined,
            "counterboreDepth",
          ),
          "counterboreDepth",
        )
      : null;
  const countersinkDiameter =
    style === "countersink"
      ? requirePositiveNumber(
          requireLiteralOption(
            options.countersinkDiameter as MaybeAuthoredValue<number> | undefined,
            "countersinkDiameter",
          ),
          "countersinkDiameter",
        )
      : null;
  const countersinkAngleDegrees =
    style === "countersink"
      ? requirePositiveNumber(
          requireLiteralOption(
            options.countersinkAngleDegrees as MaybeAuthoredValue<number> | undefined,
            "countersinkAngleDegrees",
          ),
          "countersinkAngleDegrees",
        )
      : null;

  if (counterboreDiameter !== null && counterboreDiameter <= mainDiameter) {
    unsupported("OCC hole counterboreDiameter must be greater than mainDiameter.");
  }
  if (countersinkDiameter !== null && countersinkDiameter <= mainDiameter) {
    unsupported("OCC hole countersinkDiameter must be greater than mainDiameter.");
  }
  if (
    countersinkAngleDegrees !== null &&
    (countersinkAngleDegrees <= 0 || countersinkAngleDegrees >= 180)
  ) {
    unsupported("OCC hole countersinkAngleDegrees must be greater than 0 and less than 180.");
  }
  if (depth !== null && counterboreDepth !== null && counterboreDepth >= depth) {
    unsupported("OCC hole counterboreDepth must be less than blind depth.");
  }
  if (depth !== null && countersinkDiameter !== null && countersinkAngleDegrees !== null) {
    const sinkDepth = computeCountersinkDepth(
      mainDiameter / 2,
      countersinkDiameter / 2,
      countersinkAngleDegrees,
    );
    if (sinkDepth >= depth) {
      unsupported("OCC hole countersink entry depth must be less than blind depth.");
    }
  }

  return {
    style,
    direction,
    mainDiameter,
    termination,
    depth,
    counterboreDiameter,
    counterboreDepth,
    countersinkDiameter,
    countersinkAngleDegrees,
  };
}

function requireParticipants(
  definition: AdvancedSolidFeatureDefinition & { kind: "hole" },
) {
  const locationTargets = getAdvancedParticipant(definition, "location")?.targets ?? [];
  const bodyTargets = getAdvancedParticipant(definition, "body")?.targets ?? [];

  if (locationTargets.length === 0) {
    unsupported("OCC hole requires at least one location sketchPoint participant.");
  }
  if (bodyTargets.length === 0) {
    unsupported("OCC hole requires at least one explicit body participant.");
  }

  for (const target of locationTargets) {
    if (target.kind !== "sketchPoint") {
      unsupported("OCC hole location participants must be sketchPoint targets.");
    }
  }
  for (const target of bodyTargets) {
    if (target.kind !== "body") {
      unsupported("OCC hole body participants must be durable body targets.");
    }
  }

  const bodyRefs = bodyTargets as Extract<DurableRef, { kind: "body" }>[];
  const bodyIds = bodyRefs.map((target) => target.bodyId as BodyId);
  const seenBodyIds = new Set<BodyId>();
  for (const bodyId of bodyIds) {
    if (seenBodyIds.has(bodyId)) {
      unsupported("OCC hole body participant scope must not contain duplicate bodies.");
    }
    seenBodyIds.add(bodyId);
  }

  return {
    locationTargets: locationTargets as Extract<DurableRef, { kind: "sketchPoint" }>[],
    bodyIds,
  };
}

function resolveHoleLocations(
  context: OccFeatureExecutionContext,
  locations: readonly Extract<DurableRef, { kind: "sketchPoint" }>[],
  direction: HoleDirection,
): HoleLocation[] {
  return locations.map((target) => {
    const sketch = requireSketchSnapshot(context, target.sketchId);
    const solvedPoint = sketch.sketch.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === target.pointId,
    );
    if (!solvedPoint) {
      unsupported(
        `OCC hole location point ${target.pointId} does not resolve in sketch ${target.sketchId}.`,
      );
    }

    const frame = sketch.plane.frame;
    const normal = normalize(frame.normal);
    return {
      origin: mapSketchPointToWorld(sketch.plane, solvedPoint.solvedPosition),
      axisDirection: direction === "reverse" ? negate(normal) : normal,
      radialDirection: normalize(frame.xAxis),
    };
  });
}

function getProjectionRange(
  context: OccFeatureExecutionContext,
  bodyIds: readonly BodyId[],
  direction: Vec3,
) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const bodyId of bodyIds) {
    const body = requireSolidBody(context, bodyId, "hole");
    for (const point of getShapeVertexPoints(context.oc, body.shape)) {
      const projection = dot(point, direction);
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    unsupported("OCC hole could not resolve target body projection extents.");
  }

  return { min, max };
}

function makeAxis(
  oc: OpenCascadeInstance,
  origin: Vec3,
  direction: Vec3,
  radialDirection: Vec3,
) {
  const point = toGpPnt(oc, origin);
  const normal = toGpDir(oc, direction);
  const radial = toGpDir(oc, radialDirection);
  const axis = new oc.gp_Ax2_2(point, normal, radial);
  return { point, normal, radial, axis };
}

function makeCylinder(
  oc: OpenCascadeInstance,
  origin: Vec3,
  direction: Vec3,
  radialDirection: Vec3,
  radius: number,
  height: number,
) {
  const axisParts = makeAxis(oc, origin, direction, radialDirection);
  const progress = new oc.Message_ProgressRange_1();
  const cylinder = new oc.BRepPrimAPI_MakeCylinder_3(axisParts.axis, radius, height);
  try {
    cylinder.Build(progress);
    if (!cylinder.IsDone()) {
      unsupported("OCC hole cylinder tool build failed.");
    }
    return cylinder.Shape() as InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  } finally {
    deleteOccObject(cylinder);
    deleteOccObject(progress);
    deleteOccObject(axisParts.axis);
    deleteOccObject(axisParts.radial);
    deleteOccObject(axisParts.normal);
    deleteOccObject(axisParts.point);
  }
}

function makeCountersinkTool(
  oc: OpenCascadeInstance,
  location: HoleLocation,
  mainRadius: number,
  sinkRadius: number,
  sinkDepth: number,
  margin: number,
) {
  const axisStart = add(location.origin, scale(location.axisDirection, -margin));
  const axisEnd = add(location.origin, scale(location.axisDirection, sinkDepth));
  const outerStart = add(axisStart, scale(location.radialDirection, sinkRadius));
  const outerEnd = add(axisEnd, scale(location.radialDirection, mainRadius));
  const p1 = toGpPnt(oc, axisStart);
  const p2 = toGpPnt(oc, outerStart);
  const p3 = toGpPnt(oc, outerEnd);
  const p4 = toGpPnt(oc, axisEnd);
  const polygon = new oc.BRepBuilderAPI_MakePolygon_4(p1, p2, p3, p4, true);
  const axisPoint = toGpPnt(oc, location.origin);
  const axisDirection = toGpDir(oc, location.axisDirection);
  const axis = new oc.gp_Ax1_2(axisPoint, axisDirection);
  const progress = new oc.Message_ProgressRange_1();
  let face: InstanceType<OpenCascadeInstance["TopoDS_Face"]> | null = null;
  let revol: InstanceType<OpenCascadeInstance["BRepPrimAPI_MakeRevol"]> | null = null;

  try {
    if (!polygon.IsDone()) {
      unsupported("OCC hole countersink profile wire build failed.");
    }
    const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(polygon.Wire(), true);
    try {
      if (!faceBuilder.IsDone()) {
        unsupported("OCC hole countersink profile face build failed.");
      }
      face = faceBuilder.Face();
    } finally {
      deleteOccObject(faceBuilder);
    }

    revol = new oc.BRepPrimAPI_MakeRevol_2(face, axis, false);
    revol.Build(progress);
    if (!revol.IsDone()) {
      unsupported("OCC hole countersink revolution tool build failed.");
    }
    return revol.Shape() as InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
  } finally {
    deleteOccObject(revol);
    deleteOccObject(progress);
    deleteOccObject(axis);
    deleteOccObject(axisDirection);
    deleteOccObject(axisPoint);
    deleteOccObject(polygon);
    deleteOccObject(p4);
    deleteOccObject(p3);
    deleteOccObject(p2);
    deleteOccObject(p1);
  }
}

function makeCompound(
  oc: OpenCascadeInstance,
  shapes: readonly InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[],
) {
  if (shapes.length === 0) {
    unsupported("OCC hole produced no cutting tools.");
  }
  if (shapes.length === 1) {
    return shapes[0]!;
  }

  const builder = new oc.BRep_Builder();
  const compound = new oc.TopoDS_Compound();
  builder.MakeCompound(compound);
  for (const shape of shapes) {
    builder.Add(compound, shape);
  }
  deleteOccObject(builder);
  return compound as InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;
}

function computeCountersinkDepth(
  mainRadius: number,
  sinkRadius: number,
  angleDegrees: number,
) {
  const halfAngleRadians = (angleDegrees * Math.PI) / 360;
  const depth = (sinkRadius - mainRadius) / Math.tan(halfAngleRadians);
  if (!Number.isFinite(depth) || depth <= 0) {
    unsupported("OCC hole countersink geometry is degenerate.");
  }
  return depth;
}

function fuseToolShapes(
  oc: OpenCascadeInstance,
  shapes: readonly InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[],
) {
  if (shapes.length === 0) {
    unsupported("OCC hole produced no cutting tools for one location.");
  }

  let fused = shapes[0]!;
  for (const shape of shapes.slice(1)) {
    fused = runBoolean(oc, "join", fused, shape).shape;
  }
  return fused;
}

function buildHoleTool(
  context: OccFeatureExecutionContext,
  options: ResolvedHoleOptions,
  bodyIds: readonly BodyId[],
  locations: readonly HoleLocation[],
) {
  const mainRadius = options.mainDiameter / 2;
  const margin = Math.max(context.modelingTolerance * 10, 1e-4);
  const tools: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[] = [];

  for (const location of locations) {
    const mainStart =
      options.termination === "throughAll"
        ? add(
            location.origin,
            scale(
              location.axisDirection,
              getProjectionRange(context, bodyIds, location.axisDirection).min -
                margin -
                dot(location.origin, location.axisDirection),
            ),
          )
        : add(location.origin, scale(location.axisDirection, -margin));
    const mainHeight =
      options.termination === "throughAll"
        ? (() => {
            const range = getProjectionRange(context, bodyIds, location.axisDirection);
            return range.max - range.min + margin * 2;
          })()
        : options.depth! + margin;

    const locationTools: InstanceType<OpenCascadeInstance["TopoDS_Shape"]>[] = [
      makeCylinder(
        context.oc,
        mainStart,
        location.axisDirection,
        location.radialDirection,
        mainRadius,
        mainHeight,
      ),
    ];

    const entryStart = add(location.origin, scale(location.axisDirection, -margin));
    if (options.style === "counterbore") {
      locationTools.push(
        makeCylinder(
          context.oc,
          entryStart,
          location.axisDirection,
          location.radialDirection,
          options.counterboreDiameter! / 2,
          options.counterboreDepth! + margin,
        ),
      );
    } else if (options.style === "countersink") {
      locationTools.push(
        makeCountersinkTool(
          context.oc,
          location,
          mainRadius,
          options.countersinkDiameter! / 2,
          computeCountersinkDepth(
            mainRadius,
            options.countersinkDiameter! / 2,
            options.countersinkAngleDegrees!,
          ),
          margin,
        ),
      );
    }
    tools.push(fuseToolShapes(context.oc, locationTools));
  }

  return makeCompound(context.oc, tools);
}

function booleanScopeForBodies(bodyIds: readonly BodyId[]): FeatureBooleanScope {
  return bodyIds.length === 1
    ? { kind: "targetBody", bodyId: bodyIds[0]! }
    : { kind: "targetBodies", bodyIds: [...bodyIds] };
}

function validateHoleContract(
  definition: AdvancedSolidFeatureDefinition & { kind: "hole" },
) {
  const diagnostics = validateAdvancedSolidFeatureDefinition(definition, HOLE_DESCRIPTOR);
  if (diagnostics.length > 0) {
    unsupported(
      `OCC hole contract validation failed: ${diagnostics
        .map((diagnostic) => diagnostic.message)
        .join(" ")}`,
    );
  }
}

export function executeHoleFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: AdvancedSolidFeatureDefinition & { kind: "hole" },
): OccFeatureExecutionResult {
  validateHoleContract(definition);
  const options = resolveHoleOptions(definition);
  const participants = requireParticipants(definition);
  const locations = resolveHoleLocations(
    context,
    participants.locationTargets,
    options.direction,
  );
  const tool = buildHoleTool(context, options, participants.bodyIds, locations);
  const result = applyBooleanPolicy(
    context,
    ownerFeatureId,
    "cut",
    booleanScopeForBodies(participants.bodyIds),
    tool,
    { sourceShapes: new Map() },
  );

  return {
    bodies: result.bodies,
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets: result.producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: result.historyInvalidations,
    topologyStage: createUnsupportedProducerTopologyStage({
      featureId: ownerFeatureId,
      bodies: result.bodies,
      producedTargets: result.producedTargets,
    }),
  };
}
