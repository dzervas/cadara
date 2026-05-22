import typia from "typia";

import type {
  DeriveSketchRegionsRequest,
  DisposeInteractiveSketchSolveSessionRequest,
  FinalizeInteractiveSketchSolveSessionRequest,
  ProjectSketchExternalReferencesRequest,
  ResolveSketchReferenceRequest,
  SketchSolverRequestBase,
  SolveSketchRequest,
  StartInteractiveSketchSolveSessionRequest,
  UpdateInteractiveSketchSolveSessionRequest,
  ValidateSketchRequest,
} from "@/contracts/solver/schema";
import {
  requireContract,
  validateContract,
  type ContractValidationResult,
} from "@/contracts/shared/validation";

const projectSketchExternalReferencesRequestValidator =
  typia.createValidateEquals<ProjectSketchExternalReferencesRequest>();
const validateSketchRequestValidator =
  typia.createValidateEquals<ValidateSketchRequest>();
const solveSketchRequestValidator =
  typia.createValidateEquals<SolveSketchRequest>();
const startInteractiveSketchSolveSessionRequestValidator =
  typia.createValidateEquals<StartInteractiveSketchSolveSessionRequest>();
const updateInteractiveSketchSolveSessionRequestValidator =
  typia.createValidateEquals<UpdateInteractiveSketchSolveSessionRequest>();
const finalizeInteractiveSketchSolveSessionRequestValidator =
  typia.createValidateEquals<FinalizeInteractiveSketchSolveSessionRequest>();
const disposeInteractiveSketchSolveSessionRequestValidator =
  typia.createValidateEquals<DisposeInteractiveSketchSolveSessionRequest>();
const deriveSketchRegionsRequestValidator =
  typia.createValidateEquals<DeriveSketchRegionsRequest>();
const resolveSketchReferenceRequestValidator =
  typia.createValidateEquals<ResolveSketchReferenceRequest>();

export function validateSketchSolverEnvelope(
  value: unknown,
): ContractValidationResult<SketchSolverRequestBase> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      success: false,
      data: value,
      issues: [
        {
          path: "",
          expected: "SketchSolverRequestBase",
          value,
          message: "Sketch solver request envelope must be an object.",
        },
      ],
    };
  }

  const candidate = value as Partial<SketchSolverRequestBase>;
  const failures = [
    ["contractVersion", candidate.contractVersion, "modeling-contract/v1alpha1"],
    ["solverSchemaVersion", candidate.solverSchemaVersion, "sketch-solver/v1alpha1"],
  ] as const;

  for (const [path, actual, expected] of failures) {
    if (actual !== expected) {
      const label =
        path === "solverSchemaVersion"
          ? "solver schema version"
          : "contract version";
      return {
        success: false,
        data: value,
        issues: [
          {
            path,
            expected,
            value: actual,
            message: `Unsupported ${label}; expected ${path} ${expected}.`,
          },
        ],
      };
    }
  }

  for (const [path, prefix] of [
    ["requestId", "request_"],
    ["documentId", "doc_"],
    ["revisionId", "rev_"],
    ["sketchId", "sketch_"],
  ] as const) {
    const actual = candidate[path];
    if (typeof actual !== "string" || !actual.startsWith(prefix)) {
      return {
        success: false,
        data: value,
        issues: [
          {
            path,
            expected: `${prefix}<id>`,
            value: actual,
            message: `${path} is invalid.`,
          },
        ],
      };
    }
  }

  return {
    success: true,
    data: {
      contractVersion: candidate.contractVersion,
      solverSchemaVersion: candidate.solverSchemaVersion,
      requestId: candidate.requestId,
      documentId: candidate.documentId,
      revisionId: candidate.revisionId,
      sketchId: candidate.sketchId,
    } as SketchSolverRequestBase,
  };
}

export function validateProjectSketchExternalReferencesRequest(
  value: unknown,
): ContractValidationResult<ProjectSketchExternalReferencesRequest> {
  return validateContract(projectSketchExternalReferencesRequestValidator, value);
}

