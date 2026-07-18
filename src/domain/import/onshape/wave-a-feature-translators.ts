import {
  createExpressionAuthoredValue,
  createLiteralAuthoredValue,
  type AuthoredValue,
} from "@/contracts/modeling/authored-values";
import type {
  FeatureBooleanOperation,
  RevolveFeatureExtent,
} from "@/contracts/modeling/schema";
import type { SketchEntityId } from "@/contracts/shared/ids";
import type {
  OnshapeFeatureNode,
  OnshapeSolvedSketch,
} from "@/domain/import/onshape/bundle-reader";
import {
  dependencyFeatureIds,
  type FeatureDependencyInput,
  type OnshapeFeatureTranslator,
} from "@/domain/import/onshape/feature-translator-registry";
import type { PlanReasonCode } from "@/domain/import/onshape/fidelity-planner";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";
import {
  referencedSketchFeatureIdsFromProfileParameter,
  resolveOnshapeSketchProfiles,
  type DeferredSketchProfile,
} from "@/domain/import/onshape/profile-resolver";
import { translateSolvedSketch } from "@/domain/import/onshape/solved-sketch-projection";

export type PlannedRevolveBoolean =
  | { kind: "standalone" }
  | { kind: "deferredBody"; sourceFeatureId: string };

export interface PlannedRevolve {
  sketchFeatureId: string;
  profiles: DeferredSketchProfile[];
  axis: {
    sketchFeatureId: string;
    entityId: SketchEntityId;
  };
  startAngle: AuthoredValue<number>;
  extent: RevolveFeatureExtent;
  operation: AuthoredValue<FeatureBooleanOperation>;
  boolean: PlannedRevolveBoolean;
}

export interface PlannedSweep {
  sketchFeatureId: string;
  profiles: DeferredSketchProfile[];
  path: {
    sketchFeatureId: string;
    entityId: SketchEntityId;
  };
}

export interface PlannedLoft {
  profiles: {
    sketchFeatureId: string;
    profile: DeferredSketchProfile;
  }[];
}

type LoftFailureReason = Extract<
  PlanReasonCode,
  | "loft-profile-unresolved"
  | "loft-guides-unsupported"
  | "loft-conditions-unsupported"
  | "loft-periodicity-unsupported"
>;

type LoftPlanResult =
  | { kind: "planned"; loft: PlannedLoft; inputFeatureIds: string[] }
  | { kind: "baked"; reason: LoftFailureReason; inputFeatureIds: string[] };

type RevolveFailureReason = Extract<
  PlanReasonCode,
  | "revolve-operation-unsupported"
  | "revolve-body-type-unsupported"
  | "revolve-profile-unresolved"
  | "revolve-axis-unresolved"
  | "revolve-extent-unsupported"
>;

type RevolvePlanResult =
  | { kind: "planned"; revolve: PlannedRevolve; inputFeatureIds: string[] }
  | { kind: "baked"; reason: RevolveFailureReason; inputFeatureIds: string[] };

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

function hasQueries(feature: OnshapeFeatureNode, parameterId: string) {
  const queries = findParameter(feature, parameterId)?.queries;
  return Array.isArray(queries) && queries.length > 0;
}

function authoredAngle(expression: unknown): AuthoredValue<number> {
  const normalizedExpression =
    typeof expression === "string"
      ? expression.replace(/\*\s*(deg(?:ree|rees)?|rad(?:ian|ians)?)\b/gi, " $1")
      : null;
  const translated = translateOnshapeExpression({ expression: normalizedExpression });
  const numeric = Number(translated.valueText);
  return createExpressionAuthoredValue(
    Number.isFinite(numeric)
      ? String(numeric * (Math.PI / 180))
      : `(${translated.valueText}) * ${Math.PI / 180}`,
  );
}

