import { interpretResolvedReference } from "@/domain/import/onshape/signature-interpreter";
import { extractSketchPlaneDeterministicId } from "@/domain/import/onshape/fidelity-planner";
import type { OnshapeFeatureTranslator } from "@/domain/import/onshape/feature-translator-registry";

function hasSketchPlaneQuery(feature: Parameters<OnshapeFeatureTranslator["plan"]>[0]["feature"]): boolean {
  return (feature.parameters ?? []).some((parameter) => {
    if (
      typeof parameter !== "object" ||
      parameter === null ||
      (parameter as { parameterId?: unknown }).parameterId !== "sketchPlane"
    ) {
      return false;
    }
    const queries = (parameter as { queries?: unknown }).queries;
    return Array.isArray(queries) && queries.length > 0;
  });
}

function sketchPlaneQueryStrings(
  feature: Parameters<OnshapeFeatureTranslator["plan"]>[0]["feature"],
): string[] {
  return (feature.parameters ?? []).flatMap((parameter) => {
    if (
      typeof parameter !== "object" ||
      parameter === null ||
      (parameter as { parameterId?: unknown }).parameterId !== "sketchPlane"
    ) {
      return [];
    }
    const queries = (parameter as { queries?: unknown }).queries;
    if (!Array.isArray(queries)) return [];
    return queries.flatMap((query) => {
      const queryString = (query as { queryString?: unknown }).queryString;
      return typeof queryString === "string" ? [queryString] : [];
    });
  });
}

function hasPlaneOperation(queryString: string, operationId: "Top" | "Right" | "Front"): boolean {
  return queryString.includes(`${operationId}planeOp`) ||
    queryString.includes(`$${operationId}planeOp`) ||
    new RegExp(`id\\s*\\+\\s*"${operationId}"\\s*\\+\\s*"planeOp"`).test(queryString);
}

function defaultDatumPlaneFromSketchPlaneQuery(
  feature: Parameters<OnshapeFeatureTranslator["plan"]>[0]["feature"],
) {
  for (const queryString of sketchPlaneQueryStrings(feature)) {
    if (hasPlaneOperation(queryString, "Top")) return "xy" as const;
    if (hasPlaneOperation(queryString, "Right")) return "yz" as const;
    if (hasPlaneOperation(queryString, "Front")) return "xz" as const;
  }
  return null;
}

function isDatumOrConstructionPlaneQuery(queryString: string): boolean {
  return hasPlaneOperation(queryString, "Top") ||
    hasPlaneOperation(queryString, "Right") ||
    hasPlaneOperation(queryString, "Front") ||
    queryString.includes("planeOp");
}

function hasExplicitFaceBackedSketchPlaneQuery(
  feature: Parameters<OnshapeFeatureTranslator["plan"]>[0]["feature"],
): boolean {
  return sketchPlaneQueryStrings(feature).some((queryString) =>
    !isDatumOrConstructionPlaneQuery(queryString) &&
    (
      queryString.includes("EntityType.FACE") ||
      queryString.includes("$FACE") ||
      /\b[A-Z0-9_]*FACE[A-Z0-9_]*\b/.test(queryString)
    )
  );
}
export const sketchFeatureTranslator: OnshapeFeatureTranslator = {
  featureTypes: ["newSketch"],
  plan: ({ feature, onshapeSuppressed, read, references, state }) => {
    const planeId = extractSketchPlaneDeterministicId(feature);
    const planeHasQuery = hasSketchPlaneQuery(feature);
    const records = planeId ? references.get(planeId) ?? [] : [];
    const reference = records.find(
      (record) =>
        record.evaluatedAt === "historyPoint" && record.consumingFeatureId === feature.featureId,
    ) ?? records.find((record) => record.evaluatedAt === "finalState");
    const resolution = reference ? interpretResolvedReference(reference) : null;
    const defaultDatumPlane = defaultDatumPlaneFromSketchPlaneQuery(feature);
    const hasExplicitFaceBackedQuery = hasExplicitFaceBackedSketchPlaneQuery(feature);
    const capturedFrame = read.solvedSketchesByFeatureId.get(feature.featureId)?.sketchFrame;
    const sketch =
      resolution?.kind === "canonicalPlane"
        ? { planeKey: resolution.planeKey, reasonCode: "sketch-on-canonical-plane" as const }
        : defaultDatumPlane
          ? { planeKey: defaultDatumPlane, reasonCode: "sketch-on-canonical-plane" as const }
          : capturedFrame && planeHasQuery && planeId === null && hasExplicitFaceBackedQuery
            ? {
                planeKey: "xy" as const,
                capturedFrame,
                reasonCode: "sketch-on-captured-frame" as const,
              }
            : !planeHasQuery
              ? { planeKey: "xy" as const, reasonCode: "sketch-on-canonical-plane" as const }
              : null;

    if (!sketch) {
      return {
        onshapeFeatureId: feature.featureId,
        featureType: feature.featureType,
        label: feature.name ?? feature.featureId,
        tier: "baked",
        target: { kind: "suppressed" },
        reasonCodes: ["needs-history-probe"],
        suppressed: true,
        inputDependencies: planeHasQuery
          ? [{ kind: "query" as const, parameterId: "sketchPlane" }]
          : [],
        inputFeatureIds: [],
      };
    }

    state.sketchPlansByFeatureId.set(feature.featureId, {
      tier: "parametric",
      planeKey: sketch.planeKey,
      ...("capturedFrame" in sketch ? { planeFrame: sketch.capturedFrame } : {}),
    });
    return {
      onshapeFeatureId: feature.featureId,
      featureType: feature.featureType,
      label: feature.name ?? feature.featureId,
      tier: "parametric",
      target: {
        kind: "sketch",
        planeKey: sketch.planeKey,
        ...("capturedFrame" in sketch ? { capturedFrame: sketch.capturedFrame } : {}),
      },
      reasonCodes: [sketch.reasonCode],
      suppressed: onshapeSuppressed,
      inputDependencies: sketch.reasonCode === "sketch-on-captured-frame"
        ? []
        : planeHasQuery
          ? [{ kind: "query" as const, parameterId: "sketchPlane" }]
          : [],
      inputFeatureIds: [],
    };
  },
  apply: ({ apply }) => apply(),
};