export function requireProjectSketchExternalReferencesRequest(
  value: unknown,
): ProjectSketchExternalReferencesRequest {
  return requireContract(
    projectSketchExternalReferencesRequestValidator,
    value,
    "Project sketch external references request",
  );
}

export function validateValidateSketchRequest(
  value: unknown,
): ContractValidationResult<ValidateSketchRequest> {
  return validateContract(validateSketchRequestValidator, value);
}

export function requireValidateSketchRequest(
  value: unknown,
): ValidateSketchRequest {
  return requireContract(
    validateSketchRequestValidator,
    value,
    "Validate sketch request",
  );
}

export function validateSolveSketchRequest(
  value: unknown,
): ContractValidationResult<SolveSketchRequest> {
  return validateContract(solveSketchRequestValidator, value);
}

export function requireSolveSketchRequest(value: unknown): SolveSketchRequest {
  return requireContract(
    solveSketchRequestValidator,
    value,
    "Solve sketch request",
  );
}

export function validateStartInteractiveSketchSolveSessionRequest(
  value: unknown,
): ContractValidationResult<StartInteractiveSketchSolveSessionRequest> {
  return validateContract(
    startInteractiveSketchSolveSessionRequestValidator,
    value,
  );
}

export function requireStartInteractiveSketchSolveSessionRequest(
  value: unknown,
): StartInteractiveSketchSolveSessionRequest {
  return requireContract(
    startInteractiveSketchSolveSessionRequestValidator,
    value,
    "Start interactive sketch solve session request",
  );
}

export function validateUpdateInteractiveSketchSolveSessionRequest(
  value: unknown,
): ContractValidationResult<UpdateInteractiveSketchSolveSessionRequest> {
  return validateContract(
    updateInteractiveSketchSolveSessionRequestValidator,
    value,
  );
}

export function requireUpdateInteractiveSketchSolveSessionRequest(
  value: unknown,
): UpdateInteractiveSketchSolveSessionRequest {
  return requireContract(
    updateInteractiveSketchSolveSessionRequestValidator,
    value,
    "Update interactive sketch solve session request",
  );
}

export function validateFinalizeInteractiveSketchSolveSessionRequest(
  value: unknown,
): ContractValidationResult<FinalizeInteractiveSketchSolveSessionRequest> {
  return validateContract(
    finalizeInteractiveSketchSolveSessionRequestValidator,
    value,
  );
}

export function requireFinalizeInteractiveSketchSolveSessionRequest(
  value: unknown,
): FinalizeInteractiveSketchSolveSessionRequest {
  return requireContract(
    finalizeInteractiveSketchSolveSessionRequestValidator,
    value,
    "Finalize interactive sketch solve session request",
  );
}

export function validateDisposeInteractiveSketchSolveSessionRequest(
  value: unknown,
): ContractValidationResult<DisposeInteractiveSketchSolveSessionRequest> {
  return validateContract(
    disposeInteractiveSketchSolveSessionRequestValidator,
    value,
  );
}

export function requireDisposeInteractiveSketchSolveSessionRequest(
  value: unknown,
): DisposeInteractiveSketchSolveSessionRequest {
  return requireContract(
    disposeInteractiveSketchSolveSessionRequestValidator,
    value,
    "Dispose interactive sketch solve session request",
  );
}

export function validateDeriveSketchRegionsRequest(
  value: unknown,
): ContractValidationResult<DeriveSketchRegionsRequest> {
  return validateContract(deriveSketchRegionsRequestValidator, value);
}

export function requireDeriveSketchRegionsRequest(
  value: unknown,
): DeriveSketchRegionsRequest {
  return requireContract(
    deriveSketchRegionsRequestValidator,
    value,
    "Derive sketch regions request",
  );
}

export function validateResolveSketchReferenceRequest(
  value: unknown,
): ContractValidationResult<ResolveSketchReferenceRequest> {
  return validateContract(resolveSketchReferenceRequestValidator, value);
}

export function requireResolveSketchReferenceRequest(
  value: unknown,
): ResolveSketchReferenceRequest {
  return requireContract(
    resolveSketchReferenceRequestValidator,
    value,
    "Resolve sketch reference request",
  );
}
