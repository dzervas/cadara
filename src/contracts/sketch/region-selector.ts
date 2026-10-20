import type { RegionId, SketchId } from "@/contracts/shared/ids";
import type {
  SketchRecord,
  RegionRecord,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import {
  matchRegionsByBoundaryIdentity,
  type RegionBoundaryIdentity,
} from "./region-boundary-identity";

export interface InteriorPointRegionSelector {
  kind: "interiorPoint";
  point: SketchPoint2D;
  expectedBoundaryIdentity?: RegionBoundaryIdentity;
}

export type RegionSelector = InteriorPointRegionSelector & {
  expectedBoundaryIdentity: RegionBoundaryIdentity;
};

export interface RegionSelectionFailure {
  reason: "missing" | "identity-mismatch" | "ambiguous";
  profileIndex: number | null;
  sketchId: SketchId;
  oldRegionId: RegionId;
  candidateIds: RegionId[];
  selectorVersion: "import-region-boundary/v1" | null;
  diagnostics: SketchRecord["derivedValidity"]["diagnostics"];
}

export type RegionSelectionResult =
  | { ok: true; region: RegionRecord }
  | {
      ok: false;
      code: "profile-region-reselect" | "profile-region-sketch-not-current";
      failure: RegionSelectionFailure;
    };

/** Native matching never uses the point as proof, even if the old ID survives. */
export function resolveRegionProfile(
  sketch: Pick<SketchRecord, "derivedValidity" | "regions">,
  ref: { sketchId: SketchId; regionId: RegionId; selector?: RegionSelector },
): RegionSelectionResult {
  const failure = (
    reason: RegionSelectionFailure["reason"],
    candidateIds: RegionId[] = [],
  ): RegionSelectionResult => ({
    ok: false,
    code:
      sketch.derivedValidity.state === "current"
        ? "profile-region-reselect"
        : "profile-region-sketch-not-current",
    failure: {
      reason,
      profileIndex: null,
      sketchId: ref.sketchId,
      oldRegionId: ref.regionId,
      candidateIds,
      selectorVersion: ref.selector ? "import-region-boundary/v1" : null,
      diagnostics: sketch.derivedValidity.diagnostics,
    },
  });
  // Withheld/stale geometry cannot certify a selection, including an exact ID.
  if (sketch.derivedValidity.state !== "current") return failure("missing");
  const regions = sketch.regions.filter((region) => region.isClosed);
  if (!ref.selector) {
    const region = regions.find((region) => region.regionId === ref.regionId);
    return region
      ? { ok: true, region }
      : failure(
          "missing",
          regions.map((region) => region.regionId),
        );
  }
  if (!isRegionSelector(ref.selector)) return failure("identity-mismatch");
  const matches = matchRegionsByBoundaryIdentity(
    regions,
    ref.selector.expectedBoundaryIdentity,
  );
  if (matches.length > 1)
    return failure(
      "ambiguous",
      matches.map((region) => region.regionId),
    );
  if (matches.length === 1) return { ok: true, region: matches[0]! };
  return failure(
    regions.length ? "identity-mismatch" : "missing",
    regions.map((region) => region.regionId),
  );
}

export function isRegionSelector(value: unknown): value is RegionSelector {
  if (typeof value !== "object" || value === null) return false;
  const selector = value as Partial<RegionSelector>;
  return (
    selector.kind === "interiorPoint" &&
    Array.isArray(selector.point) &&
    selector.point.length === 2 &&
    selector.point.every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    ) &&
    typeof selector.expectedBoundaryIdentity === "string" &&
    selector.expectedBoundaryIdentity.startsWith("import-region-boundary/v1:")
  );
}
