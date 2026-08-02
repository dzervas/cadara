import type {
  AddDocumentVariableRequest,
  CommitSketchRequest,
  CreateFeatureRequest,
  ExtrudeEndCondition,
  ExtrudeStartExtent,
  ExtrudeSolidFeatureParameters,
  ExtrudeSurfaceFeatureParameters,
  ExtrudeProfileRef,
  FeatureBooleanScope,
  FeatureDefinition,
  FilletFeatureParameters,
  PlaneFeatureParameters,
  RevolveAxisRef,
  RevolveSolidFeatureParameters,
  ShellFeatureParameters,
} from "@/contracts/modeling/schema";
import type { AdvancedSolidFeatureDefinition } from "@/contracts/modeling/advanced-solid";
import type { FeatureReplayFeatureParameters } from "@/contracts/modeling/feature-replay";
import type { ImportRegionBoundaryIdentity } from "@/contracts/import/region-boundary-identity";
import type { BodyId, FeatureId, SketchId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import type {
  SketchPlaneDefinition,
  SketchPlaneSupportRef,
} from "@/contracts/shared/sketch-plane";
import type { ImportBinding } from "@/contracts/import/binding";
import type { ImportDiagnostic } from "@/contracts/import/diagnostics";
import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";
import type { DurableRef } from "@/contracts/shared/references";

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
        /** Import-only boundary provenance rematched against the committed sketch. */
        expectedBoundaryIdentity?: ImportRegionBoundaryIdentity;
        /** Optional exact Onshape selected-face provenance retained for import diagnostics. */
        source?: {
          consumerFeatureId: string;
          queryIndex: number;
          resultIndex: number;
          deterministicId: string;
        };
      };
    } & ImportDeferredActionOutputRef)
  | ({ kind: "bodyOf" } & ImportDeferredActionOutputRef)
  | ({ kind: "constructionOf" } & ImportDeferredActionOutputRef)
  | ({ kind: "featureOf" } & ImportDeferredActionOutputRef);

/** Selector rematched against live topology immediately before its consumer applies. */
export interface ImportDeferredTopologyRef {
  kind: "topologyOf";
  expectedKind: "body" | "face" | "edge" | "vertex";
  capturedSignature: OnshapeGeometricSignature;
  tolerance: {
    linear: number;
    angularRadians: number;
    relative: number;
    ambiguityMargin: number;
  };
  source: {
    consumerFeatureId: string;
    parameterId: string;
    deterministicId: string;
  };
  /**
   * Live body the rematch must stay inside.
   *
   * Split pieces share a coincident face, so a geometric signature alone names
   * two live faces. Review derives this scope from the captured body that owns
   * the captured entity (exact per-face evidence, see
   * `scopeLiveSignaturesToCapturedBody`) and carries it into apply, where the
   * same prefix reproduces the same deterministic body ids. Absent means no
   * scope was provable and the rematch stays unrestricted.
   */
  bodyScope?: BodyId;
}

export type ImportDeferredSketchEntityRef = Omit<
  Extract<DurableRef, { kind: "sketchEntity" }>,
  "sketchId"
> & {
  sketchId: SketchId | Extract<ImportDeferredValue, { kind: "sketchIdOf" }>;
};

export type ImportDeferredSketchPointRef = Omit<
  Extract<DurableRef, { kind: "sketchPoint" }>,
  "sketchId"
> & {
  sketchId: SketchId | Extract<ImportDeferredValue, { kind: "sketchIdOf" }>;
  pointId: SketchPointId;
};

export type ImportDeferredDurableRef =
  | DurableRef
  | ImportDeferredTopologyRef
  | ImportDeferredSketchEntityRef
  | ImportDeferredSketchPointRef
  | Extract<ImportDeferredValue, { kind: "regionOf" | "bodyOf" | "constructionOf" }>;

export interface ImportDeferredFilletFeatureParameters
  extends Omit<FilletFeatureParameters, "edgeTargets"> {
  edgeTargets: readonly (
    | FilletFeatureParameters["edgeTargets"][number]
    | ImportDeferredTopologyRef
  )[];
}

