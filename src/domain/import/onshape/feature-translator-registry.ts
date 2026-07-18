import type { OnshapeResolvedReference } from "@/contracts/import/onshape-capture-bundle";
import type { SketchPlaneFrame, SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import type { OnshapeFeatureNode, StudioReadResult } from "@/domain/import/onshape/bundle-reader";
import type { FeaturePlan, FidelityTier, PlanReasonCode } from "@/domain/import/onshape/fidelity-planner";

export interface FidelityPlanningState {
  sketchPlansByFeatureId: Map<string, { tier: FidelityTier; planeKey: SketchPlaneKey; planeFrame?: SketchPlaneFrame }>;
  bodyProducingFeatureIds: string[];
}

export type FeatureDependencyInput =
  | { kind: "sketch"; featureId: string }
  | { kind: "body"; featureId: string }
  | { kind: "query"; parameterId: string; slotKey?: string };

export function dependencyFeatureIds(
  inputs: readonly FeatureDependencyInput[],
): string[] {
  return [...new Set(inputs.flatMap((input) =>
    input.kind === "query" ? [] : [input.featureId]
  ))];
}

export interface FeaturePlanningContext {
  feature: OnshapeFeatureNode;
  label: string;
  onshapeSuppressed: boolean;
  read: StudioReadResult;
  references: ReadonlyMap<string, readonly OnshapeResolvedReference[]>;
  state: FidelityPlanningState;
}

export interface FeatureApplicationContext {
  featurePlan: FeaturePlan;
  apply: () => Promise<void>;
}

export interface OnshapeFeatureTranslator {
  featureTypes: readonly string[];
  plan(context: FeaturePlanningContext): FeaturePlan;
  apply?(context: FeatureApplicationContext): Promise<void>;
}

export interface OnshapeFeatureTranslatorRegistry {
  forFeatureType(featureType: string): OnshapeFeatureTranslator;
}

export function createOnshapeFeatureTranslatorRegistry(input: {
  translators: readonly OnshapeFeatureTranslator[];
  fallback: OnshapeFeatureTranslator;
}): OnshapeFeatureTranslatorRegistry {
  const translatorsByFeatureType = new Map<string, OnshapeFeatureTranslator>();
  for (const translator of input.translators) {
    for (const featureType of translator.featureTypes) {
      translatorsByFeatureType.set(featureType, translator);
    }
  }
  return {
    forFeatureType: (featureType) => translatorsByFeatureType.get(featureType) ?? input.fallback,
  };
}

export type { PlanReasonCode };