function blindEnd(
  feature: OnshapeFeatureNode,
  input: {
    boundParameterId: string;
    angleParameterId: string;
    oppositeParameterId: string;
  },
): Extract<RevolveFeatureExtent, { mode: "oneSide" }> ["end"] | null {
  const bound = enumValue(feature, input.boundParameterId) ?? "BLIND";
  if (bound !== "BLIND" && bound !== "ONE_DIRECTION" && bound !== "SYMMETRIC") {
    return null;
  }
  return {
    kind: "blind",
    direction: booleanValue(feature, input.oppositeParameterId)
      ? "clockwise"
      : "counterClockwise",
    angle: authoredAngle(findParameter(feature, input.angleParameterId)?.expression),
  };
}

function translateExtent(feature: OnshapeFeatureNode): RevolveFeatureExtent | null {
  const revolveType = enumValue(feature, "revolveType");
  if (booleanValue(feature, "fullRevolve") || revolveType === "FULL") {
    return { mode: "oneSide", end: { kind: "full" } };
  }

  const firstEnd = blindEnd(feature, {
    boundParameterId: "endBound",
    angleParameterId: "angle",
    oppositeParameterId: "oppositeDirection",
  });
  if (!firstEnd || firstEnd.kind !== "blind") return null;

  if (
    enumValue(feature, "endBound") === "SYMMETRIC" ||
    revolveType === "SYMMETRIC" ||
    booleanValue(feature, "symmetric")
  ) {
    return { mode: "symmetric", end: firstEnd };
  }

  if (booleanValue(feature, "hasSecondDirection") || revolveType === "TWO_DIRECTIONS") {
    const secondEnd = blindEnd(feature, {
      boundParameterId: "secondDirectionBound",
      angleParameterId: "secondDirectionAngle",
      oppositeParameterId: "secondDirectionOppositeDirection",
    });
    if (!secondEnd || secondEnd.kind !== "blind") return null;
    return { mode: "twoSide", firstEnd, secondEnd };
  }

  if (
    revolveType === null ||
    revolveType === "ONE_DIRECTION" ||
    revolveType === "BLIND"
  ) {
    return { mode: "oneSide", end: firstEnd };
  }
  return null;
}

const OPERATION_MAP: Record<string, FeatureBooleanOperation> = {
  NEW: "newBody",
  ADD: "join",
  REMOVE: "cut",
  INTERSECT: "intersect",
};

function translateAxis(input: {
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0];
}): PlannedRevolve["axis"] | null {
  const axisQuery = queryText(findParameter(input.context.feature, "axis"));
  if (!axisQuery) return null;

  const sketchCandidates = [...input.context.read.solvedSketchesByFeatureId.entries()]
    .filter(([featureId]) => axisQuery.includes(featureId) && axisQuery.includes("wireOp"));
  if (sketchCandidates.length !== 1) return null;

  const [axisSketchFeatureId, solvedSketch] = sketchCandidates[0]!;
  const sketchPlan = input.context.state.sketchPlansByFeatureId.get(axisSketchFeatureId);
  if (!sketchPlan || sketchPlan.tier !== "parametric") return null;

  const axisSource = resolveAxisSource(axisQuery, solvedSketch);
  if (!axisSource) return null;

  const translation = translateSolvedSketch({
    solved: solvedSketch,
    featureId: axisSketchFeatureId,
    label: axisSketchFeatureId,
    planeKey: sketchPlan.planeKey,
    planeFrame: sketchPlan.planeFrame,
  });
  const axisEntity = translation.definition.entities.find(
    (entity) => entity.kind === "lineSegment" && entity.label === axisSource.entityId,
  );
  return axisEntity
    ? { sketchFeatureId: axisSketchFeatureId, entityId: axisEntity.entityId }
    : null;
}

