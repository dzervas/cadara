/**
 * Extrude translation + review-time region verification.
 *
 * Keeps extrude extent and boolean-lineage concerns local while delegating
 * reusable sketch-profile resolution to `profile-resolver.ts`.
 */
import type {
  ExtrudeFeatureExtent,
  FeatureBooleanOperation,
} from "@/contracts/modeling/schema";
import type { AuthoredValue } from "@/contracts/modeling/authored-values";
import type { SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import type {
  OnshapeFeatureNode,
  OnshapeSolvedSketch,
} from "@/domain/import/onshape/bundle-reader";
import {
  referencedSketchFeatureIdsFromProfileParameter,
  resolveOnshapeSketchProfiles,
  type DeferredSketchProfile,
  type ProfileResolutionDiagnostic,
} from "@/domain/import/onshape/profile-resolver";
import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";

export type PlannedExtrudeProfile = DeferredSketchProfile;

export type PlannedExtrudeBoolean =
  | { kind: "standalone" }
  | { kind: "deferredBody"; sourceFeatureId: string };

export interface PlannedExtrude {
  /** Onshape feature id of the sketch whose regions this extrude consumes. */
  sketchFeatureId: string;
  /** One deferred profile per consumed solid region. */
  profiles: PlannedExtrudeProfile[];
  extent: ExtrudeFeatureExtent;
  operation: AuthoredValue<FeatureBooleanOperation>;
  boolean: PlannedExtrudeBoolean;
}

export type ExtrudePlanDiagnostic = ProfileResolutionDiagnostic;

export type ExtrudePlanResult =
  | { tier: "parametric"; plannedExtrude: PlannedExtrude; diagnostics: ExtrudePlanDiagnostic[] }
  | {
      tier: "baked";
      reason:
        | "needs-region-resolution"
        | "needs-history-probe"
        | "unsupported-feature";
      diagnostics: ExtrudePlanDiagnostic[];
    };

export interface ExtrudePlanInput {
  feature: OnshapeFeatureNode;
  /** Solved sketch keyed by the extrude's referenced sketch feature id. */
  solvedSketch: OnshapeSolvedSketch | undefined;
  /** Plane and tier of the referenced sketch, as planned earlier in history. */
  referencedSketch: { tier: string; planeKey: SketchPlaneKey } | undefined;
  /** Onshape feature ids of prior parametric NEW-body extrudes, in order. */
  priorBodyProducingFeatureIds: readonly string[];
}

function findParameter(
  feature: OnshapeFeatureNode,
  parameterId: string,
): Record<string, unknown> | null {
  for (const parameter of feature.parameters ?? []) {
    if (
      typeof parameter === "object" &&
      parameter !== null &&
      (parameter as { parameterId?: unknown }).parameterId === parameterId
    ) {
      return parameter as Record<string, unknown>;
    }
  }
  return null;
}

function enumValue(feature: OnshapeFeatureNode, parameterId: string): string | null {
  const parameter = findParameter(feature, parameterId);
  const value = parameter?.value;
  return typeof value === "string" ? value : null;
}

function booleanValue(feature: OnshapeFeatureNode, parameterId: string): boolean {
  return findParameter(feature, parameterId)?.value === true;
}

function quantityExpression(
  feature: OnshapeFeatureNode,
  parameterId: string,
): string | null {
  const parameter = findParameter(feature, parameterId);
  const expression = parameter?.expression;
  return typeof expression === "string" ? expression : null;
}

function hasQueries(feature: OnshapeFeatureNode, parameterId: string): boolean {
  const parameter = findParameter(feature, parameterId);
  const queries = parameter?.queries;
  return Array.isArray(queries) && queries.length > 0;
}

/** Parse the distinct sketch feature ids referenced by the extrude `entities`. */
export function referencedSketchFeatureIds(feature: OnshapeFeatureNode): string[] {
  return referencedSketchFeatureIdsFromProfileParameter(findParameter(feature, "entities"));
}

const BARE_NUMBER = /^-?\d+(?:\.\d+)?$/;

function authoredDistance(
  expression: string | null,
  diagnostics: ExtrudePlanDiagnostic[],
): AuthoredValue<number> {
  const translated = translateOnshapeExpression({ expression });
  if (translated.diagnostic) {
    diagnostics.push({
      code: translated.diagnostic.code,
      message: translated.diagnostic.message,
    });
  }
  // Extrude distances are strictly positive; direction is carried separately.
  if (BARE_NUMBER.test(translated.valueText)) {
    return { source: "literal", value: Math.abs(Number(translated.valueText)) };
  }
  return { source: "expression", valueText: translated.valueText };
}

function translateExtent(
  feature: OnshapeFeatureNode,
  diagnostics: ExtrudePlanDiagnostic[],
): ExtrudeFeatureExtent | null {
  const endBound = enumValue(feature, "endBound") ?? "BLIND";
  const direction = booleanValue(feature, "oppositeDirection")
    ? "negative"
    : "positive";
  const draftAngle = undefined;

  switch (endBound) {
    case "BLIND": {
      return {
        mode: "oneSide",
        end: {
          kind: "blind",
          direction,
          distance: authoredDistance(
            quantityExpression(feature, "depth"),
            diagnostics,
          ),
          draftAngle,
        },
      };
    }
    case "SYMMETRIC": {
      return {
        mode: "symmetric",
        end: {
          kind: "blind",
          direction,
          distance: authoredDistance(
            quantityExpression(feature, "depth"),
            diagnostics,
          ),
          draftAngle,
        },
      };
    }
    case "THROUGH_ALL": {
      return {
        mode: "oneSide",
        end: { kind: "throughAll", direction, draftAngle },
      };
    }
    default:
      // UP_TO_* extents reference downstream topology; probe-gated in v1.
      return null;
}
}

const OPERATION_MAP: Record<string, FeatureBooleanOperation> = {
  NEW: "newBody",
  ADD: "join",
  REMOVE: "cut",
  INTERSECT: "intersect",
};

export function planExtrudeFeature(input: ExtrudePlanInput): ExtrudePlanResult {
  const diagnostics: ExtrudePlanDiagnostic[] = [];
  const { feature } = input;
  const sketchIds = referencedSketchFeatureIds(feature);
  if (
    sketchIds.length !== 1 ||
    !input.referencedSketch ||
    input.referencedSketch.tier !== "parametric" ||
    !input.solvedSketch
  ) {
    return { tier: "baked", reason: "needs-region-resolution", diagnostics };
  }

  const extent = translateExtent(feature, diagnostics);
  if (!extent) {
    return { tier: "baked", reason: "unsupported-feature", diagnostics };
  }

  const profileResolution = resolveOnshapeSketchProfiles({
    profileParameter: findParameter(feature, "entities"),
    featureLabel: feature.name ?? feature.featureId,
    featureKind: "extrude",
    solvedSketch: input.solvedSketch,
    referencedSketch: input.referencedSketch,
  });
  diagnostics.push(...profileResolution.diagnostics);
  if (profileResolution.tier === "unresolved") {
    return { tier: "baked", reason: profileResolution.reason, diagnostics };
  }

  // Boolean scope mapping (task 3.4).
  const operationType = enumValue(feature, "operationType") ?? "NEW";
  const operation = OPERATION_MAP[operationType];
  if (!operation) {
    return { tier: "baked", reason: "unsupported-feature", diagnostics };
  }

  let boolean: PlannedExtrudeBoolean;
  if (operation === "newBody") {
    boolean = { kind: "standalone" };
  } else if (hasQueries(feature, "booleanScope")) {
    // Explicit Onshape scope queries need the sandboxed history probe.
    return { tier: "baked", reason: "needs-history-probe", diagnostics };
  } else if (input.priorBodyProducingFeatureIds.length === 1) {
    boolean = {
      kind: "deferredBody",
      sourceFeatureId: input.priorBodyProducingFeatureIds[0]!,
    };
  } else {
    // Zero or multiple upstream bodies: lineage is ambiguous; probe-gated.
    return { tier: "baked", reason: "needs-history-probe", diagnostics };
  }

  return {
    tier: "parametric",
    plannedExtrude: {
      sketchFeatureId: profileResolution.sketchFeatureId,
      profiles: profileResolution.profiles,
      extent,
      operation: { source: "literal", value: operation },
      boolean,
    },
    diagnostics,
  };
}
