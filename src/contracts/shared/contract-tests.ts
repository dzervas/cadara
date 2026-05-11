import type {
  FeatureTreeNodeId,
  ObjectTreeNodeId,
  PickId,
  RenderableId,
  SnapshotEntityId,
} from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { ModelingKernelAdapter } from "@/contracts/modeling/adapter";
import type { SketchSolverAdapter as SketchSolverAdapterFromBarrel } from "@/contracts/solver";
import type { SketchSolverAdapter as SketchSolverAdapterDirect } from "@/contracts/solver/adapter";
import type {
  CreateFeatureRequest,
  WorkspaceSnapshot,
  FeatureDefinition,
  FeatureTreeNodeRecord,
  ModelingFeatureKind,
  ModelingDiagnostic,
  ObjectTreeNodeRecord,
  ReferenceRecord,
  ReorderFeatureRequest,
  ResolvedReferenceRecord,
  SnapshotEntityRecord,
} from "@/contracts/modeling/schema";
import type {
  RenderExport,
  RenderableEntityRecord,
} from "@/contracts/render/schema";

type Equals<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;

type Assert<T extends true> = T;

type DurableRefKinds = DurableRef["kind"];

type DurableRefKindsAreCanonical = Assert<
  Equals<
    DurableRefKinds,
    | "body"
    | "face"
    | "edge"
    | "vertex"
    | "loop"
    | "sketch"
    | "sketchOperation"
    | "sketchEntity"
    | "sketchPoint"
    | "constraint"
    | "dimension"
    | "feature"
    | "construction"
    | "region"
  >
>;

type FeatureTreeIdsArePresentational = Assert<
  Equals<FeatureTreeNodeRecord["id"], FeatureTreeNodeId>
>;

type ObjectTreeIdsArePresentational = Assert<
  Equals<ObjectTreeNodeRecord["id"], ObjectTreeNodeId>
>;

type SnapshotEntityIdsArePresentational = Assert<
  Equals<SnapshotEntityRecord["id"], SnapshotEntityId>
>;

type RenderableIdsArePresentational = Assert<
  Equals<RenderableEntityRecord["id"], RenderableId>
>;

type PickIdsAreTyped = Assert<
  Equals<RenderableEntityRecord["binding"]["pickId"], PickId>
>;

type RenderBindingUsesCanonicalRefs = Assert<
  RenderableEntityRecord["binding"]["target"] extends DurableRef ? true : false
>;

type RenderGeometryUnionIsSemanticExport = Assert<
  Equals<
    RenderableEntityRecord["geometry"]["kind"],
    "mesh" | "polyline" | "marker"
  >
>;

type NonTopologicalBindingsAreExplicit = Assert<
  Equals<
    Extract<
      RenderableEntityRecord["binding"],
      {
        semanticClass:
          | "construction"
          | "region"
          | "sketchCurve"
          | "sketchPoint";
      }
    >["topology"],
    null
  >
>;

type SharedIdsModule = typeof import("@/contracts/shared/ids");
type SharedBarrelModule = typeof import("@/contracts/shared");
type SketchBarrelModule = typeof import("@/contracts/sketch");
type SolverBarrelModule = typeof import("@/contracts/solver");
type SharedIdsDoNotLeakSketchPrimitiveId = Assert<
  Equals<
    "SketchPrimitiveId" extends keyof SharedIdsModule ? true : false,
    false
  >
>;

type SharedBarrelExportsIdentityPolicyVersion = Assert<
  Equals<
    "IDENTITY_POLICY_VERSION" extends keyof SharedBarrelModule ? true : false,
    true
  >
>;

type SharedBarrelExportsContractVersion = Assert<
  Equals<
    "CONTRACT_VERSION" extends keyof SharedBarrelModule ? true : false,
    true
  >
>;

type SketchBarrelExportsSketchSchemaVersion = Assert<
  Equals<
    "SKETCH_SCHEMA_VERSION" extends keyof SketchBarrelModule ? true : false,
    true
  >
>;

type SolverBarrelExportsSchemaVersion = Assert<
  Equals<
    "SOLVER_SCHEMA_VERSION" extends keyof SolverBarrelModule ? true : false,
    true
  >
>;

type SolverBarrelExportsAdapterInterface = Assert<
  Equals<SketchSolverAdapterFromBarrel, SketchSolverAdapterDirect>
>;

type KernelSnapshotBoundaryIsTyped = Assert<
  Equals<
    Awaited<
      ReturnType<ModelingKernelAdapter["getDocumentSnapshot"]>
    >["snapshot"],
    import("@/contracts/modeling/schema").WorkspaceSnapshot
  >
>;

type FeatureDefinitionUsesModelingFeatureKind = Assert<
  Equals<FeatureDefinition["kind"], ModelingFeatureKind>
>;

type CreateFeatureUsesTypedDefinition = Assert<
  Equals<CreateFeatureRequest["definition"], FeatureDefinition>
>;

type ReorderFeatureRequestIsTyped = Assert<
  Equals<
    ReorderFeatureRequest["beforeFeatureId"],
    import("@/contracts/shared/ids").FeatureId | null
  >
>;

type DiagnosticsUseCanonicalRefs = Assert<
  Equals<Exclude<ModelingDiagnostic["target"], null>, DurableRef>
>;

type ReferencesUseCanonicalRefs = Assert<
  Equals<ReferenceRecord["target"], DurableRef>
>;

type ResolutionUsesCanonicalRefs = Assert<
  Equals<ResolvedReferenceRecord["target"], DurableRef>
>;

type SnapshotEntitiesUseCanonicalRefs = Assert<
  Equals<SnapshotEntityRecord["target"], DurableRef>
>;

type SnapshotReferencesAreModelingOwned = Assert<
  Equals<WorkspaceSnapshot["document"]["references"][number], ReferenceRecord>
>;

type SnapshotRenderUsesRenderContract = Assert<
  Equals<WorkspaceSnapshot["document"]["render"], RenderExport>
>;

/**
 * Compile-time contract assertions that freeze the public type surface.
 * This tuple is never consumed at runtime beyond forcing the assertions to
 * instantiate during type-checking.
 */
export const CONTRACT_TYPE_TESTS: readonly [
  DurableRefKindsAreCanonical,
  FeatureTreeIdsArePresentational,
  ObjectTreeIdsArePresentational,
  SnapshotEntityIdsArePresentational,
  RenderableIdsArePresentational,
  PickIdsAreTyped,
  RenderBindingUsesCanonicalRefs,
  RenderGeometryUnionIsSemanticExport,
  NonTopologicalBindingsAreExplicit,
  SharedIdsDoNotLeakSketchPrimitiveId,
  SharedBarrelExportsIdentityPolicyVersion,
  SharedBarrelExportsContractVersion,
  SketchBarrelExportsSketchSchemaVersion,
  SolverBarrelExportsSchemaVersion,
  SolverBarrelExportsAdapterInterface,
  KernelSnapshotBoundaryIsTyped,
  FeatureDefinitionUsesModelingFeatureKind,
  CreateFeatureUsesTypedDefinition,
  ReorderFeatureRequestIsTyped,
  DiagnosticsUseCanonicalRefs,
  ReferencesUseCanonicalRefs,
  ResolutionUsesCanonicalRefs,
  SnapshotEntitiesUseCanonicalRefs,
  SnapshotReferencesAreModelingOwned,
  SnapshotRenderUsesRenderContract,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