function resolveAxisSource(axisQuery: string, solvedSketch: OnshapeSolvedSketch) {
  const lines = solvedSketch.entities.filter(
    (entity) => entity.entityType === "lineSegment",
  );
  const exact = lines.filter((entity) => axisQuery.includes(entity.entityId));
  if (exact.length === 1) return exact[0]!;

  const nthIndex = axisQuery.match(/qNthElement\([^;]*?,\s*(\d+)\s*\)/)?.[1];
  if (nthIndex !== undefined) {
    const createdEdges = solvedSketch.entities.filter(
      (entity) => entity.entityType === "lineSegment" || entity.entityType === "circle",
    );
    const indexed = createdEdges[Number(nthIndex)];
    return indexed?.entityType === "lineSegment" ? indexed : null;
  }

  return lines.length === 1 ? lines[0]! : null;
}

function resolveSweepPathSource(pathQuery: string, solvedSketch: OnshapeSolvedSketch) {
  const curves = solvedSketch.entities.filter(
    (entity) =>
      entity.entityType === "lineSegment" ||
      entity.entityType === "arc" ||
      entity.entityType === "circle",
  );
  const exact = curves.filter((entity) => pathQuery.includes(entity.entityId));
  if (exact.length === 1) return exact[0]!;

  const nthIndex = pathQuery.match(/qNthElement\([^;]*?,\s*(\d+)\s*\)/)?.[1];
  if (nthIndex !== undefined) {
    return curves[Number(nthIndex)] ?? null;
  }

  return curves.length === 1 ? curves[0]! : null;
}

function planSweep(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
): PlannedSweep | null {
  if (
    (enumValue(context.feature, "bodyType") ?? "SOLID") !== "SOLID" ||
    (enumValue(context.feature, "operationType") ?? "NEW") !== "NEW"
  ) {
    return null;
  }

  const profileParameter =
    findParameter(context.feature, "profiles") ??
    findParameter(context.feature, "entities");
  const profileSketchIds =
    referencedSketchFeatureIdsFromProfileParameter(profileParameter);
  if (profileSketchIds.length !== 1) return null;

  const sketchFeatureId = profileSketchIds[0]!;
  const referencedSketch = context.state.sketchPlansByFeatureId.get(sketchFeatureId);
  const solvedSketch = context.read.solvedSketchesByFeatureId.get(sketchFeatureId);
  const profiles = resolveOnshapeSketchProfiles({
    profileParameter,
    featureLabel: context.label,
    featureKind: "sweep",
    solvedSketch,
    referencedSketch,
  });
  if (profiles.tier !== "resolved") return null;

  const pathQuery = queryText(findParameter(context.feature, "path"));
  if (!pathQuery) return null;
  const pathSketchCandidates = [
    ...context.read.solvedSketchesByFeatureId.entries(),
  ].filter(
    ([featureId]) =>
      featureId !== sketchFeatureId &&
      pathQuery.includes(featureId) &&
      pathQuery.includes("wireOp"),
  );
  if (pathSketchCandidates.length !== 1) return null;

  const [pathSketchFeatureId, pathSolvedSketch] = pathSketchCandidates[0]!;
  const pathSketchPlan =
    context.state.sketchPlansByFeatureId.get(pathSketchFeatureId);
  if (!pathSketchPlan || pathSketchPlan.tier !== "parametric") return null;

  const pathSource = resolveSweepPathSource(pathQuery, pathSolvedSketch);
  if (!pathSource) return null;
  const translation = translateSolvedSketch({
    solved: pathSolvedSketch,
    featureId: pathSketchFeatureId,
    label: pathSketchFeatureId,
    planeKey: pathSketchPlan.planeKey,
    planeFrame: pathSketchPlan.planeFrame,
  });
  const pathEntity = translation.definition.entities.find(
    (entity) =>
      (entity.kind === "lineSegment" ||
        entity.kind === "arc" ||
        entity.kind === "circle") &&
      entity.label === pathSource.entityId,
  );
  if (!pathEntity) return null;

  return {
    sketchFeatureId,
    profiles: profiles.profiles,
    path: {
      sketchFeatureId: pathSketchFeatureId,
      entityId: pathEntity.entityId,
    },
  };
}

function arrayItems(feature: OnshapeFeatureNode, parameterId: string) {
  const items = findParameter(feature, parameterId)?.items;
  return Array.isArray(items) ? items : [];
}

