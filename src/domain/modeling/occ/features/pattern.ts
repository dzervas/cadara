import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import { getAdvancedParticipant } from "@/contracts/modeling/advanced-solid";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { MaybeAuthoredValue } from "@/contracts/modeling/authored-values";
import type { FeatureId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import { scale, toGpVec } from "@/domain/modeling/occ/geometry";
import { deleteOccObject } from "@/domain/modeling/occ/memory";
import type { OccTrackedBody } from "@/domain/modeling/occ/topology";
import { createUnsupportedProducerTopologyStage } from "@/domain/modeling/occ/topology-stage";
import {
  requireBody,
  type OccFeatureExecutionContext,
  type OccFeatureExecutionResult,
} from "@/domain/modeling/occ/features/shared";
import {
  requireUniqueTargetBodies,
  trackBodiesFromShape,
} from "@/domain/modeling/occ/features/boolean-operations";
import {
  buildCircularAxisReference,
  resolveLinearDirectionReference,
} from "@/domain/modeling/occ/features/mirror-transform";

const UNSUPPORTED = "advanced-feature-unsupported-kernel-case";

type LinearPatternDefinition = AdvancedSolidFeatureDefinition & {
  kind: "linearPattern";
};

type CircularPatternDefinition = AdvancedSolidFeatureDefinition & {
  kind: "circularPattern";
};

function unsupported(message: string): never {
  throw new Error(`${UNSUPPORTED}: ${message}`);
}

function getBodyTargets(
  definition: LinearPatternDefinition | CircularPatternDefinition,
) {
  const targets = getAdvancedParticipant(definition, "body")?.targets ?? [];

  if (targets.length === 0) {
    unsupported(`OCC ${definition.kind} requires at least one body participant.`);
  }

  for (const target of targets) {
    if (target.kind !== "body") {
      unsupported(`OCC ${definition.kind} body participants must be body targets.`);
    }
  }

  return targets as readonly Extract<DurableRef, { kind: "body" }>[];
}

function getSingleParticipantTarget(
  definition: LinearPatternDefinition | CircularPatternDefinition,
  role: "direction" | "axis",
) {
  const targets = getAdvancedParticipant(definition, role)?.targets ?? [];

  if (targets.length !== 1) {
    unsupported(`OCC ${definition.kind} requires exactly one ${role} participant.`);
  }

  const [target] = targets;
  if (!target) {
    unsupported(`OCC ${definition.kind} requires exactly one ${role} participant.`);
  }

  return target;
}

function literalOption(
  definition: LinearPatternDefinition | CircularPatternDefinition,
  key: string,
) {
  const raw = definition.parameters.options?.[key];
  const literal = getAuthoredLiteralValue(raw as MaybeAuthoredValue<unknown>);
  if (raw === undefined || literal === null) {
    unsupported(`OCC ${definition.kind} requires literal ${key} option.`);
  }
  return literal;
}

function literalIntegerOption(
  definition: LinearPatternDefinition | CircularPatternDefinition,
  key: string,
) {
  const value = literalOption(definition, key);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2) {
    unsupported(
      `OCC ${definition.kind} ${key} option must be an integer of at least 2 including the seed.`,
    );
  }
  return value;
}

function literalPositiveNumberOption(
  definition: LinearPatternDefinition | CircularPatternDefinition,
  key: string,
) {
  const value = literalOption(definition, key);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    unsupported(`OCC ${definition.kind} ${key} option must be a positive number.`);
  }
  return value;
}

function literalBooleanOption(
  definition: LinearPatternDefinition | CircularPatternDefinition,
  key: string,
) {
  const value = literalOption(definition, key);
  if (typeof value !== "boolean") {
    unsupported(`OCC ${definition.kind} ${key} option must be a boolean.`);
  }
  return value;
}

function optionalLiteralBooleanOption(
  definition: LinearPatternDefinition | CircularPatternDefinition,
  key: string,
  defaultValue: boolean,
) {
  const raw = definition.parameters.options?.[key];
  if (raw === undefined) {
    return defaultValue;
  }
  const value = getAuthoredLiteralValue(raw as MaybeAuthoredValue<unknown>);
  if (typeof value !== "boolean") {
    unsupported(`OCC ${definition.kind} ${key} option must be a literal boolean.`);
  }
  return value;
}

function trackTransformedCopy(input: {
  context: OccFeatureExecutionContext;
  ownerFeatureId: FeatureId;
  sourceBody: OccTrackedBody;
  transform: InstanceType<OccFeatureExecutionContext["oc"]["gp_Trsf_1"]>;
  label: string;
  slot: string;
}) {
  const builder = new input.context.oc.BRepBuilderAPI_Transform_2(
    input.sourceBody.shape,
    input.transform,
    true,
  );
  const progress = new input.context.oc.Message_ProgressRange_1();
  try {
    builder.Build(progress);
    if (!builder.IsDone()) {
      unsupported(`OCC ${input.label} transform build failed.`);
    }

    return trackBodiesFromShape(
      input.context,
      input.ownerFeatureId,
      input.label,
      builder.Shape(),
      input.slot,
    );
  } finally {
    deleteOccObject(progress);
    deleteOccObject(builder);
  }
}

