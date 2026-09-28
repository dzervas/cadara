import {
  validateNeutralCurveQueryRequest,
  type CertifiedNeutralCurveJoinQuery,
  type NeutralCurveJoinRequest,
  type NeutralCurveJoinResult,
  type NeutralCurveQueryCapability,
  type NeutralCurveQueryRequest,
  type NeutralCurveQueryResult,
} from "@/contracts/modeling/neutral-curve-query";
import { validateCertifiedCircleAngularDomain } from "@/domain/modeling/neutral-curve-certification/circle-angular-certification";
import { certifyCubicPairExact } from "@/domain/modeling/neutral-curve-certification/cubic-pair-exact";
import {
  certifyCubicSelfIntersection,
  proveFiniteLinePair,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import {
  certifyConstructiveCircleCubic,
  certifyConstructiveCirclePair,
  certifyConstructiveLineCircle,
  certifyConstructiveLineCubic,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-curve-roots";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
  type ExactProofBudgetSnapshot,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";
import type { CertifiedNeutralCurveRequestQuery } from "@/contracts/sketch/offset-chain-topology";
import { certifyNeutralCurveJoin } from "@/domain/modeling/neutral-curve-certification/joined-pair";

function exhausted() {
  return {
    kind: "uncertain" as const,
    code: "exact-query-proof-budget-exhausted",
    message: "The deterministic exact-query arithmetic budget was exhausted.",
  };
}

type LowerProofLimits = ConstructorParameters<typeof ExactProofBudget>[0];

/** The ordinary kernel-free pair route on a caller-owned budget. */
function certifyNeutralCurvePairOnBudget(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): NeutralCurveQueryResult {
  const invalid = validateNeutralCurveQueryRequest(request);
  if (invalid) return invalid;
  for (const curve of [request.first, request.second]) {
    if (
      curve.kind === "circle" &&
      !validateCertifiedCircleAngularDomain(curve, budget)
    )
      return {
        kind: "uncertain",
        code: "invalid-neutral-curve-query",
        message:
          "Neutral queries require finite geometry, unit directions, positive radii and tolerance, and finite increasing bounded domains.",
      };
  }
  if (
    request.first.kind === "cubicBezier" &&
    request.second.kind === "cubicBezier"
  ) {
    return certifyCubicPairExact(request, budget)!;
  }
  return (
    proveFiniteLinePair(request, budget) ??
    certifyConstructiveLineCircle(request, budget) ??
    certifyConstructiveLineCubic(request, budget) ??
    certifyConstructiveCirclePair(request, budget) ??
    certifyConstructiveCircleCubic(request, budget) ?? {
      kind: "unsupported",
      code: "unsupported-neutral-curve-family",
      message:
        "The neutral curve family is not admitted by the constructive query.",
    }
  );
}

/**
 * The kernel-free declared-join route on a caller-owned budget: the sole
 * join verifier for every capability. Budget exhaustion propagates.
 */
export function certifyNeutralCurveJoinOnBudget(
  request: NeutralCurveJoinRequest,
  budget: ExactProofBudget,
): NeutralCurveJoinResult {
  return certifyNeutralCurveJoin(
    request,
    budget,
    certifyNeutralCurvePairOnBudget,
  );
}

function createQuery(
  lowerLimits?: LowerProofLimits,
  observeBudget?: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedNeutralCurveJoinQuery {
  return {
    queryPair(request) {
      const budget = new ExactProofBudget(lowerLimits);
      try {
        budget.operation(64);
        return certifyNeutralCurvePairOnBudget(request, budget);
      } catch (error) {
        if (error instanceof ExactQueryProofBudgetExceeded) return exhausted();
        throw error;
      } finally {
        observeBudget?.(budget.snapshot());
      }
    },

    queryJoin(request) {
      const budget = new ExactProofBudget(lowerLimits);
      try {
        budget.operation(64);
        return certifyNeutralCurveJoinOnBudget(request, budget);
      } catch (error) {
        if (error instanceof ExactQueryProofBudgetExceeded) return exhausted();
        throw error;
      } finally {
        observeBudget?.(budget.snapshot());
      }
    },

    querySelf(request) {
      const budget = new ExactProofBudget(lowerLimits);
      try {
        budget.operation(64);
        const invalid = validateNeutralCurveQueryRequest({
          modelingTolerance: request.modelingTolerance,
          first: request.curve,
          second: request.curve,
        });
        if (invalid) return invalid;
        if (request.curve.kind === "circle") {
          if (!validateCertifiedCircleAngularDomain(request.curve, budget)) {
            return {
              kind: "uncertain",
              code: "invalid-neutral-curve-query",
              message:
                "Neutral queries require finite geometry, unit directions, positive radii and tolerance, and finite increasing bounded domains.",
            };
          }
        }
        if (request.curve.kind !== "cubicBezier") {
          return {
            kind: "unsupported",
            code: "unsupported-neutral-curve-self-family",
            message: "Only cubic Bézier self queries are currently admitted.",
          };
        }
        return certifyCubicSelfIntersection(
          request.curve,
          request.modelingTolerance,
          budget,
        );
      } catch (error) {
        if (error instanceof ExactQueryProofBudgetExceeded) return exhausted();
        throw error;
      } finally {
        observeBudget?.(budget.snapshot());
      }
    },
  };
}

/** Entry charge of one pair query; the request meter precharges it per query. */
const PAIR_QUERY_ENTRY_CHARGE = 64;

function createRequestQuery(
  lowerLimits?: LowerProofLimits,
  observeBudget?: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedNeutralCurveRequestQuery {
  return {
    openRequest(queryCount) {
      if (!Number.isSafeInteger(queryCount) || queryCount < 0) {
        throw new RangeError("A request query count must be a count.");
      }
      // Structural cap (M7/D5): the per-query ceilings × (queryCount + 1),
      // on ONE budget that is never reset, replaced or topped up.
      const budget = new ExactProofBudget(lowerLimits, queryCount + 1);
      let issued = 0;
      let spent = false;
      try {
        budget.operation(PAIR_QUERY_ENTRY_CHARGE * queryCount);
      } catch (error) {
        if (!(error instanceof ExactQueryProofBudgetExceeded)) throw error;
        spent = true;
      } finally {
        observeBudget?.(budget.snapshot());
      }
      return {
        queryPair(request) {
          if (issued === queryCount) {
            throw new RangeError(
              "The request issued more pair queries than it was sized for.",
            );
          }
          issued += 1;
          if (spent) return exhausted();
          try {
            return certifyNeutralCurvePairOnBudget(request, budget);
          } catch (error) {
            if (!(error instanceof ExactQueryProofBudgetExceeded)) throw error;
            spent = true;
            return exhausted();
          } finally {
            observeBudget?.(budget.snapshot());
          }
        },
      };
    },
  };
}

/** Production whole-request pair meter under the structural request ceilings. */
export function createCertifiedNeutralCurveRequestQuery(): CertifiedNeutralCurveRequestQuery {
  return createRequestQuery();
}

/** Test-only lower whole-request ceilings; clamped to the structural cap. */
export function createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest(
  lowerLimits: LowerProofLimits,
): CertifiedNeutralCurveRequestQuery {
  return createRequestQuery(lowerLimits);
}

/**
 * Test-only observation of the cumulative whole-request meter: once after the
 * precharge and after every query, so the last snapshot is the request total.
 */
export function createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest(
  observeBudget: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedNeutralCurveRequestQuery {
  return createRequestQuery(undefined, observeBudget);
}

/** Kernel-free constructive dispatcher for the admitted numeric neutral curves. */
export function createCertifiedNeutralCurveQuery(): CertifiedNeutralCurveJoinQuery {
  return createQuery();
}

/** Test-only capability over the kernel-free dispatcher (all three operations, each async). */
export function createCertifiedNeutralCurveQueryCapabilityForTest(): NeutralCurveQueryCapability {
  const query = createQuery();
  return {
    queryNeutralCurves: async (request) => query.queryPair(request),
    queryNeutralCurveSelfIntersections: async (request) =>
      query.querySelf(request),
    queryNeutralCurveJoin: async (request) => query.queryJoin(request),
  };
}

/**
 * Test-only certified capability that records the `modelingTolerance` of every
 * request it answers, for proving document-tolerance threading end to end.
 */
export function createRecordingNeutralCurveQueryCapabilityForTest(): {
  capability: NeutralCurveQueryCapability;
  modelingTolerances: number[];
} {
  const inner = createCertifiedNeutralCurveQueryCapabilityForTest();
  const modelingTolerances: number[] = [];
  return {
    modelingTolerances,
    capability: {
      queryNeutralCurves: (request) => {
        modelingTolerances.push(request.modelingTolerance);
        return inner.queryNeutralCurves(request);
      },
      queryNeutralCurveSelfIntersections: (request) => {
        modelingTolerances.push(request.modelingTolerance);
        return inner.queryNeutralCurveSelfIntersections(request);
      },
      queryNeutralCurveJoin: (request) => {
        modelingTolerances.push(request.modelingTolerance);
        return inner.queryNeutralCurveJoin(request);
      },
    },
  };
}

/** Test-only lower ceilings; construction clamps every value to production. */
export function createCertifiedNeutralCurveQueryWithLowerBudgetForTest(
  lowerLimits: LowerProofLimits,
): CertifiedNeutralCurveJoinQuery {
  return createQuery(lowerLimits);
}

/** Test-only whole-request meter observation under production ceilings. */
export function createCertifiedNeutralCurveQueryWithBudgetObserverForTest(
  observeBudget: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedNeutralCurveJoinQuery {
  return createQuery(undefined, observeBudget);
}