function itemParameter(item: unknown, parameterIds: readonly string[]) {
  if (typeof item !== "object" || item === null) return undefined;
  const parameters = (item as { parameters?: unknown }).parameters;
  if (!Array.isArray(parameters)) return undefined;
  return parameters.find(
    (parameter) =>
      typeof parameter === "object" &&
      parameter !== null &&
      parameterIds.includes(String((parameter as { parameterId?: unknown }).parameterId)),
  );
}

function planLoft(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
): LoftPlanResult {
  if (
    booleanValue(context.feature, "addGuides") ||
    arrayItems(context.feature, "guidesArray").length > 0
  ) {
    return { kind: "baked", reason: "loft-guides-unsupported", inputFeatureIds: [] };
  }

  if (
    ![null, "DEFAULT"].includes(enumValue(context.feature, "startCondition")) ||
    ![null, "DEFAULT"].includes(enumValue(context.feature, "endCondition"))
  ) {
    return { kind: "baked", reason: "loft-conditions-unsupported", inputFeatureIds: [] };
  }

  if (booleanValue(context.feature, "makePeriodic")) {
    return { kind: "baked", reason: "loft-periodicity-unsupported", inputFeatureIds: [] };
  }

  if (
    (enumValue(context.feature, "bodyType") ?? "SOLID") !== "SOLID" ||
    (enumValue(context.feature, "operationType") ?? "NEW") !== "NEW" ||
    booleanValue(context.feature, "addSections") ||
    booleanValue(context.feature, "matchConnections")
  ) {
    return { kind: "baked", reason: "loft-profile-unresolved", inputFeatureIds: [] };
  }

  const sheetItems = arrayItems(context.feature, "sheetProfilesArray");
  const wireItems = arrayItems(context.feature, "wireProfilesArray");
  if ((sheetItems.length > 0) === (wireItems.length > 0)) {
    return { kind: "baked", reason: "loft-profile-unresolved", inputFeatureIds: [] };
  }

  const items = sheetItems.length > 0 ? sheetItems : wireItems;
  const parameterIds = sheetItems.length > 0
    ? ["sheetProfileEntities"]
    : ["wireProfileEntities", "wireProfiles"];
  const profiles: PlannedLoft["profiles"] = [];
  const inputFeatureIds: string[] = [];

  for (const item of items) {
    const profileParameter = itemParameter(item, parameterIds);
    const sketchIds = referencedSketchFeatureIdsFromProfileParameter(profileParameter);
    inputFeatureIds.push(...sketchIds);
    if (sketchIds.length !== 1) {
      return {
        kind: "baked",
        reason: "loft-profile-unresolved",
        inputFeatureIds: [...new Set(inputFeatureIds)],
      };
    }

    const sketchFeatureId = sketchIds[0]!;
    const resolved = resolveOnshapeSketchProfiles({
      profileParameter,
      featureLabel: context.label,
      featureKind: "loft",
      solvedSketch: context.read.solvedSketchesByFeatureId.get(sketchFeatureId),
      referencedSketch: context.state.sketchPlansByFeatureId.get(sketchFeatureId),
    });
    if (resolved.tier !== "resolved" || resolved.profiles.length !== 1) {
      return {
        kind: "baked",
        reason: "loft-profile-unresolved",
        inputFeatureIds: [...new Set(inputFeatureIds)],
      };
    }
    profiles.push({ sketchFeatureId, profile: resolved.profiles[0]! });
  }

  if (profiles.length < 2) {
    return {
      kind: "baked",
      reason: "loft-profile-unresolved",
      inputFeatureIds: [...new Set(inputFeatureIds)],
    };
  }
  return {
    kind: "planned",
    loft: { profiles },
    inputFeatureIds: [...new Set(inputFeatureIds)],
  };
}