function baseResult(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  patternedBodies: OccTrackedBody[],
): OccFeatureExecutionResult {
  const producedTargets = patternedBodies.map((body) => ({
    kind: "body" as const,
    bodyId: body.bodyId,
  }));

  return {
    bodies: [...context.bodies, ...patternedBodies],
    constructions: [...context.constructions],
    constructionPlanes: new Map(context.constructionPlanes),
    producedTargets,
    entities: [],
    renderRecords: [],
    historyInvalidations: new Map(),
    topologyStage: createUnsupportedProducerTopologyStage({
      featureId: ownerFeatureId,
      bodies: patternedBodies,
      producedTargets,
    }),
  };
}

export function executeLinearPatternFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: LinearPatternDefinition,
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    unsupported("OCC linearPattern does not support operation intents.");
  }

  const bodyTargets = getBodyTargets(definition);
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId));
  const instanceCount = literalIntegerOption(definition, "instanceCount");
  const spacing = literalPositiveNumberOption(definition, "spacing");
  const centered = optionalLiteralBooleanOption(definition, "centered", false);
  if (centered) {
    unsupported("OCC linearPattern currently rejects centered=true.");
  }
  const oppositeDirection = literalBooleanOption(definition, "oppositeDirection");
  const direction = resolveLinearDirectionReference(
    context,
    ownerFeatureId,
    getSingleParticipantTarget(definition, "direction"),
    "linear_pattern_direction",
  );
  const signedDirection = oppositeDirection ? scale(direction, -1) : direction;
  const patternedBodies: OccTrackedBody[] = [];

  // Output order is deterministic: seed participant order outer, copy instance
  // index inner. The selected seed bodies remain unchanged in context.bodies.
  for (const [seedIndex, target] of bodyTargets.entries()) {
    const body = requireBody(context, target.bodyId);
    for (let instanceIndex = 1; instanceIndex < instanceCount; instanceIndex += 1) {
      const translation = new context.oc.gp_Trsf_1();
      const vector = toGpVec(context.oc, scale(signedDirection, spacing * instanceIndex));
      try {
        translation.SetTranslation_1(vector);
        patternedBodies.push(
          ...trackTransformedCopy({
            context,
            ownerFeatureId,
            sourceBody: body,
            transform: translation,
            label: "Linear pattern result",
            slot: `linear_seed${seedIndex + 1}_instance${instanceIndex}`,
          }),
        );
      } finally {
        deleteOccObject(vector);
        deleteOccObject(translation);
      }
    }
  }

  return baseResult(context, ownerFeatureId, patternedBodies);
}

function getCircularStepDegrees(
  definition: CircularPatternDefinition,
  instanceCount: number,
) {
  const angleDegrees = literalOption(definition, "angleDegrees");
  if (
    typeof angleDegrees !== "number" ||
    !Number.isFinite(angleDegrees) ||
    angleDegrees === 0 ||
    Math.abs(angleDegrees) > 360
  ) {
    unsupported(
      "OCC circularPattern angleDegrees option must be non-zero and no more than 360 degrees in magnitude.",
    );
  }

  const equalSpace = literalBooleanOption(definition, "equalSpace");
  const oppositeDirection = literalBooleanOption(definition, "oppositeDirection");
  const signedAngle = oppositeDirection ? -angleDegrees : angleDegrees;

  if (!equalSpace) {
    return signedAngle;
  }

  return Math.abs(angleDegrees) === 360
    ? signedAngle / instanceCount
    : signedAngle / (instanceCount - 1);
}

export function executeCircularPatternFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: CircularPatternDefinition,
): OccFeatureExecutionResult {
  if (definition.parameters.operationIntent !== undefined) {
    unsupported("OCC circularPattern does not support operation intents.");
  }

  const bodyTargets = getBodyTargets(definition);
  requireUniqueTargetBodies(bodyTargets.map((target) => target.bodyId));
  const instanceCount = literalIntegerOption(definition, "instanceCount");
  const stepDegrees = getCircularStepDegrees(definition, instanceCount);
  const axis = buildCircularAxisReference(
    context,
    ownerFeatureId,
    getSingleParticipantTarget(definition, "axis"),
    "circular_pattern_axis",
  );
  const patternedBodies: OccTrackedBody[] = [];

  try {
    // Output order is deterministic: seed participant order outer, copy instance
    // index inner. The selected seed bodies remain unchanged in context.bodies.
    for (const [seedIndex, target] of bodyTargets.entries()) {
      const body = requireBody(context, target.bodyId);
      for (let instanceIndex = 1; instanceIndex < instanceCount; instanceIndex += 1) {
        const rotation = new context.oc.gp_Trsf_1();
        try {
          rotation.SetRotation_1(axis, (stepDegrees * instanceIndex * Math.PI) / 180);
          patternedBodies.push(
            ...trackTransformedCopy({
              context,
              ownerFeatureId,
              sourceBody: body,
              transform: rotation,
              label: "Circular pattern result",
              slot: `circular_seed${seedIndex + 1}_instance${instanceIndex}`,
            }),
          );
        } finally {
          deleteOccObject(rotation);
        }
      }
    }
  } finally {
    deleteOccObject(axis);
  }

  return baseResult(context, ownerFeatureId, patternedBodies);
}