export interface ImportDeferredShellFeatureParameters
  extends Omit<ShellFeatureParameters, "bodyTarget" | "faceTargets"> {
  bodyTarget: ShellFeatureParameters["bodyTarget"] | ImportDeferredTopologyRef;
  faceTargets: readonly (
    | ShellFeatureParameters["faceTargets"][number]
    | ImportDeferredTopologyRef
  )[];
}

export type ImportDeferredAdvancedSolidFeatureDefinition =
  AdvancedSolidFeatureDefinition extends infer Definition
    ? Definition extends AdvancedSolidFeatureDefinition
      ? Omit<Definition, "parameters"> & {
          parameters: Omit<Definition["parameters"], "participants"> & {
            participants: readonly {
              role: Definition["parameters"]["participants"][number]["role"];
              targets: readonly ImportDeferredDurableRef[];
            }[];
          };
        }
      : never
    : never;

export type ImportDeferredPlaneFeatureParameters =
  | Exclude<PlaneFeatureParameters, { mode: "coplanar" }>
  | {
      mode: "coplanar";
      reference: {
        target:
          | Extract<PlaneFeatureParameters, { mode: "coplanar" }>["reference"]["target"]
          | ImportDeferredTopologyRef;
      };
    };

export type ImportDeferredProfileRef =
  | ExtrudeProfileRef
  | Extract<ImportDeferredValue, { kind: "regionOf" }>
  /** A captured planar profile face rematched against live topology at apply. */
  | ImportDeferredTopologyRef;

/**
 * Profile seeds accepted by a surface extrude. An open sketch curve defers only
 * its sketch id, exactly like the revolve axis: the entity is an exact authored
 * reference, never a live-topology rematch.
 */
export type ImportDeferredSurfaceProfileRef =
  | ImportDeferredProfileRef
  | ImportDeferredSketchEntityRef;

export type ImportDeferredFeatureBooleanScope =
  | Exclude<FeatureBooleanScope, { kind: "targetBody" | "targetBodies" }>
  | {
      kind: "targetBody";
      bodyId:
        | BodyId
        | Extract<ImportDeferredValue, { kind: "bodyOf" }>
        | ImportDeferredTopologyRef;
    }
  | {
      kind: "targetBodies";
      bodyIds: readonly (BodyId | ImportDeferredTopologyRef)[];
    };

type ImportDeferredTopologyRefOf<Kind extends ImportDeferredTopologyRef["expectedKind"]> =
  Omit<ImportDeferredTopologyRef, "expectedKind"> & { expectedKind: Kind };

export type ImportDeferredExtrudeEndCondition =
  | Exclude<
      ExtrudeEndCondition,
      { kind: "upToFace" | "upToPart" | "upToVertex" }
    >
  | (Omit<Extract<ExtrudeEndCondition, { kind: "upToFace" }>, "target"> & {
      target:
        | Extract<ExtrudeEndCondition, { kind: "upToFace" }>["target"]
        | ImportDeferredTopologyRefOf<"face">;
    })
  | (Omit<Extract<ExtrudeEndCondition, { kind: "upToPart" }>, "target"> & {
      target:
        | Extract<ExtrudeEndCondition, { kind: "upToPart" }>["target"]
        | ImportDeferredTopologyRefOf<"body">;
    })
  | (Omit<Extract<ExtrudeEndCondition, { kind: "upToVertex" }>, "target"> & {
      target:
        | Extract<ExtrudeEndCondition, { kind: "upToVertex" }>["target"]
        | ImportDeferredTopologyRefOf<"vertex">
        | ImportDeferredSketchPointRef;
    });

/**
 * A sketch-point start offset defers only its sketch id, exactly like the
 * up-to-vertex sketch-point terminator: the point is an exact authored
 * reference, not a live-topology rematch. An entity start offset defers its
 * durable edge/face through the same apply-time topology rematch every other
 * live-topology selector uses.
 */
export type ImportDeferredExtrudeStartExtent =
  | Exclude<ExtrudeStartExtent, { kind: "sketchPointOffset" | "entityOffset" }>
  | (Omit<Extract<ExtrudeStartExtent, { kind: "sketchPointOffset" }>, "target"> & {
      target:
        | Extract<ExtrudeStartExtent, { kind: "sketchPointOffset" }>["target"]
        | ImportDeferredSketchPointRef;
    })
  | (Omit<Extract<ExtrudeStartExtent, { kind: "entityOffset" }>, "target"> & {
      target:
        | Extract<ExtrudeStartExtent, { kind: "entityOffset" }>["target"]
        | ImportDeferredTopologyRefOf<"edge">
        | ImportDeferredTopologyRefOf<"face">;
    });