function resolveBoolean(input: {
  feature: OnshapeFeatureNode;
  operation: FeatureBooleanOperation;
  priorBodyProducingFeatureIds: readonly string[];
}): PlannedRevolveBoolean | null {
  if (input.operation === "newBody") return { kind: "standalone" };

  if (hasQueries(input.feature, "booleanScope")) {
    const scopeQuery = queryText(findParameter(input.feature, "booleanScope"));
    const sources = input.priorBodyProducingFeatureIds.filter((featureId) =>
      scopeQuery.includes(featureId),
    );
    return sources.length === 1
      ? { kind: "deferredBody", sourceFeatureId: sources[0]! }
      : null;
  }

  return input.priorBodyProducingFeatureIds.length === 1
    ? {
        kind: "deferredBody",
        sourceFeatureId: input.priorBodyProducingFeatureIds[0]!,
      }
    : null;
}

function planRevolve(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
): RevolvePlanResult {
  if ((enumValue(context.feature, "bodyType") ?? "SOLID") !== "SOLID") {
    return { kind: "baked", reason: "revolve-body-type-unsupported", inputFeatureIds: [] };
  }

  const operationType = enumValue(context.feature, "operationType") ?? "NEW";
  const operation = OPERATION_MAP[operationType];
  if (!operation) {
    return { kind: "baked", reason: "revolve-operation-unsupported", inputFeatureIds: [] };
  }

  const capturedProfileParameter = findParameter(context.feature, "entities");
  let sketchIds = referencedSketchFeatureIdsFromProfileParameter(capturedProfileParameter);
  if (sketchIds.length === 0) {
    const capturedQuery = queryText(capturedProfileParameter);
    sketchIds = [...context.read.solvedSketchesByFeatureId.keys()].filter(
      (featureId) => capturedQuery.includes(featureId) && capturedQuery.includes("wireOp"),
    );
  }
  if (sketchIds.length !== 1) {
    return { kind: "baked", reason: "revolve-profile-unresolved", inputFeatureIds: sketchIds };
  }

  const sketchFeatureId = sketchIds[0]!;
  const profileParameter =
    referencedSketchFeatureIdsFromProfileParameter(capturedProfileParameter).length === 1
      ? capturedProfileParameter
      : {
          queries: [{
            queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
          }],
        };
  const referencedSketch = context.state.sketchPlansByFeatureId.get(sketchFeatureId);
  const solvedSketch = context.read.solvedSketchesByFeatureId.get(sketchFeatureId);
  if (!referencedSketch || referencedSketch.tier !== "parametric" || !solvedSketch) {
    return { kind: "baked", reason: "revolve-profile-unresolved", inputFeatureIds: sketchIds };
  }

  const profiles = resolveOnshapeSketchProfiles({
    profileParameter,
    featureLabel: context.label,
    featureKind: "revolve",
    solvedSketch,
    referencedSketch,
  });
  if (profiles.tier !== "resolved") {
    return { kind: "baked", reason: "revolve-profile-unresolved", inputFeatureIds: sketchIds };
  }

  const axis = translateAxis({ context });
  if (!axis) {
    return { kind: "baked", reason: "revolve-axis-unresolved", inputFeatureIds: sketchIds };
  }

  const extent = translateExtent(context.feature);
  if (!extent) {
    return {
      kind: "baked",
      reason: "revolve-extent-unsupported",
      inputFeatureIds: [...new Set([...sketchIds, axis.sketchFeatureId])],
    };
  }

  const boolean = resolveBoolean({
    feature: context.feature,
    operation,
    priorBodyProducingFeatureIds: context.state.bodyProducingFeatureIds,
  });
  if (!boolean) {
    return {
      kind: "baked",
      reason: "revolve-operation-unsupported",
      inputFeatureIds: [...new Set([...sketchIds, axis.sketchFeatureId])],
    };
  }

  const inputFeatureIds = [...new Set([
    ...sketchIds,
    axis.sketchFeatureId,
    ...(boolean.kind === "deferredBody" ? [boolean.sourceFeatureId] : []),
  ])];
  return {
    kind: "planned",
    revolve: {
      sketchFeatureId,
      profiles: profiles.profiles,
      axis,
      startAngle: createLiteralAuthoredValue(0),
      extent,
      operation: createLiteralAuthoredValue(operation),
      boolean,
    },
    inputFeatureIds,
  };
}

