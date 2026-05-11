import type {
  FeatureBooleanOperation,
  FeatureBooleanScope,
  RevolveAxisRef,
} from "@/contracts/modeling/schema";
import type { RegionBoundarySegmentRecord } from "@/contracts/sketch/schema";
import type { ProjectedGeometryId } from "@/contracts/shared/ids";

/**
 * Phase 0 implementation notes for the OCC adapter.
 * These notes freeze the contract gaps and red-line behaviors called out in
 * OCC.md before broader OCC feature work continues.
 */
export const OCC_PHASE0_IMPLEMENTATION_NOTES = {
  contractGaps: {
    constructionSnapshots:
      "ConstructionSnapshotRecord exposes plane identity and ownership, but not the explicit plane frame required to reconstruct a feature-created construction plane from public snapshot data alone. The OCC adapter must keep feature-authored plane geometry internally, must not change the public contract to smuggle extra data through Phase 0, and must not treat public construction snapshots as independently reconstructible.",
    constructionRevolveAxis:
      "RevolveAxisRef allows { kind: 'construction' }, but the public construction contract currently exposes only planes, not durable axis or line constructions. The OCC adapter must reject this variant explicitly instead of inventing hidden axis semantics.",
    projectedGeometryRegionLoops:
      "RegionBoundarySegmentRecord can point at projected geometry. The OCC adapter may consume those segments only when active solver-owned projection data for the current revision resolves the referenced geometry; unresolved segments must report invalidation instead of using copied or stale curves.",
    multiBodyBooleanScope:
      "FeatureBooleanScope.kind === 'targetBodies' is ordered, but the modeling contract does not define how join, cut, and intersect should apply across more than one body. The OCC adapter therefore freezes one explicit policy instead of inheriting OCC defaults silently.",
  },
  solverBoundary:
    "Projected external geometry, authored-sketch validation, solving, and region derivation remain owned by the SketchSolverAdapter boundary. The OCC kernel must consume those typed results, not recreate solver behavior in modeling code.",
} as const;

export const OCC_CONTRACT_GAP_CODES = {
  constructionPlaneGeometryUnavailable:
    "occ-contract-gap-construction-plane-geometry",
  constructionRevolveAxisUnsupported:
    "occ-contract-gap-revolve-construction-axis",
  projectedRegionGeometryUnavailable: "occ-contract-gap-projected-region-loop",
} as const;

export interface OccProjectedRegionLoopRejection {
  code: typeof OCC_CONTRACT_GAP_CODES.projectedRegionGeometryUnavailable;
  reasonCode: "missingLiveProjectedGeometry";
  reason: string;
  message: string;
}

export interface OccMultiBodyBooleanPolicy {
  operation: Exclude<FeatureBooleanOperation, "newBody">;
  targetSelection: "orderedTargetBodies";
  application: "sequential" | "perTarget";
  kernelOperation: "fuse" | "cut" | "intersect";
  preservesSuppliedOrder: true;
  precombineTargets: false;
}

export const OCC_MULTI_BODY_BOOLEAN_POLICIES = {
  join: {
    operation: "join",
    targetSelection: "orderedTargetBodies",
    application: "sequential",
    kernelOperation: "fuse",
    preservesSuppliedOrder: true,
    precombineTargets: false,
  },
  cut: {
    operation: "cut",
    targetSelection: "orderedTargetBodies",
    application: "perTarget",
    kernelOperation: "cut",
    preservesSuppliedOrder: true,
    precombineTargets: false,
  },
  intersect: {
    operation: "intersect",
    targetSelection: "orderedTargetBodies",
    application: "perTarget",
    kernelOperation: "intersect",
    preservesSuppliedOrder: true,
    precombineTargets: false,
  },
} as const satisfies Record<
  Exclude<FeatureBooleanOperation, "newBody">,
  OccMultiBodyBooleanPolicy
>;

export function isConstructionBackedRevolveAxisSupported(axis: RevolveAxisRef) {
  return axis.kind === "edge";
}

export function getConstructionBackedRevolveAxisRejectionReason() {
  return OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps.constructionRevolveAxis;
}

export function isProjectedRegionSegmentSourceSupported(
  source: RegionBoundarySegmentRecord["source"],
) {
  return source.kind === "entity" || source.kind === "projectedGeometry";
}

export function getProjectedRegionLoopRejectionReason() {
  return OCC_PHASE0_IMPLEMENTATION_NOTES.contractGaps
    .projectedGeometryRegionLoops;
}

function formatProjectedRegionLoopRejectionMessage(
  geometryId: ProjectedGeometryId,
) {
  return `Projected region geometry ${geometryId} cannot be resolved from live projection data for this revision.`;
}

export function createProjectedRegionLoopRejection(
  source: Extract<
    RegionBoundarySegmentRecord["source"],
    { kind: "projectedGeometry" }
  >,
): OccProjectedRegionLoopRejection {
  return {
    code: OCC_CONTRACT_GAP_CODES.projectedRegionGeometryUnavailable,
    reasonCode: "missingLiveProjectedGeometry",
    reason: getProjectedRegionLoopRejectionReason(),
    message: formatProjectedRegionLoopRejectionMessage(
      source.reference.geometryId,
    ),
  };
}

export function getProjectedRegionLoopRejectionMessage(
  source: Extract<
    RegionBoundarySegmentRecord["source"],
    { kind: "projectedGeometry" }
  >,
) {
  return createProjectedRegionLoopRejection(source).message;
}

export function getMultiBodyBooleanPolicy(
  operation: FeatureBooleanOperation,
  booleanScope: FeatureBooleanScope,
) {
  if (booleanScope.kind !== "targetBodies") {
    return null;
  }

  if (operation === "newBody") {
    return null;
  }

  return OCC_MULTI_BODY_BOOLEAN_POLICIES[operation];
}
