import type { BodyId, FeatureId, SketchId } from "@/contracts/shared/ids";
import type {
  ModelingDiagnostic,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import { SKETCH_SUPPORT_UNRESOLVED_CODE } from "@/contracts/sketch/derived-validity";

export type FeatureScopedModelingDiagnostic = ModelingDiagnostic & {
  featureId: FeatureId;
};

export function isFeatureScopedModelingDiagnostic(
  diagnostic: ModelingDiagnostic,
): diagnostic is FeatureScopedModelingDiagnostic {
  return diagnostic.featureId !== undefined && diagnostic.featureId !== null;
}

export type SketchScopedModelingDiagnostic = ModelingDiagnostic & {
  target: { kind: "sketch"; sketchId: SketchId };
};

/** A diagnostic on a sketch as a whole, which no feature owns. */
export function isSketchScopedModelingDiagnostic(
  diagnostic: ModelingDiagnostic,
): diagnostic is SketchScopedModelingDiagnostic {
  return (
    !isFeatureScopedModelingDiagnostic(diagnostic) &&
    diagnostic.target?.kind === "sketch"
  );
}

/**
 * One document diagnostic on each face sketch whose support no longer
 * resolves (its record carries the solve diagnostic), naming the body by its
 * current label and the repair.
 */
export function createUnresolvedSketchSupportModelingDiagnostics(
  sketches: readonly Pick<
    SketchSnapshotRecord,
    "sketchId" | "label" | "plane" | "sketch"
  >[],
  bodyLabel: (bodyId: BodyId) => string,
): ModelingDiagnostic[] {
  return sketches.flatMap((sketch) => {
    const support = sketch.plane.support;
    const unresolved = sketch.sketch.solvedSnapshot.diagnostics.find(
      (diagnostic) => diagnostic.code === SKETCH_SUPPORT_UNRESOLVED_CODE,
    );
    if (!unresolved || support.kind !== "face") return [];
    return [
      {
        code: SKETCH_SUPPORT_UNRESOLVED_CODE,
        severity: unresolved.severity,
        message: `${sketch.label} placement is invalid: its supporting face no longer exists on ${bodyLabel(support.bodyId)}.`,
        repairGuidance: `Use Change Sketch Plane on ${sketch.label} to place it on an existing face or plane.`,
        target: { kind: "sketch", sketchId: sketch.sketchId },
        detail: null,
      },
    ];
  });
}

export function getModelingDiagnosticRepairMessage(
  diagnostic: ModelingDiagnostic,
) {
  return diagnostic.repairGuidance ?? diagnostic.message;
}