function featureDependencies(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
  featureIds: readonly string[],
): FeatureDependencyInput[] {
  return featureIds.map((featureId) => ({
    kind: context.state.bodyProducingFeatureIds.includes(featureId)
      ? "body" as const
      : "sketch" as const,
    featureId,
  }));
}

function baked(
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
  reason:
    | RevolveFailureReason
    | "sweep-path-unresolved"
    | LoftFailureReason,
  inputFeatureIds: string[] = [],
) {
  const inputDependencies = featureDependencies(context, inputFeatureIds);
  return {
    onshapeFeatureId: context.feature.featureId,
    featureType: context.feature.featureType,
    label: context.label,
    tier: "baked" as const,
    target: { kind: "bakedBody" as const },
    reasonCodes: [reason],
    suppressed: true,
    inputDependencies,
    inputFeatureIds: dependencyFeatureIds(inputDependencies),
  };
}

export const revolveFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["revolve"],
  plan: (context) => {
    const result = planRevolve(context);
    if (result.kind === "baked") {
      if ((enumValue(context.feature, "operationType") ?? "NEW") === "NEW") {
        context.state.bodyProducingFeatureIds.push(context.feature.featureId);
      }
      return baked(context, result.reason, result.inputFeatureIds);
    }

    if (result.revolve.boolean.kind === "standalone") {
      context.state.bodyProducingFeatureIds.push(context.feature.featureId);
    }
    return {
      onshapeFeatureId: context.feature.featureId,
      featureType: context.feature.featureType,
      label: context.label,
      tier: "parametric",
      target: { kind: "feature" },
      reasonCodes: [],
      suppressed: context.onshapeSuppressed,
      plannedRevolve: result.revolve,
      inputDependencies: featureDependencies(context, result.inputFeatureIds),
      inputFeatureIds: result.inputFeatureIds,
    };
  },
  apply: ({ apply }) => apply(),
};


export const sweepFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["sweep"],
  plan: (context) => {
    const sweep = planSweep(context);
    if (!sweep) {
      if ((enumValue(context.feature, "operationType") ?? "NEW") === "NEW") {
        context.state.bodyProducingFeatureIds.push(context.feature.featureId);
      }
      return baked(context, "sweep-path-unresolved");
    }

    const inputFeatureIds = [sweep.sketchFeatureId, sweep.path.sketchFeatureId];
    context.state.bodyProducingFeatureIds.push(context.feature.featureId);
    return {
      onshapeFeatureId: context.feature.featureId,
      featureType: context.feature.featureType,
      label: context.label,
      tier: "parametric",
      target: { kind: "feature" },
      reasonCodes: [],
      suppressed: context.onshapeSuppressed,
      plannedSweep: sweep,
      inputDependencies: featureDependencies(context, inputFeatureIds),
      inputFeatureIds,
    };
  },
  apply: ({ apply }) => apply(),
};

export const loftFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["loft"],
  plan: (context) => {
    const result = planLoft(context);
    if (result.kind === "baked") {
      if ((enumValue(context.feature, "operationType") ?? "NEW") === "NEW") {
        context.state.bodyProducingFeatureIds.push(context.feature.featureId);
      }
      return baked(context, result.reason, result.inputFeatureIds);
    }

    context.state.bodyProducingFeatureIds.push(context.feature.featureId);
    return {
      onshapeFeatureId: context.feature.featureId,
      featureType: context.feature.featureType,
      label: context.label,
      tier: "parametric",
      target: { kind: "feature" },
      reasonCodes: [],
      suppressed: context.onshapeSuppressed,
      plannedLoft: result.loft,
      inputDependencies: featureDependencies(context, result.inputFeatureIds),
      inputFeatureIds: result.inputFeatureIds,
    };
  },
  apply: ({ apply }) => apply(),
};
