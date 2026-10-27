import type { SketchEntityId } from "@/contracts/shared/ids";
import { declaredJoinClasses } from "@/contracts/sketch/region-extraction";
import type {
  RegionRecord,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";
import { curveEndPointIds } from "@/core/sketch-interaction/near-gap";
import type { SketchSessionState } from "./types";

/**
 * T17c6 (D-2; specification "Minimum failure feedback"): the region
 * extraction warnings that withhold a region (an uncertain or unsupported
 * query, join, vertex order or nesting, a degenerate/unsupported curve or a
 * tail crossing near it, an identity collision). Uncertainty fails closed,
 * so these are the only explanation of a missing region.
 */
const REGION_WITHHOLDING_CODES = new Set([
  "region-join-uncertain",
  "region-query-uncertain",
  "region-query-unsupported",
  "region-vertex-order-uncertain",
  "region-nesting-uncertain",
  "region-degenerate-curve",
  "region-unsupported-curve",
  "region-derived-tail-crossing",
  "region-identity-collision",
]);

const RECOVERY = "No region is formed there. Undo, or edit that geometry.";
const ZERO_HANDLE_RECOVERY =
  "No region is formed there. Undo, drag the handle out of zero, or Reset to automatic.";

const withheldText = (warning: SketchSolveDiagnostic) =>
  `${warning.message} ${
    warning.joinCause?.code === "join-zero-end-tangent" &&
    warning.joinCause.culprit?.kind === "splineTangentHandle"
      ? ZERO_HANDLE_RECOVERY
      : RECOVERY
  }`;

/**
 * Whether `message` is a status line this owner composed from one of
 * `diagnostics` (the live regions' warnings it was derived from). Other
 * owners' messages never match.
 */
export function isSketchWithheldRegionText(
  diagnostics: readonly SketchSolveDiagnostic[],
  message: string | null,
): boolean {
  return (
    message !== null &&
    diagnostics.some(
      (diagnostic) =>
        REGION_WITHHOLDING_CODES.has(diagnostic.code) &&
        withheldText(diagnostic) === message,
    )
  );
}

/**
 * The status line for a withheld region the user would expect, built from
 * the warning that justifies it (review R-2):
 * - a warning naming a curve that bounded a region of `previousRegions`
 *   that is gone (a region the user had), or else
 * - a warning naming a curve on a closed outline (a closed curve, or a
 *   curve on a cycle of curves joined end to end through declared joins:
 *   shared points or satisfied coincidences; distance never joins).
 * The warning (label-based) is followed by the recovery. Null when the
 * regions are not current or no warning qualifies.
 */
export function describeSketchSessionWithheldRegions(
  session: SketchSessionState,
  previousRegions: readonly RegionRecord[],
): string | null {
  const { liveRegions, liveSolve } = session;
  if (liveRegions.status !== "current" || !liveSolve) return null;
  const named = liveRegions.diagnostics.filter(
    (
      diagnostic,
    ): diagnostic is SketchSolveDiagnostic & {
      target: { kind: "entity"; entityId: SketchEntityId };
    } =>
      REGION_WITHHOLDING_CODES.has(diagnostic.code) &&
      diagnostic.target?.kind === "entity",
  );
  if (named.length === 0) return null;
  const kept = new Set(liveRegions.regions.map((region) => region.regionId));
  const lostBoundary = new Set(
    previousRegions
      .filter((region) => !kept.has(region.regionId))
      .flatMap((region) => region.loops)
      .flatMap((loop) => loop.segments)
      .flatMap((segment) => [
        segment.branch,
        ...(segment.coincidentBranches ?? []),
      ])
      .flatMap((branch) =>
        branch.source.kind === "entity" ? [branch.source.entityId] : [],
      ),
  );
  const warning =
    named.find((diagnostic) => lostBoundary.has(diagnostic.target.entityId)) ??
    named.find((diagnostic) =>
      isOnClosedOutline(liveSolve, diagnostic.target.entityId),
    );
  return warning ? withheldText(warning) : null;
}

function isOnClosedOutline(
  liveSolve: NonNullable<SketchSessionState["liveSolve"]>,
  entityId: SketchEntityId,
) {
  const { definition, solvedSnapshot } = liveSolve;
  const curves = definition.entities.filter((entity) => !entity.isConstruction);
  const entity = curves.find((curve) => curve.entityId === entityId);
  if (!entity) return false;
  if (
    entity.kind === "circle" ||
    entity.kind === "ellipse" ||
    (entity.kind === "spline" && entity.closure !== "open")
  )
    return true;
  const ends = curveEndPointIds(entity);
  if (ends.length !== 2) return false;
  // The entity is on a cycle when its two end classes are connected by the
  // other curves (or are one class).
  const joins = declaredJoinClasses(definition, solvedSnapshot);
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const next = parent.get(key);
    if (next === undefined || next === key) return key;
    const root = find(next);
    parent.set(key, root);
    return root;
  };
  for (const curve of curves) {
    if (curve.entityId === entityId) continue;
    const [start, end] = curveEndPointIds(curve);
    if (start === undefined || end === undefined) continue;
    const a = find(joins.find(start));
    const b = find(joins.find(end));
    if (a !== b) parent.set(a, b);
  }
  return find(joins.find(ends[0]!)) === find(joins.find(ends[1]!));
}

/**
 * T17c6 (D-2, review A-3): the session's status line when it is the
 * withheld-region explanation of its live regions (current, or pending a
 * result that will clear or re-set it), else null. Point selection and an
 * armed drawing tool's moves, clicks, commits and chain restages keep it
 * (they cleared it until the next region result: a flash at every commit).
 */
export function keptSketchWithheldRegionText(
  session: Pick<SketchSessionState, "liveRegions" | "validationMessage">,
) {
  return (session.liveRegions.status === "current" ||
    session.liveRegions.status === "pending") &&
    isSketchWithheldRegionText(
      session.liveRegions.diagnostics,
      session.validationMessage,
    )
    ? session.validationMessage
    : null;
}