export type ImportDeferredExtrudeExtent =
  | { mode: "oneSide"; end: ImportDeferredExtrudeEndCondition }
  | {
      mode: "symmetric";
      end: Extract<ImportDeferredExtrudeEndCondition, { kind: "blind" | "throughAll" }>;
    }
  | {
      mode: "twoSide";
      firstEnd: ImportDeferredExtrudeEndCondition;
      secondEnd: ImportDeferredExtrudeEndCondition;
    };

export interface ImportDeferredExtrudeSolidFeatureParameters
  extends Omit<
    ExtrudeSolidFeatureParameters,
    "profiles" | "booleanScope" | "extent" | "startExtent"
  > {
  profiles: readonly [
    ImportDeferredProfileRef,
    ...ImportDeferredProfileRef[],
  ];
  extent: ImportDeferredExtrudeExtent;
  startExtent: ImportDeferredExtrudeStartExtent;
  booleanScope: ImportDeferredFeatureBooleanScope;
}

/** Surface extrudes carry no boolean state, exactly like the durable contract. */
export interface ImportDeferredExtrudeSurfaceFeatureParameters
  extends Omit<
    ExtrudeSurfaceFeatureParameters,
    "profiles" | "extent" | "startExtent"
  > {
  profiles: readonly [
    ImportDeferredSurfaceProfileRef,
    ...ImportDeferredSurfaceProfileRef[],
  ];
  extent: ImportDeferredExtrudeExtent;
  startExtent: ImportDeferredExtrudeStartExtent;
}

export type ImportDeferredExtrudeFeatureParameters =
  | ImportDeferredExtrudeSolidFeatureParameters
  | ImportDeferredExtrudeSurfaceFeatureParameters;

export type ImportDeferredRevolveAxisRef =
  | Exclude<RevolveAxisRef, { kind: "sketchEntity" }>
  | {
      kind: "sketchEntity";
      sketchId: SketchId | Extract<ImportDeferredValue, { kind: "sketchIdOf" }>;
      entityId: Extract<RevolveAxisRef, { kind: "sketchEntity" }>["entityId"];
    };

