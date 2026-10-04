import typia from "typia";

import type {
  ProjectedSketchGeometryRef,
  RegionRecord,
  SketchDefinition,
  SketchRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type {
  SketchEntityRef,
  SketchPointRef,
} from "@/contracts/shared/references";
import type { RequestId } from "@/contracts/shared/ids";
import {
  ContractValidationError,
  validateContract,
  type ContractValidationIssue,
  type ContractValidationResult,
} from "@/contracts/shared/validation";
import { validateReferenceImageOperationStateInvariants } from "@/contracts/reference-image/runtime-schema";
import { isAuthoredValue } from "@/contracts/modeling/authored-values";

export type ProjectedReferenceRequestTarget =
  | ProjectedSketchGeometryRef
  | SketchEntityRef
  | SketchPointRef;

const sketchDefinitionValidator =
  typia.createValidateEquals<SketchDefinition>();
const sketchRecordValidator = typia.createValidateEquals<SketchRecord>();
const solvedSketchSnapshotValidator =
  typia.createValidateEquals<SolvedSketchSnapshot>();
const projectedReferenceRequestTargetValidator =
  typia.createValidateEquals<ProjectedReferenceRequestTarget>();
const solverRegionRecordValidator = typia.createValidateEquals<RegionRecord>();
const solverRequestIdValidator = typia.createValidateEquals<RequestId>();

/**
 * T08b-g5: v1alpha1 payloads (and with them the fit-point/refit offset
 * outputs) are rejected explicitly, never migrated.
 */
function retiredVersionIssues(
  value: unknown,
  path: string,
  retired: string,
): ContractValidationIssue[] {
  const version =
    typeof value === "object" && value !== null
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  return version === retired
    ? [
        {
          path: path ? `${path}.schemaVersion` : "schemaVersion",
          expected: retired.replace("v1alpha1", "v1alpha2"),
          value: version,
          message: `Unsupported sketch payload version ${retired}: this payload predates certified offset outputs and cannot be opened; there is no migration.`,
        },
      ]
    : [];
}

function retired<T>(
  issues: ContractValidationIssue[],
  value: unknown,
): ContractValidationResult<T> | null {
  return issues.length > 0 ? { success: false, data: value, issues } : null;
}

export function validateSketchDefinition(
  value: unknown,
): ContractValidationResult<SketchDefinition> {
  const rejected = retired<SketchDefinition>(
    retiredVersionIssues(value, "", "sketch-definition/v1alpha1"),
    value,
  );
  if (rejected) return rejected;
  const result = validateContract(sketchDefinitionValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateSketchDefinitionInvariants(result.data);
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function requireSketchDefinition(value: unknown): SketchDefinition {
  return requireValidationResult(
    validateSketchDefinition(value),
    value,
    "Sketch definition",
  );
}

export function validateSketchRecord(
  value: unknown,
): ContractValidationResult<SketchRecord> {
  const record =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<"definition" | "solvedSnapshot", unknown>>)
      : {};
  const rejected = retired<SketchRecord>(
    [
      ...retiredVersionIssues(
        record.definition,
        "definition",
        "sketch-definition/v1alpha1",
      ),
      ...retiredVersionIssues(
        record.solvedSnapshot,
        "solvedSnapshot",
        "solved-sketch/v1alpha1",
      ),
    ],
    value,
  );
  if (rejected) return rejected;
  const result = validateContract(sketchRecordValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = [
    ...prefixIssues(
      "definition",
      validateSketchDefinitionInvariants(result.data.definition),
    ),
    ...prefixIssues(
      "solvedSnapshot",
      validateSolvedSketchSnapshotInvariants(result.data.solvedSnapshot),
    ),
  ];
  invariantIssues.push(
    ...prefixIssues(
      "solvedSnapshot",
      validateOffsetFramePlanReferences(
        result.data.definition,
        result.data.solvedSnapshot,
      ),
    ),
  );
  if (
    result.data.derivedValidity.state !== "current" &&
    result.data.regions.length > 0
  ) {
    invariantIssues.push({
      path: "regions",
      expected: "no consumable regions for invalid or stale derivation",
      value: result.data.regions,
      message: "Invalid or stale sketch derivation cannot expose regions.",
    });
  }
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function requireSketchRecord(value: unknown): SketchRecord {
  return requireValidationResult(
    validateSketchRecord(value),
    value,
    "Sketch record",
  );
}

export function validateSolvedSketchSnapshot(
  value: unknown,
): ContractValidationResult<SolvedSketchSnapshot> {
  const rejected = retired<SolvedSketchSnapshot>(
    retiredVersionIssues(value, "", "solved-sketch/v1alpha1"),
    value,
  );
  if (rejected) return rejected;
  const result = validateContract(solvedSketchSnapshotValidator, value);
  if (!result.success) {
    return result;
  }

  const invariantIssues = validateSolvedSketchSnapshotInvariants(result.data);
  return invariantIssues.length === 0
    ? result
    : {
        success: false,
        data: result.data,
        issues: invariantIssues,
      };
}

export function requireSolvedSketchSnapshot(
  value: unknown,
): SolvedSketchSnapshot {
  return requireValidationResult(
    validateSolvedSketchSnapshot(value),
    value,
    "Solved sketch snapshot",
  );
}

export function validateProjectedReferenceRequestTarget(
  value: unknown,
): ContractValidationResult<ProjectedReferenceRequestTarget> {
  return validateContract(projectedReferenceRequestTargetValidator, value);
}

export function validateSolverRegionRecord(
  value: unknown,
): ContractValidationResult<RegionRecord> {
  return validateContract(solverRegionRecordValidator, value);
}

export function validateSolverRequestId(
  value: unknown,
): ContractValidationResult<RequestId> {
  return validateContract(solverRequestIdValidator, value);
}

function validateSketchDefinitionInvariants(definition: SketchDefinition) {
  const issues: {
    path: string;
    expected: string;
    value: unknown;
    message: string;
  }[] = [];

  definition.entities.forEach((entity, index) => {
    if (entity.kind === "circle" && entity.radius <= 0) {
      issues.push({
        path: `entities.${index}.radius`,
        expected: "positive number",
        value: entity.radius,
        message: "Sketch circle radius must be positive.",
      });
    }

    if ("minorRadius" in entity && entity.minorRadius <= 0) {
      issues.push({
        path: `entities.${index}.minorRadius`,
        expected: "positive number",
        value: entity.minorRadius,
        message: "Sketch entity minor radius must be positive.",
      });
    }

    if (entity.kind === "conic" && entity.rho <= 0) {
      issues.push({
        path: `entities.${index}.rho`,
        expected: "positive number",
        value: entity.rho,
        message: "Sketch conic rho must be positive.",
      });
    }

    if (entity.kind === "spline") {
      const occurrenceIds = entity.pointOccurrences.map(
        (occurrence) => occurrence.occurrenceId,
      );
      if (
        entity.pointOccurrenceIds.length !== occurrenceIds.length ||
        new Set(entity.pointOccurrenceIds).size !==
          entity.pointOccurrenceIds.length ||
        entity.pointOccurrenceIds.some((id) => !occurrenceIds.includes(id)) ||
        new Set(occurrenceIds).size !== occurrenceIds.length
      ) {
        issues.push({
          path: `entities.${index}.pointOccurrenceIds`,
          expected: "a unique order bijective with pointOccurrences",
          value: entity.pointOccurrenceIds,
          message:
            "Spline occurrence order must be bijective with stable occurrence records.",
        });
      }
      // T10g (A-7): only the shape is structural here; the values are
      // judged by reconstructSpline, so a bad value is an invalid spline.
      const fixed = entity.endSpanParameterLengths;
      if (fixed && fixed.start === undefined && fixed.end === undefined) {
        issues.push({
          path: `entities.${index}.endSpanParameterLengths`,
          expected: "start and/or end",
          value: fixed,
          message:
            "Spline end-span parameter lengths must set start, end, or both; omit the field otherwise.",
        });
      }
    }

    if (entity.kind === "profileText") {
      if (entity.text.trim().length === 0) {
        issues.push({
          path: `entities.${index}.text`,
          expected: "non-empty text",
          value: entity.text,
          message: "Sketch profile text must not be empty.",
        });
      }

      if (entity.height <= 0) {
        issues.push({
          path: `entities.${index}.height`,
          expected: "positive number",
          value: entity.height,
          message: "Sketch profile text height must be positive.",
        });
      }
    }
  });

  definition.derivedRelationships?.forEach((relationship, index) => {
    if (relationship.kind !== "offset") {
      return;
    }

    const distance: unknown = relationship.distance;
    const isNumericDistance =
      typeof distance === "number" && Number.isFinite(distance);
    const isAuthoredDistance =
      isAuthoredValue(distance) &&
      (distance.source === "expression"
        ? typeof distance.valueText === "string"
        : typeof distance.value === "number" &&
          Number.isFinite(distance.value));
    if (!isNumericDistance && !isAuthoredDistance) {
      issues.push({
        path: `derivedRelationships.${index}.distance`,
        expected: "finite number or authored literal/expression value",
        value: distance,
        message:
          "Offset derivation distance must be a finite number or an authored literal/expression value.",
      });
    }
  });

  issues.push(...validateOffsetShellInvariants(definition));

  const pointIds = new Set(definition.points.map((point) => point.pointId));
  const entityIds = new Set(
    definition.entities.map((entity) => entity.entityId),
  );
  definition.entities.forEach((entity, entityIndex) => {
    if (entity.kind !== "spline") return;
    entity.pointOccurrences.forEach((occurrence, occurrenceIndex) => {
      if (!pointIds.has(occurrence.pointId)) {
        issues.push({
          path: `entities.${entityIndex}.pointOccurrences.${occurrenceIndex}.pointId`,
          expected: "an existing canonical sketch point",
          value: occurrence.pointId,
          message: "Spline occurrences must reference canonical sketch points.",
        });
      }
    });
  });
  const imageOwnedPointIds = new Set<string>();
  const imageOwnedEntityIds = new Set<string>();
  definition.referenceImages?.forEach((record, index) => {
    record.ownedPointIds.forEach((pointId, ownedIndex) => {
      if (!pointIds.has(pointId) || imageOwnedPointIds.has(pointId)) {
        issues.push({
          path: `referenceImages.${index}.ownedPointIds.${ownedIndex}`,
          expected: "an existing point owned by only this reference image",
          value: pointId,
          message:
            "Reference-image point ownership must identify an existing, uniquely owned point.",
        });
      }
      imageOwnedPointIds.add(pointId);
    });
    record.ownedEntityIds.forEach((entityId, ownedIndex) => {
      if (!entityIds.has(entityId) || imageOwnedEntityIds.has(entityId)) {
        issues.push({
          path: `referenceImages.${index}.ownedEntityIds.${ownedIndex}`,
          expected: "an existing entity owned by only this reference image",
          value: entityId,
          message:
            "Reference-image entity ownership must identify an existing, uniquely owned entity.",
        });
      }
      imageOwnedEntityIds.add(entityId);
    });
    issues.push(
      ...prefixIssues(
        `referenceImages.${index}.ownedState`,
        validateReferenceImageOperationStateInvariants(record.ownedState),
      ),
    );
  });

  return issues;
}

/**
 * Persistence invariants of derived offset shells ([TECH] G18, amending plan
 * §2.6): only structure that does not depend on seed geometry. Exactly one
 * owning offset relationship per shell, with a matching `derivationId`;
 * unique output span ids per output; spline seeds have no fit-point
 * `outputs` entry; a shell's driven terminal points exist and are owned by
 * its relationship only (never a seed point or another relationship's
 * output; adjacent outputs of one chain share their joint point, G6); a
 * shell is never the seed of an offset, mirror, pattern or transform; a
 * relationship never names a missing shell (deleting a shell alone is
 * invalid). Seed existence and the span keys' match with the seed's source
 * occurrence pairs are NOT invariants: a deleted or edited seed is a valid
 * authored state that evaluation reports (missing dependency /
 * `topologyChanged`) while the authored data is kept.
 */
function validateOffsetShellInvariants(
  definition: SketchDefinition,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  const entities = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const pointIds = new Set(definition.points.map((point) => point.pointId));
  const relationships = definition.derivedRelationships ?? [];
  const owners = new Map<string, string[]>();
  const issue = (
    path: string,
    expected: string,
    value: unknown,
    message: string,
  ) => issues.push({ path, expected, value, message });
  relationships.forEach((relationship, index) => {
    relationship.seedEntityIds.forEach((seedId, seedIndex) => {
      if (entities.get(seedId)?.kind === "derivedPiecewiseCubic")
        issue(
          `derivedRelationships.${index}.seedEntityIds.${seedIndex}`,
          "a seed that is not a derived offset shell",
          seedId,
          "A derived offset shell cannot be the seed of an offset, mirror, pattern or transform.",
        );
    });
    if (relationship.kind !== "offset") return;
    relationship.outputs.forEach((output, outputIndex) => {
      if (entities.get(output.seedEntityId)?.kind === "spline")
        issue(
          `derivedRelationships.${index}.outputs.${outputIndex}`,
          "spline seeds publish only a derived shell",
          output.seedEntityId,
          "An offset spline seed has no fit-point output; its output is a derived shell.",
        );
    });
    const otherPoints = new Set<string>([
      ...relationship.seedEntityIds.flatMap((seedId) => {
        const seed = entities.get(seedId);
        return seed?.kind === "spline"
          ? seed.pointOccurrences.map((occurrence) => occurrence.pointId)
          : seed && "startPointId" in seed
            ? [seed.startPointId, seed.endPointId]
            : [];
      }),
      ...relationships
        .filter((other) => other !== relationship)
        .flatMap((other) => [
          ...other.outputs.flatMap((output) => output.outputPointIds),
          ...(other.kind === "offset"
            ? other.piecewiseCubicOutputs.flatMap((output) => [
                output.startPointId,
                output.endPointId,
              ])
            : []),
        ]),
    ]);
    relationship.piecewiseCubicOutputs.forEach((output, outputIndex) => {
      const path = `derivedRelationships.${index}.piecewiseCubicOutputs.${outputIndex}`;
      const shell = entities.get(output.outputEntityId);
      if (shell?.kind !== "derivedPiecewiseCubic") {
        issue(
          `${path}.outputEntityId`,
          "an existing derived offset shell",
          output.outputEntityId,
          "An offset shell output must name an existing derived shell entity (a shell is deleted with its relationship).",
        );
      } else {
        (
          owners.get(shell.entityId) ??
          owners.set(shell.entityId, []).get(shell.entityId)!
        ).push(relationship.derivationId);
        if (shell.derivationId !== relationship.derivationId)
          issue(
            `${path}.outputEntityId`,
            "a shell whose derivationId is its owning relationship",
            shell.derivationId,
            "A derived offset shell's derivationId must be its owning offset relationship.",
          );
      }
      const spanIds = output.spans.map((span) => span.outputSpanId);
      if (new Set(spanIds).size !== spanIds.length)
        issue(
          `${path}.spans`,
          "unique output span ids",
          output.spans,
          "Derived shell output span ids must be unique.",
        );
      for (const pointId of [output.startPointId, output.endPointId])
        if (!pointIds.has(pointId))
          issue(
            `${path}`,
            "an existing driven terminal point",
            pointId,
            "A derived shell's driven terminal point must exist (it is deleted only with its relationship).",
          );
        else if (otherPoints.has(pointId))
          issue(
            `${path}`,
            "driven terminal points owned by this relationship only",
            pointId,
            "A derived shell's driven terminal point must not be a seed point or another relationship's output.",
          );
    });
  });
  definition.entities.forEach((entity, index) => {
    if (entity.kind !== "derivedPiecewiseCubic") return;
    const owning = owners.get(entity.entityId) ?? [];
    if (owning.length !== 1)
      issue(
        `entities.${index}`,
        "exactly one owning offset relationship",
        owning,
        "A derived offset shell must be owned by exactly one offset relationship.",
      );
  });
  return issues;
}

/** [TECH] G17: solved plans reference existing offset relationships, once each. */
function validateOffsetFramePlanReferences(
  definition: SketchDefinition,
  snapshot: SolvedSketchSnapshot,
): ContractValidationIssue[] {
  const offsets = new Set(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset" ? [relationship.derivationId] : [],
    ),
  );
  return [
    ...(snapshot.offsetFramePlans ?? []).flatMap((record, index) =>
      offsets.has(record.derivationId)
        ? []
        : [
            {
              path: `offsetFramePlans.${index}.derivationId`,
              expected: "an existing offset relationship",
              value: record.derivationId,
              message:
                "A solved offset frame plan must reference an existing offset relationship.",
            },
          ],
    ),
    // [TECH] G19a: certified relationships exist.
    ...(snapshot.certifiedOffsetDerivationIds ?? []).flatMap(
      (derivationId, index) =>
        offsets.has(derivationId)
          ? []
          : [
              {
                path: `certifiedOffsetDerivationIds.${index}`,
                expected: "an existing offset relationship",
                value: derivationId,
                message:
                  "A certified offset relationship id must reference an existing offset relationship.",
              },
            ],
    ),
  ];
}

function validateSolvedSketchSnapshotInvariants(
  snapshot: SolvedSketchSnapshot,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  const planIds = (snapshot.offsetFramePlans ?? []).map(
    (record) => record.derivationId,
  );
  if (new Set(planIds).size !== planIds.length)
    issues.push({
      path: "offsetFramePlans",
      expected: "one plan per offset relationship",
      value: planIds,
      message: "Solved offset frame plans must name each relationship once.",
    });
  const certifiedIds = snapshot.certifiedOffsetDerivationIds ?? [];
  if (new Set(certifiedIds).size !== certifiedIds.length)
    issues.push({
      path: "certifiedOffsetDerivationIds",
      expected: "unique certified offset relationship ids",
      value: certifiedIds,
      message:
        "Certified offset relationship ids must name each relationship once.",
    });

  snapshot.solvedEntities.forEach((entity, index) => {
    if (entity.kind === "circle" && entity.solvedRadius <= 0) {
      issues.push({
        path: `solvedEntities.${index}.solvedRadius`,
        expected: "positive number",
        value: entity.solvedRadius,
        message: "Solved sketch circle radius must be positive.",
      });
    }

    if ("minorRadius" in entity && entity.minorRadius <= 0) {
      issues.push({
        path: `solvedEntities.${index}.minorRadius`,
        expected: "positive number",
        value: entity.minorRadius,
        message: "Solved sketch entity minor radius must be positive.",
      });
    }

    if (entity.kind === "conic" && entity.rho <= 0) {
      issues.push({
        path: `solvedEntities.${index}.rho`,
        expected: "positive number",
        value: entity.rho,
        message: "Solved sketch conic rho must be positive.",
      });
    }

    if (entity.kind === "profileText") {
      if (entity.text.trim().length === 0) {
        issues.push({
          path: `solvedEntities.${index}.text`,
          expected: "non-empty text",
          value: entity.text,
          message: "Solved sketch profile text must not be empty.",
        });
      }

      if (entity.height <= 0) {
        issues.push({
          path: `solvedEntities.${index}.height`,
          expected: "positive number",
          value: entity.height,
          message: "Solved sketch profile text height must be positive.",
        });
      }
    }
  });

  return issues;
}

function prefixIssues(
  prefix: string,
  issues: readonly ContractValidationIssue[],
): ContractValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path ? `${prefix}.${issue.path}` : prefix,
  }));
}

function requireValidationResult<T>(
  result: ContractValidationResult<T>,
  value: unknown,
  label: string,
): T {
  if (result.success) {
    return result.data;
  }

  const firstIssue = result.issues[0];
  throw new ContractValidationError(
    firstIssue?.message ?? `${label} validation failed.`,
    value,
    result.issues,
  );
}
