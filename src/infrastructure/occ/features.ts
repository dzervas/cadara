import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { FeatureId } from "@/contracts/shared/ids";

import type {
  OccFeatureExecutionContext,
  OccFeatureExecutionResult,
} from "@/infrastructure/occ/features/shared";
import { executeExtrudeFeature } from "@/infrastructure/occ/features/extrude";
import { executeRevolveFeature } from "@/infrastructure/occ/features/revolve";
import { executeSweepFeature } from "@/infrastructure/occ/features/sweep";
import { executeLoftFeature } from "@/infrastructure/occ/features/loft";
import {
  executeFilletFeature,
  executeChamferFeature,
} from "@/infrastructure/occ/features/fillet-chamfer";
import { executeThickenFeature } from "@/infrastructure/occ/features/thicken";
import {
  executeCombineFeature,
  executeSplitFeature,
  executeDeleteSolidFeature,
} from "@/infrastructure/occ/features/combine-split-delete";
import {
  executeMirrorFeature,
  executeTransformFeature,
} from "@/infrastructure/occ/features/mirror-transform";
import { executeShellFeature } from "@/infrastructure/occ/features/shell";
import { executePlaneFeature } from "@/infrastructure/occ/features/plane";
import { executeBakedBodyFeature } from "@/infrastructure/occ/features/baked-body";
import { executeHoleFeature } from "@/infrastructure/occ/features/hole";
import { executeFeatureReplayFeature } from "@/infrastructure/occ/features/feature-replay";
import {
  executeCircularPatternFeature,
  executeLinearPatternFeature,
} from "@/infrastructure/occ/features/pattern";

// Re-export public API
export type {
  OccFeatureExecutionContext,
  OccFeatureExecutionResult,
  OccFeaturePresentationArtifacts,
} from "@/infrastructure/occ/features/shared";

export {
  createConstructionPresentationArtifacts,
  createEmptyOccRenderExport,
} from "@/infrastructure/occ/features/plane";

export function executeOccFeature(
  context: OccFeatureExecutionContext,
  ownerFeatureId: FeatureId,
  definition: FeatureDefinition,
): OccFeatureExecutionResult {
  switch (definition.kind) {
    case "plane":
      return executePlaneFeature(
        context,
        ownerFeatureId,
        definition.parameters,
      );
    case "extrude":
      return executeExtrudeFeature(
        context,
        ownerFeatureId,
        definition.parameters,
      );
    case "revolve":
      return executeRevolveFeature(
        context,
        ownerFeatureId,
        definition.parameters,
      );
    case "fillet":
      return executeFilletFeature(
        context,
        ownerFeatureId,
        definition.parameters,
      );
    case "shell":
      return executeShellFeature(
        context,
        ownerFeatureId,
        definition.parameters,
      );
    case "bakedBody":
      return executeBakedBodyFeature(
        context,
        ownerFeatureId,
        definition.parameters,
      );
    case "featureReplay":
      return executeFeatureReplayFeature(
        context,
        ownerFeatureId,
        definition.parameters,
      );
    case "sweep":
      return executeSweepFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "sweep" },
      );
    case "loft":
      return executeLoftFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "loft" },
      );
    case "chamfer":
      return executeChamferFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "chamfer" },
      );
    case "thicken":
      return executeThickenFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "thicken" },
      );
    case "hole":
      return executeHoleFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "hole" },
      );
    case "combine":
      return executeCombineFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "combine" },
      );
    case "split":
      return executeSplitFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "split" },
      );
    case "deleteSolid":
      return executeDeleteSolidFeature(
        context,
        definition as AdvancedSolidFeatureDefinition & { kind: "deleteSolid" },
      );
    case "mirror":
      return executeMirrorFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "mirror" },
      );
    case "transform":
      return executeTransformFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "transform" },
      );
    case "linearPattern":
      return executeLinearPatternFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "linearPattern" },
      );
    case "circularPattern":
      return executeCircularPatternFeature(
        context,
        ownerFeatureId,
        definition as AdvancedSolidFeatureDefinition & { kind: "circularPattern" },
      );
    default:
      throw new Error(
        `advanced-feature-unsupported-kernel-case: OCC adapter does not implement ${definition.kind} yet.`,
      );
  }
}
