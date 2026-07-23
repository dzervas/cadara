import { planExtrudeFeature } from "@/domain/import/onshape/extrude-planner";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";
import {
  dependencyFeatureIds,
  type FeatureDependencyInput,
  type OnshapeFeatureTranslator,
} from "@/domain/import/onshape/feature-translator-registry";
import { readRollbackTopologySnapshot } from "@/domain/import/onshape/rollback-topology-reader";

function inferredDefaultScopeFeatureIds(
  feature: OnshapeFeatureNode,
  context: Parameters<OnshapeFeatureTranslator["plan"]>[0],
): string[] {
  if (isNewBodyExtrude(feature) || hasScopeQueries(feature)) return [];
  const snapshots = context.read.studio.rollbackSnapshots;
  if (!snapshots) return [];
  const featureIndex = context.read.features.findIndex(
    (candidate) => candidate.featureId === feature.featureId,
  );
  if (featureIndex < 0) return [];
  const parsed = new Map(
    snapshots.map((snapshot) => [
      snapshot.featureId,
      readRollbackTopologySnapshot(snapshot),
    ]),
  );
  const after = parsed.get(feature.featureId);
  if (!after) return [];
  let before: ReturnType<typeof readRollbackTopologySnapshot> | undefined;
  for (let index = featureIndex - 1; index >= 0; index -= 1) {
    before = parsed.get(context.read.features[index]!.featureId);
    if (before) break;
  }
  if (!before) return [];

  const changedBodyIds = before.bodies.flatMap((body) => {
    const next = after.bodies.find((candidate) => candidate.id === body.id);
    return next && JSON.stringify(next) !== JSON.stringify(body) ? [body.id] : [];
  });
  if (changedBodyIds.length !== 1) return [];

  const bodyId = changedBodyIds[0]!;
  for (let index = 0; index < featureIndex; index += 1) {
    const producerId = context.read.features[index]!.featureId;
    if (
      parsed.get(producerId)?.bodies.some((body) => body.id === bodyId) &&
      context.state.bodyProducingFeatureIds.includes(producerId)
    ) {
      return [producerId];
    }
  }
  return [];
}

export const extrudeFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["extrude"],
  plan: (context) => {
    const { feature, label, onshapeSuppressed, read, state } = context;
    const inputDependencies: FeatureDependencyInput[] = [];
    const extrudePlan = planExtrudeFeature({
      feature,
      profileEvidence: read.studio.profileEvidence ?? [],
      solvedSketchesByFeatureId: read.solvedSketchesByFeatureId,
      referencedSketchesByFeatureId: state.sketchPlansByFeatureId,
      priorBodyProducingFeatureIds: state.bodyProducingFeatureIds,
      inferredDefaultScopeFeatureIds: inferredDefaultScopeFeatureIds(
        feature,
        context,
      ),
    });

    if (extrudePlan.tier !== "baked") {
      for (const profile of extrudePlan.plannedExtrude.profiles) {
        if (profile.kind === "sketchRegion") {
          inputDependencies.push({ kind: "sketch", featureId: profile.sketchFeatureId });
        }
      }
    }

    if (extrudePlan.tier === "parametric") {
      if (extrudePlan.plannedExtrude.boolean.kind === "deferredBody") {
        inputDependencies.push({
          kind: "body",
          featureId: extrudePlan.plannedExtrude.boolean.sourceFeatureId,
        });
      }
      if (extrudePlan.plannedExtrude.boolean.kind === "standalone") {
        state.bodyProducingFeatureIds.push(feature.featureId);
      }
      return {
        onshapeFeatureId: feature.featureId,
        featureType: feature.featureType,
        label,
        tier: "parametric",
        target: { kind: "feature" },
        reasonCodes: [],
        suppressed: onshapeSuppressed,
        plannedExtrude: extrudePlan.plannedExtrude,
        inputDependencies,
        inputFeatureIds: dependencyFeatureIds(inputDependencies),
      };
    }

    if (extrudePlan.tier === "topology") {
      if (isSolidNewBodyExtrude(feature)) state.bodyProducingFeatureIds.push(feature.featureId);
      return {
        onshapeFeatureId: feature.featureId,
        featureType: feature.featureType,
        label,
        tier: "baked",
        target: { kind: "bakedBody" },
        reasonCodes: ["needs-history-probe"],
        suppressed: true,
        plannedExtrude: extrudePlan.plannedExtrude,
        inputDependencies,
        inputFeatureIds: dependencyFeatureIds(inputDependencies),
      };
    }

    const reason =
      extrudePlan.tier === "baked"
        ? extrudePlan.reason
        : "needs-region-resolution";
    if (isSolidNewBodyExtrude(feature)) {
      state.bodyProducingFeatureIds.push(feature.featureId);
    }
    return {
      onshapeFeatureId: feature.featureId,
      featureType: feature.featureType,
      label,
      tier: "baked",
      target: { kind: "bakedBody" },
      reasonCodes: [reason],
      suppressed: true,
      inputDependencies,
      inputFeatureIds: dependencyFeatureIds(inputDependencies),
    };
  },
  apply: ({ apply }) => apply(),
};

function parameter(feature: OnshapeFeatureNode, parameterId: string) {
  return feature.parameters?.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { parameterId?: unknown }).parameterId === parameterId,
  ) as { value?: unknown; queries?: unknown } | undefined;
}

function hasScopeQueries(feature: OnshapeFeatureNode): boolean {
  const queries = parameter(feature, "booleanScope")?.queries;
  return Array.isArray(queries) && queries.length > 0;
}

function isNewBodyExtrude(feature: OnshapeFeatureNode): boolean {
  const operationType = parameter(feature, "operationType");
  return operationType?.value === undefined || operationType.value === "NEW";
}

function isSolidNewBodyExtrude(feature: OnshapeFeatureNode): boolean {
  const bodyType = parameter(feature, "bodyType");
  return (bodyType?.value === undefined || bodyType.value === "SOLID") && isNewBodyExtrude(feature);
}