export interface ImportDeferredRevolveFeatureParameters
  extends Omit<RevolveSolidFeatureParameters, "profiles" | "axis" | "booleanScope"> {
  profiles: readonly [ImportDeferredProfileRef, ...ImportDeferredProfileRef[]];
  axis: ImportDeferredRevolveAxisRef;
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

export interface ImportDeferredFeatureReplayFeatureParameters
  extends Omit<FeatureReplayFeatureParameters, "sourceFeatureIds"> {
  sourceFeatureIds: readonly (
    | FeatureId
    | Extract<ImportDeferredValue, { kind: "featureOf" }>
  )[];
}

export type ImportDeferredFeatureDefinition =
  | Exclude<
      FeatureDefinition,
      | { kind: "extrude" | "revolve" | "bakedBody" | "fillet" | "shell" | "plane" | "featureReplay" }
      | AdvancedSolidFeatureDefinition
    >
  | {
      kind: "extrude";
      featureTypeVersion: Extract<FeatureDefinition, { kind: "extrude" }>["featureTypeVersion"];
      parameters: ImportDeferredExtrudeFeatureParameters;
    }
  | {
      kind: "revolve";
      featureTypeVersion: Extract<FeatureDefinition, { kind: "revolve" }>["featureTypeVersion"];
      parameters: ImportDeferredRevolveFeatureParameters;
    }
  | {
      kind: "fillet";
      featureTypeVersion: Extract<FeatureDefinition, { kind: "fillet" }>["featureTypeVersion"];
      parameters: ImportDeferredFilletFeatureParameters;
    }
  | {
      kind: "shell";
      featureTypeVersion: Extract<FeatureDefinition, { kind: "shell" }>["featureTypeVersion"];
      parameters: ImportDeferredShellFeatureParameters;
    }
  | {
      kind: "plane";
      featureTypeVersion: Extract<FeatureDefinition, { kind: "plane" }>["featureTypeVersion"];
      parameters: ImportDeferredPlaneFeatureParameters;
    }
  | ImportDeferredAdvancedSolidFeatureDefinition
  | {
      kind: "bakedBody";
      featureTypeVersion: Extract<FeatureDefinition, { kind: "bakedBody" }>["featureTypeVersion"];
      parameters: ImportDeferredBakedBodyFeatureParameters;
    }
  | {
      kind: "featureReplay";
      featureTypeVersion: Extract<FeatureDefinition, { kind: "featureReplay" }>["featureTypeVersion"];
      parameters: ImportDeferredFeatureReplayFeatureParameters;
    };

export type ImportTopologyFallbackCreateFeatureRequest = Omit<
  CreateFeatureRequest,
  "definition"
> & {
  definition: Extract<ImportDeferredFeatureDefinition, { kind: "bakedBody" }>;
};

export interface ImportCreateFeatureRequest
  extends Omit<CreateFeatureRequest, "definition"> {
  definition: ImportDeferredFeatureDefinition;
  /** Post-feature v2 checkpoint used only if live topology rematching fails. */
  topologyFallback?: ImportTopologyFallbackCreateFeatureRequest;
}

/**
 * Sketch-plane support that may defer to a construction produced by an earlier
 * ordered `createFeature` action, resolved by the orchestrator at apply time.
 */
export type ImportDeferredSketchPlaneSupportRef =
  | SketchPlaneSupportRef
  | ImportDeferredTopologyRef
  | Extract<ImportDeferredValue, { kind: "constructionOf" }>;

export interface ImportDeferredSketchPlaneDefinition
  extends Omit<SketchPlaneDefinition, "support"> {
  support: ImportDeferredSketchPlaneSupportRef;
}

export interface ImportCommitSketchRequest
  extends Omit<CommitSketchRequest, "plane"> {
  plane: ImportDeferredSketchPlaneDefinition;
}

export const IMPORT_DEFERRED_VALUE_BLESSED_POSITIONS = {
  regionOf: [
    "createFeatures[].definition.parameters.profiles[]",
    "createFeatures[].definition.parameters.participants[].targets[]",
  ],
  bodyOf: [
    "createFeatures[].definition.parameters.booleanScope.bodyId",
    "createFeatures[].definition.parameters.participants[].targets[]",
  ],
  sketchIdOf: [
    "createFeatures[].definition.parameters.axis.sketchId",
    "createFeatures[].definition.parameters.profiles[].sketchId",
    "createFeatures[].definition.parameters.participants[].targets[].sketchId",
    "createFeatures[].definition.parameters.extent.end.target.sketchId",
    "createFeatures[].definition.parameters.extent.firstEnd.target.sketchId",
    "createFeatures[].definition.parameters.extent.secondEnd.target.sketchId",
  ],
  constructionOf: [
    "createFeatures[].definition.parameters.participants[].targets[]",
    "commitSketches[].plane.support",
  ],
  featureOf: ["createFeatures[].definition.parameters.sourceFeatureIds[]"],
} as const satisfies Record<ImportDeferredValue["kind"], readonly string[]>;

export const IMPORT_DEFERRED_TOPOLOGY_BLESSED_POSITIONS = [
  "createFeatures[].definition.parameters.edgeTargets[]",
  "createFeatures[].definition.parameters.bodyTarget",
  "createFeatures[].definition.parameters.faceTargets[]",
  "createFeatures[].definition.parameters.participants[].targets[]",
  "createFeatures[].definition.parameters.reference.target",
  "createFeatures[].definition.parameters.booleanScope.bodyId",
  "createFeatures[].definition.parameters.booleanScope.bodyIds[]",
  "createFeatures[].definition.parameters.profiles[]",
  "createFeatures[].definition.parameters.extent.end.target",
  "createFeatures[].definition.parameters.extent.firstEnd.target",
  "createFeatures[].definition.parameters.extent.secondEnd.target",
  "commitSketches[].plane.support",
] as const;

/**
 * The orchestrator applies these through existing adapter methods.
 */
export interface ImportPreparedActions {
  createFeatures?: ImportCreateFeatureRequest[];
  commitSketches?: ImportCommitSketchRequest[];
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
