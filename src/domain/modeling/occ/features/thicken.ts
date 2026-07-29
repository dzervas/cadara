import type {
  FeatureBooleanOperation,
  FeatureBooleanScope,
} from "@/contracts/modeling/schema";
import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { getAdvancedParticipant } from "@/contracts/modeling/advanced-solid";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  requireBody,
  requireFace,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  applyBooleanPolicy,
  assertValidFeatureResultShape,
} from "@/domain/modeling/occ/features/boolean-operations";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import { extractSolidShapes } from "@/domain/modeling/occ/topology";
import { createUnsupportedProducerTopologyStage } from "@/domain/modeling/occ/topology-stage";

const THICKEN_UNSUPPORTED = "advanced-feature-unsupported-kernel-case";

type ThickenDefinition = AdvancedSolidFeatureDefinition & { kind: "thicken" };
type OccShape = InstanceType<OpenCascadeInstance["TopoDS_Shape"]>;

function unsupported(message: string): never {
  throw new Error(`${THICKEN_UNSUPPORTED}: ${message}`);
}

function getThickenThickness(definition: ThickenDefinition) {
  const thickness = getAuthoredLiteralValue(
    definition.parameters.options?.thickness as never,
  );

  if (thickness === null || !Number.isFinite(thickness) || thickness <= 0) {
    unsupported("OCC thicken requires a positive resolved thickness option.");
  }

  return thickness;
}

function getThickenSide(definition: ThickenDefinition) {
  const side = getAuthoredLiteralValue(
    definition.parameters.options?.side as never,
  );

  if (side === undefined || side === null || side === "oneSide") {
    return "oneSide" as const;
  }
  if (side === "symmetric") {
    return "symmetric" as const;
  }
  unsupported("OCC thicken side must be oneSide or symmetric.");
}

function getThickenDirection(definition: ThickenDefinition) {
  const direction = definition.parameters.options?.direction;

  if (direction === undefined || direction === "positive") {
    return "positive" as const;
  }
  if (direction === "negative") {
    return "negative" as const;
  }
  unsupported("OCC thicken direction must be positive or negative.");
}

function buildFaceSourceShell(
  context: OccFeatureExecutionContext,
  targets: readonly Extract<DurableRef, { kind: "face" }>[],
) {
  const builder = new context.oc.BRep_Builder();
  const shell = new context.oc.TopoDS_Shell();
  try {
    builder.MakeShell(shell);
    for (const target of targets) {
      const body = requireBody(context, target.bodyId);
      builder.Add(shell, requireFace(context, body, target.faceId));
    }
    return shell;
  } finally {
    deleteOccObject(builder);
  }
}

function resolveThickenSourceShape(
  context: OccFeatureExecutionContext,
  definition: ThickenDefinition,
): OccShape {
  const targets = getAdvancedParticipant(definition, "face")?.targets ?? [];
  const faceTargets = targets.filter(
    (target): target is Extract<DurableRef, { kind: "face" }> =>
      target.kind === "face",
  );
  const bodyTargets = targets.filter(
    (target): target is Extract<DurableRef, { kind: "body" }> =>
      target.kind === "body",
  );

  if (faceTargets.length > 0 && bodyTargets.length > 0) {
    unsupported(
      "OCC thicken source targets must be either durable faces or one sheet body, not a mixed target set.",
    );
  }

  if (bodyTargets.length > 0) {
    if (bodyTargets.length !== 1 || targets.length !== 1) {
      unsupported("OCC thicken requires exactly one sheet body source target.");
    }
    const body = requireBody(context, bodyTargets[0]!.bodyId);
    if (body.bodyKind !== "sheet") {
      unsupported(
        `OCC thicken body source ${body.bodyId} must be a sheet body.`,
      );
    }
    return body.shape;
  }

  if (faceTargets.length === 0 || faceTargets.length !== targets.length) {
    unsupported(
      "OCC thicken requires one or more durable face targets or one sheet body target.",
    );
  }

  return buildFaceSourceShell(context, faceTargets);
}

