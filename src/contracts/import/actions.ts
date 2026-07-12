import type {
  AddDocumentVariableRequest,
  CommitSketchRequest,
  CreateFeatureRequest,
  ExtrudeFeatureParameters,
  ExtrudeProfileRef,
  FeatureBooleanScope,
  FeatureDefinition,
  } from "@/contracts/modeling/schema";
  import type { BodyId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import type { ImportBinding } from "@/contracts/import/binding";
import type { ImportDiagnostic } from "@/contracts/import/diagnostics";

export type ImportPreparedActionKind =
  | "createFeature"
  | "commitSketch"
  | "addDocumentVariable";

/**
 * References a single prepared action by its kind and index into the matching
 * kind array (`createFeatures`, `commitSketches`, `addDocumentVariables`).
 */
export interface ImportPreparedActionRef {
  kind: ImportPreparedActionKind;
  index: number;
}

export interface ImportDeferredActionOutputRef {
  actionIndex: number;
}

export type ImportDeferredValue =
  | ({ kind: "sketchIdOf" } & ImportDeferredActionOutputRef)
  | ({
      kind: "regionOf";
      selector: {
        kind: "interiorPoint";
        point: SketchPoint2D;
      };
    } & ImportDeferredActionOutputRef)
  | ({ kind: "bodyOf" } & ImportDeferredActionOutputRef);

export type ImportDeferredExtrudeProfileRef =
  | ExtrudeProfileRef
  | Extract<ImportDeferredValue, { kind: "regionOf" }>;

export type ImportDeferredFeatureBooleanScope =
  | FeatureBooleanScope
  | {
      kind: "targetBody";
      bodyId: BodyId | Extract<ImportDeferredValue, { kind: "bodyOf" }>;
    };

export interface ImportDeferredExtrudeFeatureParameters
  extends Omit<ExtrudeFeatureParameters, "profiles" | "booleanScope"> {
  profiles: readonly [
    ImportDeferredExtrudeProfileRef,
    ...ImportDeferredExtrudeProfileRef[],
  ];
  booleanScope: ImportDeferredFeatureBooleanScope;
}

/** Deferred replacement scope for a baked checkpoint emitted inside one import. */
export type ImportDeferredBakedBodyReplacement = {
  kind: "replaceBodyOutputs";
  actionIndexes: readonly number[];
};

export type ImportDeferredBakedBodyFeatureParameters = Omit<
  Extract<FeatureDefinition, { kind: "bakedBody" }>["parameters"],
  "replacement"
> & { replacement: ImportDeferredBakedBodyReplacement };

export type ImportDeferredFeatureDefinition =
  | Exclude<FeatureDefinition, { kind: "extrude" | "bakedBody" }>
  | {
      kind: "extrude";
      featureTypeVersion: Extract<
        FeatureDefinition,
        { kind: "extrude" }
      >["featureTypeVersion"];
      parameters: ImportDeferredExtrudeFeatureParameters;
    }
  | {
      kind: "bakedBody";
      featureTypeVersion: Extract<
        FeatureDefinition,
        { kind: "bakedBody" }
      >["featureTypeVersion"];
      parameters: ImportDeferredBakedBodyFeatureParameters;
    };

export interface ImportCreateFeatureRequest
  extends Omit<CreateFeatureRequest, "definition"> {
  definition: ImportDeferredFeatureDefinition;
}

export const IMPORT_DEFERRED_VALUE_BLESSED_POSITIONS = {
  regionOf: ["createFeatures[].definition.parameters.profiles[]"],
  bodyOf: ["createFeatures[].definition.parameters.booleanScope.bodyId"],
  sketchIdOf: [],
} as const satisfies Record<ImportDeferredValue["kind"], readonly string[]>;

/**
 * The orchestrator applies these through existing adapter methods.
 */
export interface ImportPreparedActions {
  createFeatures?: ImportCreateFeatureRequest[];
  commitSketches?: CommitSketchRequest[];
  addDocumentVariables?: AddDocumentVariableRequest[];
  /**
   * Optional explicit interleaved order across the kind arrays. When present,
   * the orchestrator applies actions in exactly this sequence (single revision
   * chain, atomic failure) instead of the grouped default. The sequence MUST be
   * a permutation referencing every prepared action exactly once.
   */
  orderedActions?: ImportPreparedActionRef[];
  binding?: ImportBinding;
  diagnostics?: ImportDiagnostic[];
}
