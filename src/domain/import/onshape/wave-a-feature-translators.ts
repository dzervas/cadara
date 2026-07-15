import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
  type AuthoredValue,
} from "@/contracts/modeling/authored-values";
import type { RevolveFeatureExtent } from "@/contracts/modeling/schema";
import type { SketchEntityId } from "@/contracts/shared/ids";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";
import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";
import {
  referencedSketchFeatureIdsFromProfileParameter,
  resolveOnshapeSketchProfiles,
  type DeferredSketchProfile,
} from "@/domain/import/onshape/profile-resolver";
import { translateSolvedSketch } from "@/domain/import/onshape/solved-sketch-projection";

export interface PlannedRevolve {
  sketchFeatureId: string;
  profiles: DeferredSketchProfile[];
  axisEntityId: SketchEntityId;
  startAngle: AuthoredValue<number>;
  extent: RevolveFeatureExtent;
}

function findParameter(feature: OnshapeFeatureNode, parameterId: string) {
  return (feature.parameters ?? []).find(
    (parameter) =>
      typeof parameter === "object" &&
      parameter !== null &&
      (parameter as { parameterId?: unknown }).parameterId === parameterId,
  ) as Record<string, unknown> | undefined;
}

function enumValue(feature: OnshapeFeatureNode, parameterId: string) {
  const value = findParameter(feature, parameterId)?.value;
  return typeof value === "string" ? value : null;
}

function booleanValue(feature: OnshapeFeatureNode, parameterId: string) {
  return findParameter(feature, parameterId)?.value === true;
}

function queryText(parameter: unknown) {
  if (typeof parameter !== "object" || parameter === null) return "";
  const queries = (parameter as { queries?: unknown }).queries;
  if (!Array.isArray(queries)) return "";
  return queries
    .map((query) =>
      typeof query === "object" &&
      query !== null &&
      typeof (query as { queryString?: unknown }).queryString === "string"
        ? (query as { queryString: string }).queryString
        : "",
    )
    .join("\n");
}

function authoredAngle(expression: unknown): AuthoredValue<number> {
  const translated = translateOnshapeExpression({
    expression: typeof expression === "string" ? expression : null,
  });
  const numeric = Number(translated.valueText);
  return createExpressionAuthoredValue(
    Number.isFinite(numeric)
      ? String(numeric * (Math.PI / 180))
      : `(${translated.valueText}) * ${Math.PI / 180}`,
  );
}

function planRevolve(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
): PlannedRevolve | null {
  const profileParameter = findParameter(context.feature, "entities");
  const sketchIds = referencedSketchFeatureIdsFromProfileParameter(profileParameter);
  if (sketchIds.length !== 1) return null;

  const sketchFeatureId = sketchIds[0]!;
  const referencedSketch = context.state.sketchPlansByFeatureId.get(sketchFeatureId);
  const solvedSketch = context.read.solvedSketchesByFeatureId.get(sketchFeatureId);
  if (!referencedSketch || !solvedSketch) return null;

  if (
    (enumValue(context.feature, "bodyType") ?? "SOLID") !== "SOLID" ||
    (enumValue(context.feature, "operationType") ?? "NEW") !== "NEW"
  ) {
    return null;
  }

  const profiles = resolveOnshapeSketchProfiles({
    profileParameter,
    featureLabel: context.label,
    featureKind: "revolve",
    solvedSketch,
    referencedSketch,
  });
  if (profiles.tier !== "resolved") return null;

  const axisQuery = queryText(findParameter(context.feature, "axis"));
  const axisSource = solvedSketch.entities.find(
    (entity) =>
      entity.entityType === "lineSegment" &&
      axisQuery.includes(entity.entityId),
  );
  if (!axisSource) return null;

  const translation = translateSolvedSketch({
    solved: solvedSketch,
    featureId: sketchFeatureId,
    label: sketchFeatureId,
    planeKey: referencedSketch.planeKey,
  });
  const axisEntity = translation.definition.entities.find(
    (entity) => entity.kind === "lineSegment" && entity.label === axisSource.entityId,
  );
  if (!axisEntity) return null;

  const revolveType = enumValue(context.feature, "revolveType") ?? "FULL";
  let extent: RevolveFeatureExtent;
  if (revolveType === "FULL") {
    extent = { mode: "oneSide", end: { kind: "full" } };
  } else if (revolveType === "ONE_DIRECTION" || revolveType === "BLIND") {
    extent = {
      mode: "oneSide",
      end: {
        kind: "blind",
        direction: booleanValue(context.feature, "oppositeDirection")
          ? "clockwise"
          : "counterClockwise",
        angle: authoredAngle(findParameter(context.feature, "angle")?.expression),
      },
    };
  } else {
    return null;
  }

  return {
    sketchFeatureId,
    profiles: profiles.profiles,
    axisEntityId: axisEntity.entityId,
    startAngle: createLiteralAuthoredValue(0),
    extent,
  };
}

function baked(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
  reason:
    | "revolve-axis-unresolved"
    | "thicken-requires-topology"
    | "sweep-path-unresolved"
    | "loft-profile-unresolved",
) {
  context.state.bakedLineageFeatureIds.add(context.feature.featureId);
  return {
    onshapeFeatureId: context.feature.featureId,
    featureType: context.feature.featureType,
    label: context.label,
    tier: "baked" as const,
    target: { kind: "bakedBody" as const },
    reasonCodes: [reason],
    suppressed: true,
    inputFeatureIds: [],
  };
}

export const revolveFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["revolve"],
  plan: (context) => {
    const plannedRevolve = planRevolve(context);
    if (!plannedRevolve) return baked(context, "revolve-axis-unresolved");
    context.state.bodyProducingFeatureIds.push(context.feature.featureId);
    return {
      onshapeFeatureId: context.feature.featureId,
      featureType: context.feature.featureType,
      label: context.label,
      tier: "parametric",
      target: { kind: "feature" },
      reasonCodes: [],
      suppressed: context.onshapeSuppressed,
      plannedRevolve,
      inputFeatureIds: [plannedRevolve.sketchFeatureId],
    };
  },
  apply: ({ apply }) => apply(),
};

export const thickenFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["thicken"],
  plan: (context) => baked(context, "thicken-requires-topology"),
  apply: ({ apply }) => apply(),
};

export const sweepFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["sweep"],
  plan: (context) => baked(context, "sweep-path-unresolved"),
  apply: ({ apply }) => apply(),
};

export const loftFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["loft"],
  plan: (context) => baked(context, "loft-profile-unresolved"),
  apply: ({ apply }) => apply(),
};