function buildOffsetShape(
  context: OccFeatureExecutionContext,
  sourceShape: OccShape,
  offset: number,
) {
  const builder = new context.oc.BRepOffsetAPI_MakeOffsetShape();
  const progress = new context.oc.Message_ProgressRange_1();
  try {
    builder.PerformByJoin(
      sourceShape,
      offset,
      context.modelingTolerance,
      context.oc.BRepOffset_Mode.BRepOffset_Skin as never,
      false,
      false,
      context.oc.GeomAbs_JoinType.GeomAbs_Arc as never,
      false,
      progress,
    );
    builder.Build(progress);
    if (!builder.IsDone()) {
      unsupported("thicken-failed: OCC symmetric source offset failed.");
    }
    return builder.Shape();
  } finally {
    deleteOccObject(progress);
    deleteOccObject(builder);
  }
}

function buildThickSolid(
  context: OccFeatureExecutionContext,
  sourceShape: OccShape,
  thickness: number,
) {
  const builder = new context.oc.BRepOffsetAPI_MakeThickSolid();
  const progress = new context.oc.Message_ProgressRange_1();
  try {
    builder.MakeThickSolidBySimple(sourceShape, thickness);
    builder.Build(progress);
    if (!builder.IsDone()) {
      unsupported("thicken-failed: OCC thick-solid construction failed.");
    }

    const shape = builder.Shape();
    const solids = extractSolidShapes(context.oc, shape);
    if (solids.length !== 1) {
      unsupported(
        `thicken-failed: OCC thicken produced ${solids.length} solid result bodies instead of exactly one.`,
      );
    }
    assertValidFeatureResultShape(context, solids[0]!, "thicken");
    return solids[0]!;
  } finally {
    deleteOccObject(progress);
    deleteOccObject(builder);
  }
}

function buildThickenFeatureShape(
  context: OccFeatureExecutionContext,
  definition: ThickenDefinition,
) {
  const thickness = getThickenThickness(definition);
  const side = getThickenSide(definition);
  const direction = getThickenDirection(definition);
  const signedThickness = direction === "positive" ? thickness : -thickness;
  let sourceShape = resolveThickenSourceShape(context, definition);

  try {
    if (side === "symmetric") {
      sourceShape = buildOffsetShape(context, sourceShape, -signedThickness / 2);
    }
    return buildThickSolid(context, sourceShape, signedThickness);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`${THICKEN_UNSUPPORTED}:`)
    ) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    unsupported(`thicken-failed: OCC thicken kernel execution failed: ${message}`);
  }
}

function getThickenBooleanPolicy(definition: ThickenDefinition): {
  operation: FeatureBooleanOperation;
  booleanScope: FeatureBooleanScope;
} {
  const intent =
    getAuthoredLiteralValue(definition.parameters.operationIntent) ?? "create";

  if (intent === "create") {
    return {
      operation: "newBody",
      booleanScope: { kind: "standalone" },
    };
  }

  const targetBodyIds = (
    getAdvancedParticipant(definition, "targetBody")?.targets ?? []
  ).map((target) => {
    if (target.kind !== "body") {
      unsupported("OCC thicken boolean targets must be durable body targets.");
    }
    return target.bodyId;
  });
  if (targetBodyIds.length === 0) {
    unsupported(
      `OCC thicken ${intent} requires at least one explicit solid target body.`,
    );
  }

  return {
    operation:
      intent === "add" ? "join" : intent === "subtract" ? "cut" : "intersect",
    booleanScope:
      targetBodyIds.length === 1
        ? { kind: "targetBody", bodyId: targetBodyIds[0]! }
        : { kind: "targetBodies", bodyIds: targetBodyIds },
  };
}

export function executeThickenFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: ThickenDefinition,
): OccFeatureExecutionResult {
  const featureShape = buildThickenFeatureShape(context, definition);
  const policy = getThickenBooleanPolicy(definition);
  const result = applyBooleanPolicy(
    context,
    ownerFeatureId,
    policy.operation,
    policy.booleanScope,
    featureShape,
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
