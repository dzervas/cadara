import type { FeatureReplayFeatureParameters } from "@/contracts/modeling/feature-replay";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { FeatureId } from "@/contracts/shared/ids";
import { scale, toGpDir, toGpPnt, toGpVec } from "@/domain/modeling/occ/geometry";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import { createUnsupportedProducerTopologyStage } from "@/domain/modeling/occ/topology-stage";
import {
  resolveLinearDirectionReference,
  resolvePlanarReferencePlane,
} from "@/domain/modeling/occ/features/mirror-transform";
import { applyBooleanPolicy } from "@/domain/modeling/occ/features/boolean-operations";
import { buildExtrudeFeatureShape } from "@/domain/modeling/occ/features/extrude";
import { resolveFeatureDefinitionValues } from "@/domain/modeling/feature-value-expressions";
import type {
  OccFeatureExecutionContext,
  OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import type { OccReferenceInvalidationRecord } from "@/domain/modeling/occ/topology";

const UNSUPPORTED = "feature-replay-unsupported";

type LinearFeatureReplayTransform = Extract<
  FeatureReplayFeatureParameters["transform"],
  { kind: "linear" }
>;
type MirrorFeatureReplayTransform = Extract<
  FeatureReplayFeatureParameters["transform"],
  { kind: "mirror" }
>;

type ReplayTransform =
  | {
      kind: "linear";
      direction: LinearFeatureReplayTransform["direction"];
      distance: number;
    }
  | {
      kind: "mirror";
      plane: MirrorFeatureReplayTransform["plane"];
    };

type ReplayState = {
  context: OccFeatureExecutionContext;
  producedBodyIds: string[];
  historyInvalidations: Map<string, OccReferenceInvalidationRecord>;
};

function unsupported(message: string): never {
  throw new Error(`${UNSUPPORTED}: ${message}`);
}

function requireLiteralNumber(value: unknown, label: string) {
  const literal = getAuthoredLiteralValue(value as never);
  if (typeof literal !== "number" || !Number.isFinite(literal)) {
    unsupported(`${label} must be finite.`);
  }
  return literal;
}

function requireLiteralBoolean(value: unknown, label: string) {
  const literal = getAuthoredLiteralValue(value as never);
  if (typeof literal !== "boolean") {
    unsupported(`${label} must be a literal boolean.`);
  }
  return literal;
}

function localTransforms(
  parameters: FeatureReplayFeatureParameters,
): readonly ReplayTransform[] {
  const transform = parameters.transform;
  if (transform.kind === "mirror") {
    return [{ kind: "mirror", plane: transform.plane }];
  }

  const instanceCount = requireLiteralNumber(
    transform.instanceCount,
    "Feature replay instance count",
  );
  const spacing = requireLiteralNumber(
    transform.spacing,
    "Feature replay spacing",
  );
  const oppositeDirection = requireLiteralBoolean(
    transform.oppositeDirection,
    "Feature replay opposite direction",
  );
  if (!Number.isInteger(instanceCount) || instanceCount < 2 || spacing <= 0) {
    unsupported("Feature replay linear transform requires an integer count of at least 2 and positive spacing.");
  }
  const signedSpacing = oppositeDirection ? -spacing : spacing;
  return Array.from({ length: instanceCount - 1 }, (_, index) => ({
    kind: "linear" as const,
    direction: transform.direction,
    distance: signedSpacing * (index + 1),
  }));
}

function transformShape(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  shape: ReturnType<typeof buildExtrudeFeatureShape>["shape"],
  transforms: readonly ReplayTransform[],
) {
  let currentShape = shape;
  const builders: object[] = [];

  try {
    for (const [index, transform] of transforms.entries()) {
      const matrix = new context.oc.gp_Trsf_1();
      if (transform.kind === "linear") {
        const direction = resolveLinearDirectionReference(
          context,
          ownerFeatureId,
          transform.direction,
          `feature_replay_linear_${index + 1}`,
        );
        const vector = toGpVec(context.oc, scale(direction, transform.distance));
        try {
          matrix.SetTranslation_1(vector);
        } finally {
          deleteOccObject(vector);
        }
      } else {
        const plane = resolvePlanarReferencePlane(
          context,
          transform.plane,
          `construction_${ownerFeatureId}_feature_replay_mirror_${index + 1}` as never,
        );
        const axis = new context.oc.gp_Ax2_2(
          toGpPnt(context.oc, plane.frame.origin),
          toGpDir(context.oc, plane.frame.normal),
          toGpDir(context.oc, plane.frame.xAxis),
        );
        try {
          matrix.SetMirror_3(axis);
        } finally {
          deleteOccObject(axis);
        }
      }

      const builder = new context.oc.BRepBuilderAPI_Transform_2(
        currentShape,
        matrix,
        true,
      );
      builders.push(builder);
      const progress = new context.oc.Message_ProgressRange_1();
      try {
        builder.Build(progress);
        if (!builder.IsDone()) {
          unsupported("OCC transformed source operation failed to build.");
        }
        currentShape = builder.Shape();
      } finally {
        deleteOccObject(progress);
        deleteOccObject(matrix);
      }
    }
    return currentShape;
  } finally {
    for (const builder of builders) {
      deleteOccObject(builder);
    }
  }
}

function sourceFeature(
  context: OccFeatureExecutionContext,
  sourceFeatureId: FeatureId,
) {
  const source = context.authoredFeatures?.find(
    (feature) => feature.featureId === sourceFeatureId,
  );
  if (!source) {
    throw new Error(
      `feature-replay-source-unavailable: source feature ${sourceFeatureId} does not resolve in the authored prefix.`,
    );
  }
  return source;
}

function replayExtrude(
  state: ReplayState,
  ownerFeatureId: FeatureId,
  definition: Extract<FeatureDefinition, { kind: "extrude" }>,
  transforms: readonly ReplayTransform[],
) {
  const operation = getAuthoredLiteralValue(definition.parameters.operation);
  if (operation !== "join" && operation !== "cut") {
    unsupported("Only additive and subtractive extrude source operations are replayable.");
  }
  if (definition.parameters.booleanScope.kind !== "targetBody") {
    unsupported("Replayed extrude operations require one exact target body lineage.");
  }
  const sourceShape = buildExtrudeFeatureShape(
    state.context,
    ownerFeatureId,
    definition.parameters,
  );
  const shape = transformShape(state.context, ownerFeatureId, sourceShape.shape, transforms);
  const result = applyBooleanPolicy(
    state.context,
    ownerFeatureId,
    operation,
    definition.parameters.booleanScope,
    shape,
  );
  const producedBodyIds = result.producedTargets.flatMap((target) =>
    target.kind === "body" ? [target.bodyId] : [],
  );
  for (const [key, invalidation] of result.historyInvalidations) {
    state.historyInvalidations.set(key, invalidation);
  }
  return {
    context: { ...state.context, bodies: result.bodies },
    producedBodyIds: [...state.producedBodyIds, ...producedBodyIds],
    historyInvalidations: state.historyInvalidations,
  } satisfies ReplayState;
}

function replaySource(
  state: ReplayState,
  ownerFeatureId: FeatureId,
  sourceFeatureId: FeatureId,
  outerTransforms: readonly ReplayTransform[],
  ancestry: ReadonlySet<FeatureId>,
): ReplayState {
  if (ancestry.has(sourceFeatureId)) {
    unsupported(`Source feature cycle includes ${sourceFeatureId}.`);
  }
  const source = sourceFeature(state.context, sourceFeatureId);
  const resolved = resolveFeatureDefinitionValues({
    definition: source.definition,
    variables: state.context.variables ?? [],
  });
  if (!resolved.ok) {
    throw new Error(
      `feature-replay-source-values-unresolved: source feature ${sourceFeatureId} has unresolved authored values.`,
    );
  }
  const definition = resolved.definition;
  const nextAncestry = new Set([...ancestry, sourceFeatureId]);

  if (definition.kind === "extrude") {
    return replayExtrude(state, ownerFeatureId, definition, outerTransforms);
  }
  if (definition.kind !== "featureReplay") {
    unsupported(`Source feature ${sourceFeatureId} is ${definition.kind}; only extrude and featureReplay sources are observed.`);
  }

  let current = state;
  for (const localTransform of localTransforms(definition.parameters)) {
    for (const nestedSourceFeatureId of definition.parameters.sourceFeatureIds) {
      current = replaySource(
        current,
        ownerFeatureId,
        nestedSourceFeatureId,
        [localTransform, ...outerTransforms],
        nextAncestry,
      );
    }
  }
  return current;
}

export function executeFeatureReplayFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  parameters: FeatureReplayFeatureParameters,
): OccFeatureExecutionResult {
  if (parameters.sourceFeatureIds.length === 0) {
    unsupported("Feature replay requires at least one source feature.");
  }
  if (new Set(parameters.sourceFeatureIds).size !== parameters.sourceFeatureIds.length) {
    unsupported("Feature replay source feature ids must be unique and ordered.");
  }

  let state: ReplayState = {
    context,
    producedBodyIds: [],
    historyInvalidations: new Map(),
  };
  for (const localTransform of localTransforms(parameters)) {
    for (const sourceFeatureId of parameters.sourceFeatureIds) {
      state = replaySource(
        state,
        ownerFeatureId,
        sourceFeatureId,
        [localTransform],
        new Set(),
      );
    }
  }

  const producedTargets = [...new Set(state.producedBodyIds)].map((bodyId) => ({
    kind: "body" as const,
    bodyId: bodyId as never,
  }));
  return {
    bodies: [...state.context.bodies],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: state.historyInvalidations,
    topologyStage: createUnsupportedProducerTopologyStage({
      featureId: ownerFeatureId,
      bodies: state.context.bodies,
      producedTargets,
    }),
  };
}
