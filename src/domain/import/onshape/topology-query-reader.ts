import type { OnshapeResolvedQueryReference } from "@/contracts/import/onshape-capture-bundle";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";

export interface TopologyQuerySlot {
  key: string;
  parameterId: string;
  role: "body" | "targetBody" | "toolBody" | "face" | "edge" | "plane" | "axis";
  expectedKinds: readonly ("body" | "face" | "edge" | "vertex" | "construction")[];
  cardinality: { min: number; max: number | null };
}

export interface OnshapeTopologyQueryRef {
  consumerFeatureId: string;
  slotKey: string;
  parameterId: string;
  queryIndex: number;
  deterministicId: string;
  queryString: string | null;
  queryEvidenceIndex?: number;
  expectedKinds: TopologyQuerySlot["expectedKinds"];
}

export interface TopologyQueryReadDiagnostic {
  code: "topology-query-unreadable";
  consumerFeatureId: string;
  slotKey: string;
  parameterId: string;
  message: string;
}

export interface TopologyQueryReadResult {
  refs: readonly OnshapeTopologyQueryRef[];
  diagnostics: readonly TopologyQueryReadDiagnostic[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** Read only translator-declared active query slots; no recursive query discovery occurs. */
export function readTopologyQueryRefs(
  feature: OnshapeFeatureNode,
  slots: readonly TopologyQuerySlot[],
  capturedQueryReferences: readonly OnshapeResolvedQueryReference[] = [],
): TopologyQueryReadResult {
  const refs: OnshapeTopologyQueryRef[] = [];
  const diagnostics: TopologyQueryReadDiagnostic[] = [];
  const parameters = Array.isArray(feature.parameters) ? feature.parameters : [];
  const seen = new Set<string>();
  const countBySlot = new Map<string, number>();

  for (const slot of slots) {
    const parameter = parameters
      .map(asRecord)
      .find((candidate) => candidate?.parameterId === slot.parameterId);
    if (!parameter || !Array.isArray(parameter.queries)) {
      diagnostics.push({
        code: "topology-query-unreadable",
        consumerFeatureId: feature.featureId,
        slotKey: slot.key,
        parameterId: slot.parameterId,
        message: `Required query parameter ${slot.parameterId} is missing or malformed.`,
      });
      continue;
    }

    for (const [queryIndex, rawQuery] of parameter.queries.entries()) {
      const query = asRecord(rawQuery);
      if (!query || !Array.isArray(query.deterministicIds)) {
        diagnostics.push({
          code: "topology-query-unreadable",
          consumerFeatureId: feature.featureId,
          slotKey: slot.key,
          parameterId: slot.parameterId,
          message: `Query ${queryIndex} in ${slot.parameterId} has no readable deterministicIds array.`,
        });
        continue;
      }
      if (query.deterministicIds.length === 0) {
        const evidence = capturedQueryReferences.filter(
          (reference) =>
            reference.consumingFeatureId === feature.featureId &&
            reference.parameterId === slot.parameterId &&
            reference.queryIndex === queryIndex,
        );
        const resolvedEvidence = evidence.filter(
          (reference): reference is Extract<OnshapeResolvedQueryReference, { signature: unknown }> =>
            "signature" in reference,
        );
        if (resolvedEvidence.length === 0) {
          const unresolved = evidence.find(
            (reference): reference is Extract<OnshapeResolvedQueryReference, { unresolved: unknown }> =>
              "unresolved" in reference,
          );
          diagnostics.push({
            code: "topology-query-unreadable",
            consumerFeatureId: feature.featureId,
            slotKey: slot.key,
            parameterId: slot.parameterId,
            message: unresolved
              ? `Query ${queryIndex} in ${slot.parameterId} could not be evaluated: ${unresolved.unresolved.reason}.`
              : `Query ${queryIndex} in ${slot.parameterId} contains no deterministic IDs or captured query evidence.`,
          });
          continue;
        }
        for (const reference of resolvedEvidence) {
          const deterministicId = `captured-query:${feature.featureId}:${slot.parameterId}:${queryIndex}:${reference.entityIndex}`;
          const duplicateKey = `${slot.role}\u0000${deterministicId}`;
          if (seen.has(duplicateKey)) continue;
          seen.add(duplicateKey);
          countBySlot.set(slot.key, (countBySlot.get(slot.key) ?? 0) + 1);
          refs.push({
            consumerFeatureId: feature.featureId,
            slotKey: slot.key,
            parameterId: slot.parameterId,
            queryIndex,
            deterministicId,
            queryString: typeof query.queryString === "string" ? query.queryString : null,
            queryEvidenceIndex: reference.entityIndex,
            expectedKinds: slot.expectedKinds,
          });
        }
        continue;
      }
      for (const deterministicId of query.deterministicIds) {
        if (typeof deterministicId !== "string" || deterministicId.length === 0) {
          diagnostics.push({
            code: "topology-query-unreadable",
            consumerFeatureId: feature.featureId,
            slotKey: slot.key,
            parameterId: slot.parameterId,
            message: `Query ${queryIndex} in ${slot.parameterId} contains a malformed deterministic ID.`,
          });
          continue;
        }
        // Parameter aliases can encode one semantic role twice (for example deleteBodies).
        const duplicateKey = `${slot.role}\u0000${deterministicId}`;
        if (seen.has(duplicateKey)) continue;
        seen.add(duplicateKey);
        countBySlot.set(slot.key, (countBySlot.get(slot.key) ?? 0) + 1);
        refs.push({
          consumerFeatureId: feature.featureId,
          slotKey: slot.key,
          parameterId: slot.parameterId,
          queryIndex,
          deterministicId,
          queryString: typeof query.queryString === "string" ? query.queryString : null,
          expectedKinds: slot.expectedKinds,
        });
      }
    }
  }

  for (const slot of slots) {
    const count = countBySlot.get(slot.key) ?? 0;
    if (count < slot.cardinality.min || (slot.cardinality.max !== null && count > slot.cardinality.max)) {
      diagnostics.push({
        code: "topology-query-unreadable",
        consumerFeatureId: feature.featureId,
        slotKey: slot.key,
        parameterId: slot.parameterId,
        message: `Slot ${slot.key} resolved ${count} IDs; expected ${slot.cardinality.min}..${slot.cardinality.max ?? "unbounded"}.`,
      });
    }
  }

  return { refs, diagnostics };
}
