import type {
  CircleQueryDomain,
  CircleSourceDomain,
} from "@/contracts/modeling/neutral-curve-query";

/** Binary64 upper enclosure used only to keep validation/search conservative. */
export const TWO_PI_OUTWARD_UPPER = 6.283185307179587;
const TWO_PI_SEED = 6.283185307179586;

function isTuple(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[1] > value[0]
  );
}

function isArc(value: unknown): value is CircleQueryDomain {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; interval?: unknown };
  return candidate.kind === "arc" && isTuple(candidate.interval);
}

function isSource(value: unknown): value is CircleSourceDomain {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as {
    kind?: unknown;
    interval?: unknown;
    seam?: unknown;
  };
  return candidate.kind === "fullTurn"
    ? Number.isFinite(candidate.seam)
    : candidate.kind === "arc" && isTuple(candidate.interval);
}

function conservativelyShorterThanFullTurn(
  interval: readonly [number, number],
) {
  return interval[1] - interval[0] < TWO_PI_OUTWARD_UPPER;
}

export interface ValidCircleAngularDomain {
  readonly source: CircleSourceDomain;
  readonly active: CircleQueryDomain | CircleSourceDomain;
}

/**
 * Structural validation only. Exact π/span decisions for verified queries are
 * owned by the metered fixed-degree arithmetic layer.
 */
export function validateCircleAngularDomain(
  sourceValue: unknown,
  queryValue: unknown,
): ValidCircleAngularDomain | null {
  if (!isSource(sourceValue)) return null;
  if (
    sourceValue.kind === "arc" &&
    !conservativelyShorterThanFullTurn(sourceValue.interval)
  ) {
    return null;
  }
  if (queryValue !== undefined && !isArc(queryValue)) return null;
  const query = queryValue as CircleQueryDomain | undefined;
  if (query) {
    if (!conservativelyShorterThanFullTurn(query.interval)) return null;
    if (sourceValue.kind === "arc") {
      if (
        query.interval[0] < sourceValue.interval[0] ||
        query.interval[1] > sourceValue.interval[1]
      ) {
        return null;
      }
    } else {
      const lowerOffset = query.interval[0] - sourceValue.seam;
      const upperOffset = query.interval[1] - sourceValue.seam;
      if (lowerOffset < 0 || upperOffset >= TWO_PI_OUTWARD_UPPER) return null;
    }
  }
  return { source: sourceValue, active: query ?? sourceValue };
}

export function circleParameterInsideAngularDomain(
  domain: ValidCircleAngularDomain,
  parameter: number,
) {
  if (!Number.isFinite(parameter)) return false;
  if (domain.active.kind === "arc") {
    return (
      parameter >= domain.active.interval[0] &&
      parameter <= domain.active.interval[1]
    );
  }
  const offset = parameter - domain.active.seam;
  return offset >= 0 && offset < TWO_PI_OUTWARD_UPPER;
}

/**
 * Lifts a non-authoritative native angle seed into the selected winding.
 * Certified query code independently proves the resulting association.
 */
export function liftNativeCircleParameter(
  domain: ValidCircleAngularDomain,
  nativeParameter: number,
): number | null {
  if (!Number.isFinite(nativeParameter)) return null;
  if (domain.active.kind === "arc") {
    return circleParameterInsideAngularDomain(domain, nativeParameter)
      ? nativeParameter
      : null;
  }
  const approximateTurn = Math.ceil(
    (domain.active.seam - nativeParameter) / TWO_PI_SEED,
  );
  if (!Number.isSafeInteger(approximateTurn)) return null;
  const candidate = nativeParameter + approximateTurn * TWO_PI_SEED;
  return circleParameterInsideAngularDomain(domain, candidate)
    ? candidate
    : null;
}

/** Outward binary64 bounds for candidate search; never use them for proof. */
export function getCircleAngularSearchBounds(
  domain: ValidCircleAngularDomain,
): readonly [number, number] {
  if (domain.active.kind === "arc") return domain.active.interval;
  return [domain.active.seam, domain.active.seam + TWO_PI_OUTWARD_UPPER];
}
