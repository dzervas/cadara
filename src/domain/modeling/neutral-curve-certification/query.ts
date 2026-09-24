import {
  validateNeutralCurveQueryRequest,
  type CertifiedNeutralCurveQuery,
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

function exhausted(): NeutralCurveQueryResult {
  return {
    kind: "uncertain",
    code: "exact-query-proof-budget-exhausted",
    message: "The deterministic exact-query arithmetic budget was exhausted.",
  };
}

type LowerProofLimits = ConstructorParameters<typeof ExactProofBudget>[0];

function createQuery(
  lowerLimits?: LowerProofLimits,
  observeBudget?: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedNeutralCurveQuery {
  return {
    queryPair(request) {
      const budget = new ExactProofBudget(lowerLimits);
      try {
        budget.operation(64);
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

/** Kernel-free constructive dispatcher for the admitted numeric neutral curves. */
export function createCertifiedNeutralCurveQuery(): CertifiedNeutralCurveQuery {
  return createQuery();
}

/** Test-only lower ceilings; construction clamps every value to production. */
export function createCertifiedNeutralCurveQueryWithLowerBudgetForTest(
  lowerLimits: LowerProofLimits,
): CertifiedNeutralCurveQuery {
  return createQuery(lowerLimits);
}

/** Test-only whole-request meter observation under production ceilings. */
export function createCertifiedNeutralCurveQueryWithBudgetObserverForTest(
  observeBudget: (snapshot: ExactProofBudgetSnapshot) => void,
): CertifiedNeutralCurveQuery {
  return createQuery(undefined, observeBudget);
}
