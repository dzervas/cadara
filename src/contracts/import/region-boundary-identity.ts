/** Compatibility exports: v1 bytes and importer matching semantics are unchanged. */
export {
  deriveRegionBoundaryIdentity as deriveImportRegionBoundaryIdentity,
  matchRegionsByBoundaryIdentity as matchImportedRegionsByBoundaryIdentity,
  resolveRegionByBoundaryIdentity as resolveImportedRegionByBoundaryIdentity,
} from "@/contracts/sketch/region-boundary-identity";
export type {
  RegionBoundaryIdentity as ImportRegionBoundaryIdentity,
} from "@/contracts/sketch/region-boundary-identity";
