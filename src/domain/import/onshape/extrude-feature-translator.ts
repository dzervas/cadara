import {
  hasCurrentOnshapeProfileEvidence,
  type OnshapeProfileEvidence,
} from "@/contracts/import/onshape-capture-bundle";
import {
  extrudeSketchPointExtentFeatureIds,
  planExtrudeFeature,
} from "@/domain/import/onshape/extrude-planner";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";
import {
  dependencyFeatureIds,
  type FeatureDependencyInput,
  type OnshapeFeatureTranslator,
} from "@/domain/import/onshape/feature-translator-registry";
import { readRollbackTopologySnapshot } from "@/domain/import/onshape/rollback-topology-reader";

function currentProfileEvidence(
  feature: OnshapeFeatureNode,
  studio: Parameters<OnshapeFeatureTranslator["plan"]>[0]["read"]["studio"],
): readonly OnshapeProfileEvidence[] {
  const profileParameter = feature.parameters?.find(
    (parameter) =>
      parameter !== null &&
      typeof parameter === "object" &&
      (parameter as { parameterId?: unknown }).parameterId === "entities",
  ) as { queries?: unknown } | undefined;
  const queries = profileParameter?.queries;
  if (!Array.isArray(queries)) return [];
  const complete = queries.every((query, queryIndex) => hasCurrentOnshapeProfileEvidence({
    schemaVersion: studio.profileEvidenceSchemaVersion,
    manifest: studio.profileEvidenceManifest,
    evidence: studio.profileEvidence,
    consumingFeatureId: feature.featureId,
    queryIndex,
    sourceQueryString:
      query !== null && typeof query === "object" &&
      typeof (query as { queryString?: unknown }).queryString === "string"
        ? (query as { queryString: string }).queryString
        : null,
  }));
  return complete ? studio.profileEvidence ?? [] : [];
}

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
      profileEvidence: currentProfileEvidence(feature, read.studio),
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
        if (profile.kind === "sketchRegion" || profile.kind === "sketchCurve") {
          inputDependencies.push({ kind: "sketch", featureId: profile.sketchFeatureId });
        }
      }
      // A sketch-point up-to-vertex extent depends on its terminator's sketch
      // exactly as strongly as on a profile sketch.
      for (const sketchFeatureId of extrudeSketchPointExtentFeatureIds(
        extrudePlan.plannedExtrude,
      )) {
        inputDependencies.push({ kind: "sketch", featureId: sketchFeatureId });
      }
    }

    if (extrudePlan.tier === "parametric") {
      const planned = extrudePlan.plannedExtrude;
      // A surface extrude creates a sheet body, so it never seeds the solid body
      // lineage default boolean scope is inferred from.
      if (planned.resultBodyType === "solid") {
        if (planned.boolean.kind === "deferredBody") {
          inputDependencies.push({
            kind: "body",
            featureId: planned.boolean.sourceFeatureId,
          });
        }
        if (planned.boolean.kind === "standalone") {
          state.bodyProducingFeatureIds.push(feature.featureId);
        }
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
