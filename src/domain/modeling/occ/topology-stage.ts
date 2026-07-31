import type { FeatureId } from "@/contracts/shared/ids";
import type { DocumentHistoryOrderEntry } from "@/domain/modeling/document-history";
import type { DurableRef } from "@/contracts/shared/references";
import type {
  AuthoredFeatureTopologyLineage,
  AuthoredTopologyLineageTarget,
} from "@/contracts/modeling/authored-document";
import type { OccTrackedBody } from "@/domain/modeling/occ/topology";
import type { BodyId, EdgeId, FaceId, VertexId } from "@/contracts/shared/ids";
import { getOccDurableRefKey } from "@/domain/modeling/occ/topology";

export type OccTopologySourceKey = string;
export type OccTopologyOutputSlot = OccTrackedBody["bodyId"];

export interface OccTopologyStageOutput {
  outputSlot: OccTopologyOutputSlot;
  body: OccTrackedBody;
  sourceTargets: ReadonlyMap<OccTopologySourceKey, readonly DurableRef[]>;
  unsupportedSourceKeys: ReadonlySet<OccTopologySourceKey>;
}

export interface OccFeatureTopologyStage {
  featureId: FeatureId;
  outputs: ReadonlyMap<OccTopologyOutputSlot, OccTopologyStageOutput>;
}

export type OccFeatureTopologyStageMap = ReadonlyMap<
  FeatureId,
  OccFeatureTopologyStage
>;

export type OccFeatureTopologyLineageMap = ReadonlyMap<
  FeatureId,
  AuthoredFeatureTopologyLineage
>;

export type OccCanonicalTopologyProvenanceId = string;

/** A live topology target has no authored producer claim before the requested feature. */
export class OccTopologyProvenanceMissingError extends Error {
  readonly code = "occ-topology-provenance-missing";

  constructor(targetKey: string) {
    super(`occ-topology-provenance-missing: ${targetKey}.`);
    this.name = "OccTopologyProvenanceMissingError";
  }
}

/**
 * True for the structured provenance-resolution outcomes the index throws
 * (missing, remintable root, ambiguous, cyclic, future-stage, malformed key).
 * Callers that skip an unresolvable source must still propagate genuine faults.
 */
export function isOccTopologyProvenanceResolutionError(
  error: unknown,
): boolean {
  return (
    error instanceof OccTopologyProvenanceMissingError ||
    (error instanceof Error &&
      error.message.startsWith("occ-topology-provenance-"))
  );
}

export interface OccTopologyProvenanceIndex {
  /** Resolve a live face only through exact authored topology lineage. */
  resolveFace(
    target: Extract<DurableRef, { kind: "face" }>,
  ): OccCanonicalTopologyProvenanceId;
}

type ProvenanceSubtopologyRef = Extract<
  DurableRef,
  { kind: "face" | "edge" | "vertex" }
>;

type ProvenanceStageOutput = Pick<
  OccTopologyStageOutput,
  "outputSlot" | "sourceTargets" | "unsupportedSourceKeys"
>;

interface ProvenanceClaim {
  featureId: FeatureId;
  featureIndex: number;
  sourceKey: OccTopologySourceKey;
  unsupported: boolean;
}

function persistedProvenanceOutputs(
  lineage: AuthoredFeatureTopologyLineage,
): ProvenanceStageOutput[] {
  return lineage.outputs.map((output) => ({
    outputSlot: output.outputSlot,
    sourceTargets: new Map(
      output.sourceTargets.map((entry) => [entry.sourceKey, entry.targets]),
    ),
    unsupportedSourceKeys: new Set(output.unsupportedSourceKeys),
  }));
}

function parseSubtopologyRefKey(key: string): ProvenanceSubtopologyRef | null {
  const match = /^(face|edge|vertex):([^:]+):([^:]+)$/.exec(key);
  if (!match) return null;
  const [, kind, bodyId, publicId] = match;
  if (kind === "face") {
    return { kind, bodyId: bodyId as BodyId, faceId: publicId as FaceId };
  }
  if (kind === "edge") {
    return { kind, bodyId: bodyId as BodyId, edgeId: publicId as EdgeId };
  }
  return { kind: "vertex", bodyId: bodyId as BodyId, vertexId: publicId as VertexId };
}

function splitAdjacentSourceKeys(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) {
      throw new Error("occ-topology-provenance-malformed-source-key: unbalanced adjacency key.");
    }
    if (character === "+" && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) {
    throw new Error("occ-topology-provenance-malformed-source-key: unbalanced adjacency key.");
  }
  parts.push(value.slice(start));
  if (parts.some((part) => part.length === 0)) {
    throw new Error("occ-topology-provenance-malformed-source-key: empty adjacency source.");
  }
  return parts;
}

function parseGeneratedAdjacencySourceKey(sourceKey: string) {
  const prefix = "generated-from:";
  if (!sourceKey.startsWith(prefix)) return null;
  const featureEnd = sourceKey.indexOf(":", prefix.length);
  const bodyEnd = sourceKey.indexOf(":", featureEnd + 1);
  const adjacencyStart = bodyEnd + 1;
  if (
    featureEnd < 0 ||
    bodyEnd < 0 ||
    !sourceKey.startsWith("adjacent(", adjacencyStart)
  ) {
    return null;
  }

  let depth = 0;
  let adjacencyEnd = -1;
  for (let index = adjacencyStart + "adjacent".length; index < sourceKey.length; index += 1) {
    if (sourceKey[index] === "(") depth += 1;
    if (sourceKey[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        adjacencyEnd = index;
        break;
      }
    }
  }
  if (adjacencyEnd < 0 || sourceKey[adjacencyEnd + 1] !== ":") {
    throw new Error(
      `occ-topology-provenance-malformed-source-key: ${sourceKey}.`,
    );
  }

  const featureId = sourceKey.slice(prefix.length, featureEnd) as FeatureId;
  const bodyId = sourceKey.slice(featureEnd + 1, bodyEnd) as BodyId;
  const adjacent = sourceKey.slice(
    adjacencyStart + "adjacent(".length,
    adjacencyEnd,
  );
  const role = sourceKey.slice(adjacencyEnd + 2);
  if (!featureId || !bodyId || !adjacent || !role) {
    throw new Error(
      `occ-topology-provenance-malformed-source-key: ${sourceKey}.`,
    );
  }
  return {
    featureId,
    bodyId,
    adjacentSourceKeys: splitAdjacentSourceKeys(adjacent),
    role,
  };
}

function canonicalOperandProvenanceIsRemintable(value: string) {
  return (
    /(?:^|:)(?:face|edge|vertex):body_[^:]+:(?:face|edge|vertex)_[^:]+/.test(
      value,
    ) || /(?:^|:)t\d+(?::|$)/.test(value)
  );
}

function parseMirrorOperandSourceKey(sourceKey: string) {
  const match = /^mirror-operand:([^:]+):([^:]+):(right|mixed):(.+)$/.exec(
    sourceKey,
  );
  if (!match) return null;
  const [, featureId, bodyId, role, encodedSources] = match;
  const sourceCanonicalProvenanceIds = encodedSources!.split("+").map((value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      throw new Error(`occ-topology-provenance-malformed-source-key: ${sourceKey}.`);
    }
  });
  if (
    !featureId ||
    !bodyId ||
    sourceCanonicalProvenanceIds.some(
      (value) => value.length === 0 || canonicalOperandProvenanceIsRemintable(value),
    ) ||
    new Set(sourceCanonicalProvenanceIds).size !== sourceCanonicalProvenanceIds.length
  ) {
    throw new Error(`occ-topology-provenance-malformed-source-key: ${sourceKey}.`);
  }
  return {
    featureId: featureId as FeatureId,
    bodyId: bodyId as BodyId,
    role: role as "right" | "mixed",
    sourceCanonicalProvenanceIds,
  };
}

function parseRelationshipSourceKey(sourceKey: string):
  | {
      kind: "exact" | "boolean";
      featureId: FeatureId;
      source: ProvenanceSubtopologyRef;
    }
  | {
      kind: "generated";
      featureId: FeatureId;
      bodyId: BodyId;
      source: ProvenanceSubtopologyRef;
      role: string;
    }
  | {
      kind: "generatedAdjacency";
      featureId: FeatureId;
      bodyId: BodyId;
      adjacentSourceKeys: readonly string[];
      role: string;
    }
  | {
      kind: "mirrorOperand";
      featureId: FeatureId;
      bodyId: BodyId;
      role: "right" | "mixed";
      sourceCanonicalProvenanceIds: readonly string[];
    }
  | { kind: "root" } {
  const exact = /^exact-successor:([^:]+):([^:]+):(face|edge|vertex):([^:]+)$/.exec(
    sourceKey,
  );
  if (exact) {
    const source = parseSubtopologyRefKey(
      `${exact[3]}:${exact[2]}:${exact[4]}`,
    )!;
    return { kind: "exact", featureId: exact[1] as FeatureId, source };
  }
  if (sourceKey.startsWith("exact-successor:")) {
    throw new Error(`occ-topology-provenance-malformed-source-key: ${sourceKey}.`);
  }

  const boolean = /^boolean:([^:]+):input:(face|edge|vertex):([^:]+):([^:]+)$/.exec(
    sourceKey,
  );
  if (boolean) {
    const source = parseSubtopologyRefKey(
      `${boolean[2]}:${boolean[3]}:${boolean[4]}`,
    )!;
    return { kind: "boolean", featureId: boolean[1] as FeatureId, source };
  }
  if (sourceKey.startsWith("boolean:")) {
    throw new Error(`occ-topology-provenance-malformed-source-key: ${sourceKey}.`);
  }

  const mirrorOperand = parseMirrorOperandSourceKey(sourceKey);
  if (mirrorOperand) {
    return { kind: "mirrorOperand", ...mirrorOperand };
  }
  if (sourceKey.startsWith("mirror-operand:")) {
    throw new Error(`occ-topology-provenance-malformed-source-key: ${sourceKey}.`);
  }

  const adjacency = parseGeneratedAdjacencySourceKey(sourceKey);
  if (adjacency) {
    return { kind: "generatedAdjacency", ...adjacency };
  }
  const generated = /^generated-from:([^:]+):([^:]+):(face|edge|vertex):([^:]+):(.+)$/.exec(
    sourceKey,
  );
  if (generated) {
    const source = parseSubtopologyRefKey(
      `${generated[3]}:${generated[2]}:${generated[4]}`,
    )!;
    return {
      kind: "generated",
      featureId: generated[1] as FeatureId,
      bodyId: generated[2] as BodyId,
      source,
      role: generated[5]!,
    };
  }
  if (sourceKey.startsWith("generated-from:")) {
    throw new Error(`occ-topology-provenance-malformed-source-key: ${sourceKey}.`);
  }

  if (sourceKey.length === 0) {
    throw new Error("occ-topology-provenance-malformed-source-key: empty source key.");
  }
  return { kind: "root" };
}

/**
 * Build a transient index from current stages, falling back to serialized
 * lineage only for features that have not produced a current stage yet.
 * Canonical ids are derived exclusively from exact source-key relationships.
 */
export function createOccTopologyProvenanceIndex(input: {
  stages: OccFeatureTopologyStageMap;
  previousLineage: OccFeatureTopologyLineageMap;
  historyOrder: readonly DocumentHistoryOrderEntry[];
  beforeFeatureId?: FeatureId;
}): OccTopologyProvenanceIndex {
  const featureIndex = new Map<FeatureId, number>();
  for (const [index, entry] of input.historyOrder.entries()) {
    if (entry.kind !== "feature") continue;
    if (featureIndex.has(entry.featureId)) {
      throw new Error(
        `occ-topology-provenance-malformed-history: duplicate feature ${entry.featureId}.`,
      );
    }
    featureIndex.set(entry.featureId, index);
  }
  const beforeIndex = input.beforeFeatureId
    ? featureIndex.get(input.beforeFeatureId)
    : undefined;
  if (input.beforeFeatureId && beforeIndex === undefined) {
    throw new Error(
      `occ-topology-provenance-missing-history-feature: ${input.beforeFeatureId}.`,
    );
  }

  const claimsByTarget = new Map<string, ProvenanceClaim[]>();
  const stageFeatureIds = new Set(input.stages.keys());
  const addOutputs = (
    featureId: FeatureId,
    outputs: readonly ProvenanceStageOutput[],
  ) => {
    const index = featureIndex.get(featureId);
    if (index === undefined) {
      // Unordered retained lineage cannot participate in transitive resolution.
      // Ignore it here; resolving one of its targets will fail closed as missing.
      return;
    }
    const claimsByTargetForFeature = new Map<
      string,
      Map<OccTopologySourceKey, ProvenanceClaim>
    >();
    for (const output of outputs) {
      for (const [sourceKey, targets] of output.sourceTargets) {
        for (const target of targets) {
          if (
            (target.kind !== "face" &&
              target.kind !== "edge" &&
              target.kind !== "vertex") ||
            target.bodyId !== output.outputSlot
          ) {
            continue;
          }
          const targetKey = getOccDurableRefKey(target);
          const claimsForTarget =
            claimsByTargetForFeature.get(targetKey) ?? new Map();
          const existing = claimsForTarget.get(sourceKey);
          if (existing) {
            existing.unsupported ||= output.unsupportedSourceKeys.has(sourceKey);
            continue;
          }
          claimsForTarget.set(sourceKey, {
            featureId,
            featureIndex: index,
            sourceKey,
            unsupported: output.unsupportedSourceKeys.has(sourceKey),
          });
          claimsByTargetForFeature.set(targetKey, claimsForTarget);
        }
      }
    }
    for (const [targetKey, claimsForTarget] of claimsByTargetForFeature) {
      claimsByTarget.set(targetKey, [
        ...(claimsByTarget.get(targetKey) ?? []),
        ...claimsForTarget.values(),
      ]);
    }
  };

  for (const [featureId, stage] of input.stages) {
    addOutputs(featureId, [...stage.outputs.values()]);
  }
  for (const [featureId, lineage] of input.previousLineage) {
    if (!stageFeatureIds.has(featureId)) {
      addOutputs(featureId, persistedProvenanceOutputs(lineage));
    }
  }

  const resolvingTargets = new Set<string>();
  const resolvingSourceKeys = new Set<string>();
  const resolvingTargetRefs = new Set<string>();

  const requirePriorFeatureIndex = (
    relationshipFeatureId: FeatureId,
    owningClaim: ProvenanceClaim,
  ) => {
    const relationshipIndex = featureIndex.get(relationshipFeatureId);
    if (relationshipIndex === undefined) {
      throw new Error(
        `occ-topology-provenance-missing-prior-stage: ${relationshipFeatureId}.`,
      );
    }
    if (
      relationshipFeatureId !== owningClaim.featureId ||
      relationshipIndex !== owningClaim.featureIndex
    ) {
      throw new Error(
        `occ-topology-provenance-future-stage-reference: ${owningClaim.sourceKey}.`,
      );
    }
    return relationshipIndex;
  };

  const resolveTarget = (
    target: ProvenanceSubtopologyRef,
    limit: number,
  ): OccCanonicalTopologyProvenanceId => {
    const targetKey = getOccDurableRefKey(target);
    const cycleKey = `${limit}:${targetKey}`;
    const reenteredTarget = resolvingTargetRefs.has(targetKey);
    if (resolvingTargets.has(cycleKey)) {
      throw new Error(`occ-topology-provenance-cycle: ${targetKey}.`);
    }
    resolvingTargets.add(cycleKey);
    resolvingTargetRefs.add(targetKey);
    try {
      const candidates = (claimsByTarget.get(targetKey) ?? []).filter(
        (claim) => claim.featureIndex < limit,
      );
      const latestIndex = Math.max(
        ...candidates.map((claim) => claim.featureIndex),
        Number.NEGATIVE_INFINITY,
      );
      const latest = candidates.filter(
        (claim) => claim.featureIndex === latestIndex,
      );
      if (
        latest.length > 1 &&
        latest.every((claim) => claim.featureId === latest[0]!.featureId)
      ) {
        return resolveConvergingClaims(latest, targetKey);
      }
      if (latest.length !== 1) {
        if (
          latest.length === 0 &&
          reenteredTarget &&
          (claimsByTarget.get(targetKey) ?? []).some(
            (claim) => claim.featureIndex === limit,
          )
        ) {
          throw new Error(`occ-topology-provenance-cycle: ${targetKey}.`);
        }
        if (
          latest.length === 0 &&
          (claimsByTarget.get(targetKey) ?? []).some(
            (claim) => claim.featureIndex >= limit,
          )
        ) {
          throw new Error(
            `occ-topology-provenance-future-stage-reference: ${targetKey}.`,
          );
        }
        if (latest.length === 0) {
          throw new OccTopologyProvenanceMissingError(targetKey);
        }
        throw new Error(`occ-topology-provenance-ambiguous: ${targetKey}.`);
      }
      if (latest[0]!.unsupported) {
        throw new OccTopologyProvenanceMissingError(targetKey);
      }
      return resolveSourceKey(latest[0]!.sourceKey, latest[0]!);
    } finally {
      resolvingTargets.delete(cycleKey);
      resolvingTargetRefs.delete(targetKey);
    }
  };

  const resolveSourceKey = (
    sourceKey: string,
    owningClaim: ProvenanceClaim,
  ): OccCanonicalTopologyProvenanceId => {
    const cycleKey = `${owningClaim.featureId}:${sourceKey}`;
    if (resolvingSourceKeys.has(cycleKey)) {
      throw new Error(`occ-topology-provenance-cycle: ${sourceKey}.`);
    }
    resolvingSourceKeys.add(cycleKey);
    try {
      const parsed = parseRelationshipSourceKey(sourceKey);
      if (parsed.kind === "root") {
        if (
          /(?:^|:)(?:face|edge|vertex):body_[^:]+:(?:face|edge|vertex)_[^:]+/.test(
            sourceKey,
          ) ||
          /(?:^|:)t\d+(?::|$)/.test(sourceKey)
        ) {
          throw new Error(
            `occ-topology-provenance-remintable-root: ${sourceKey}.`,
          );
        }
        return sourceKey;
      }
      const relationshipIndex = requirePriorFeatureIndex(
        parsed.featureId,
        owningClaim,
      );
      if (parsed.kind === "exact" || parsed.kind === "boolean") {
        return resolveTarget(parsed.source, relationshipIndex);
      }
      if (parsed.kind === "generated") {
        const sourceProvenance = resolveTarget(parsed.source, relationshipIndex);
        return formatGeneratedProducerTopologySourceKey({
          featureId: parsed.featureId,
          bodyId: parsed.bodyId,
          sourceKind: parsed.source.kind,
          sourcePublicId: encodeURIComponent(sourceProvenance) as
            | FaceId
            | EdgeId
            | VertexId,
          role: parsed.role,
        });
      }
      if (parsed.kind === "mirrorOperand") {
        return formatMirrorOperandTopologySourceKey({
          featureId: parsed.featureId,
          bodyId: parsed.bodyId,
          role: parsed.role,
          sourceCanonicalProvenanceIds: parsed.sourceCanonicalProvenanceIds,
        });
      }
      if (parsed.kind === "generatedAdjacency") {
        const adjacentSourceKeys = parsed.adjacentSourceKeys.map(
          (adjacentKey) => resolveSourceKey(adjacentKey, owningClaim),
        );
        if (new Set(adjacentSourceKeys).size !== adjacentSourceKeys.length) {
          throw new Error(
            `occ-topology-provenance-ambiguous: ${sourceKey}.`,
          );
        }
        return formatGeneratedAdjacencyTopologySourceKey({
          featureId: parsed.featureId,
          bodyId: parsed.bodyId,
          adjacentSourceKeys,
          role: parsed.role,
        });
      }
      throw new Error(
        `occ-topology-provenance-malformed-source-key: ${sourceKey}.`,
      );
    } finally {
      resolvingSourceKeys.delete(cycleKey);
    }
  };


  const resolveConvergingClaims = (
    claims: readonly ProvenanceClaim[],
    targetKey: string,
  ): OccCanonicalTopologyProvenanceId => {
    if (claims.some((claim) => claim.unsupported)) {
      throw new OccTopologyProvenanceMissingError(targetKey);
    }
    const sourceCanonicalProvenanceIds: OccCanonicalTopologyProvenanceId[] = [];
    for (const claim of claims) {
      try {
        sourceCanonicalProvenanceIds.push(
          resolveSourceKey(claim.sourceKey, claim),
        );
      } catch (error) {
        if (
          error instanceof OccTopologyProvenanceMissingError ||
          (error instanceof Error &&
            error.message.startsWith("occ-topology-provenance-remintable-root:"))
        ) {
          throw new OccTopologyProvenanceMissingError(targetKey);
        }
        throw error;
      }
    }
    return formatCompositeTopologyProvenanceId({
      sourceCanonicalProvenanceIds,
    });
  };

  const limit = beforeIndex ?? Number.POSITIVE_INFINITY;
  return Object.freeze({
    resolveFace(target: Extract<DurableRef, { kind: "face" }>) {
      return resolveTarget(target, limit);
    },
  });
}

function isOutputSubtopologyTarget(
  target: DurableRef,
  bodyId: BodyId,
): target is AuthoredTopologyLineageTarget {
  return (
    (target.kind === "face" ||
      target.kind === "edge" ||
      target.kind === "vertex") &&
    target.bodyId === bodyId
  );
}

export function createOccFeatureTopologyLineageMap(
  records: readonly AuthoredFeatureTopologyLineage[] | undefined,
): OccFeatureTopologyLineageMap {
  return new Map((records ?? []).map((record) => [record.featureId, record]));
}

export function mergeOccFeatureTopologyStageMaps(
  ...maps: readonly OccFeatureTopologyStageMap[]
): OccFeatureTopologyStageMap {
  return new Map(maps.flatMap((map) => [...map]));
}

export function serializeOccFeatureTopologyLineage(
  stages: OccFeatureTopologyStageMap,
  retained: OccFeatureTopologyLineageMap,
  activeFeatureIds: ReadonlySet<FeatureId>,
): AuthoredFeatureTopologyLineage[] {
  const records = new Map(
    [...retained].filter(([featureId]) => activeFeatureIds.has(featureId)),
  );

  for (const [featureId, stage] of stages) {
    if (!activeFeatureIds.has(featureId)) {
      continue;
    }
    records.set(featureId, {
      featureId,
      outputs: [...stage.outputs].map(([outputSlot, output]) => ({
        outputSlot,
        topologyToken: output.body.topologyToken,
        topology: {
          faceIds: [...output.body.topology.faceIds],
          edgeIds: [...output.body.topology.edgeIds],
          vertexIds: [...output.body.topology.vertexIds],
        },
        sourceTargets: [...output.sourceTargets].map(([sourceKey, targets]) => ({
          sourceKey,
          targets: targets.filter((target) =>
            isOutputSubtopologyTarget(target, outputSlot),
          ),
        })),
        unsupportedSourceKeys: [...output.unsupportedSourceKeys],
      })),
    });
  }

  return [...records.values()];
}

type ExactSuccessorSubtopologyRef = Extract<
  DurableRef,
  { kind: "face" | "edge" | "vertex" }
>;

function exactSuccessorSourceId(target: ExactSuccessorSubtopologyRef) {
  if (target.kind === "face") {
    return target.faceId;
  }
  if (target.kind === "edge") {
    return target.edgeId;
  }
  return target.vertexId;
}

function getExactSuccessor(
  sourceBody: OccTrackedBody,
  source: ExactSuccessorSubtopologyRef,
  successorsBySourceKey: ReadonlyMap<string, DurableRef>,
) {
  const direct = successorsBySourceKey.get(getOccDurableRefKey(source));
  if (direct) {
    return direct;
  }

  const aliases =
    source.kind === "face"
      ? sourceBody.nativeTopologyIdAliases?.faceIdsByNativeId
      : source.kind === "edge"
        ? sourceBody.nativeTopologyIdAliases?.edgeIdsByNativeId
        : sourceBody.nativeTopologyIdAliases?.vertexIdsByNativeId;
  const publicId = exactSuccessorSourceId(source);
  for (const [nativeId, aliasedPublicId] of aliases ?? []) {
    if (aliasedPublicId !== publicId) {
      continue;
    }
    const nativeTarget =
      source.kind === "face"
        ? { ...source, faceId: nativeId as FaceId }
        : source.kind === "edge"
          ? { ...source, edgeId: nativeId as EdgeId }
          : { ...source, vertexId: nativeId as VertexId };
    const successor = successorsBySourceKey.get(
      getOccDurableRefKey(nativeTarget),
    );
    if (successor) {
      return successor;
    }
  }
  return undefined;
}

function getExactSuccessorSourceTargets(body: OccTrackedBody) {
  return [
    ...body.topology.faceIds.map(
      (faceId): ExactSuccessorSubtopologyRef => ({
        kind: "face",
        bodyId: body.bodyId,
        faceId,
      }),
    ),
    ...body.topology.edgeIds.map(
      (edgeId): ExactSuccessorSubtopologyRef => ({
        kind: "edge",
        bodyId: body.bodyId,
        edgeId,
      }),
    ),
    ...body.topology.vertexIds.map(
      (vertexId): ExactSuccessorSubtopologyRef => ({
        kind: "vertex",
        bodyId: body.bodyId,
        vertexId,
      }),
    ),
  ];
}

function sameExactSuccessorKind(
  source: ExactSuccessorSubtopologyRef,
  successor: DurableRef,
): successor is ExactSuccessorSubtopologyRef {
  return source.kind === successor.kind;
}

export function formatExactSuccessorTopologySourceKey(input: {
  featureId: FeatureId;
  bodyId: BodyId;
  kind: "face" | "edge" | "vertex";
  sourcePublicId: FaceId | EdgeId | VertexId;
}) {
  return `exact-successor:${input.featureId}:${input.bodyId}:${input.kind}:${input.sourcePublicId}`;
}

/**
 * Producer-identity key for a subtopology a local operation CREATED.
 *
 * A generated entity has no prior subtopology to be a successor of, so it can
 * only be named after the feature that produced it plus the exact source the
 * kernel's own `Generated` history attributes it to. Both halves come from the
 * builder, never from geometry, so two executions of the same feature over the
 * same source keys reproduce the same key.
 */
export function formatGeneratedProducerTopologySourceKey(input: {
  featureId: FeatureId;
  bodyId: BodyId;
  sourceKind: "face" | "edge" | "vertex";
  sourcePublicId: FaceId | EdgeId | VertexId;
  role: string;
}) {
  return `generated-from:${input.featureId}:${input.bodyId}:${input.sourceKind}:${input.sourcePublicId}:${input.role}`;
}

/** Canonical identity for an exact same-feature convergence of source claims. */
export function formatCompositeTopologyProvenanceId(input: {
  sourceCanonicalProvenanceIds: readonly OccCanonicalTopologyProvenanceId[];
}) {
  const sources = [...new Set(input.sourceCanonicalProvenanceIds)].sort();
  if (
    sources.length === 0 ||
    sources.some(
      (source) => source.length === 0 || canonicalOperandProvenanceIsRemintable(source),
    )
  ) {
    throw new Error("occ-topology-provenance-malformed-composite-source.");
  }
  return `composite:${sources.map((source) => encodeURIComponent(source)).join("+")}`;
}

/**
 * Producer key for Mirror ADD topology proven to derive from the transformed
 * operand. It persists canonical source provenance, never a native or public
 * topology id.
 */
export function formatMirrorOperandTopologySourceKey(input: {
  featureId: FeatureId;
  bodyId: BodyId;
  role: "right" | "mixed";
  sourceCanonicalProvenanceIds: readonly OccCanonicalTopologyProvenanceId[];
}) {
  const sources = [...new Set(input.sourceCanonicalProvenanceIds)].sort();
  if (
    sources.length === 0 ||
    sources.some(
      (source) => source.length === 0 || canonicalOperandProvenanceIsRemintable(source),
    )
  ) {
    throw new Error("occ-topology-provenance-malformed-mirror-operand-source.");
  }
  return `mirror-operand:${input.featureId}:${input.bodyId}:${input.role}:${sources
    .map((source) => encodeURIComponent(source))
    .join("+")}`;
}

/**
 * Producer-identity key for subtopology a local operation created that its
 * builder's `Generated` cannot name.
 *
 * `BRepFilletAPI::Generated` answers with the chamfer/fillet SURFACE only; the
 * boundary edges and corner vertices of that surface are attributed to nothing,
 * so they reach a rebuild with no source key and are invalidated even though the
 * kernel built them deterministically. Their identity is nevertheless exact and
 * available: a subtopology is uniquely determined by the faces it bounds, and
 * every one of those faces already carries a stage claim. So the key is built
 * from the adjacent faces' own claim keys, sorted for order independence.
 *
 * This is combinatorial identity, not a geometric match: no coordinates, no
 * tolerance, and no traversal order participate. A signature reached by more
 * than one entity, or one whose adjacent faces are not all claimed, is left
 * unclaimed.
 */
export function formatGeneratedAdjacencyTopologySourceKey(input: {
  featureId: FeatureId;
  bodyId: BodyId;
  adjacentSourceKeys: readonly OccTopologySourceKey[];
  role: string;
}) {
  const adjacency = [...input.adjacentSourceKeys].sort().join("+");
  return `generated-from:${input.featureId}:${input.bodyId}:adjacent(${adjacency}):${input.role}`;
}

/**
 * One created subtopology plus the faces of the SAME output body that bound it.
 *
 * The caller owns the kernel traversal (it holds the live shapes); the stage
 * builder owns identity, because only it knows which faces carry a claim.
 */
export interface OccGeneratedAdjacencyEntry {
  target: DurableRef;
  adjacentFaceIds: readonly FaceId[];
}

/**
 * Build stage lineage from a feature's own exact kernel history successors.
 *
 * Applies to any feature that replaces one body and reports, per prior
 * subtopology, at most one successor claimed exactly once (rigid transforms,
 * and local operations like fillet/chamfer whose `BRepFilletAPI` history maps
 * untouched faces/edges/vertices one-to-one). Anything the kernel left
 * ambiguous, deleted, or unclaimed becomes an unsupported source key, so a
 * later rebuild invalidates it instead of guessing.
 *
 * `generatedTargetsBySourceKey` carries the complementary half: subtopology the
 * operation CREATED, which is a successor of nothing and would otherwise reach
 * rebuild with no source key at all. Those keys claim the producing feature's
 * identity via `formatGeneratedProducerTopologySourceKey`, and the caller must
 * derive them from builder history only.
 *
 * `generatedAdjacency` closes the last gap: created subtopology the builder's
 * history cannot name at all (the boundary of a chamfer surface). Those entities
 * are keyed by the claims of the faces that bound them, which is exact
 * combinatorial identity — see `formatGeneratedAdjacencyTopologySourceKey`.
 */
export function createExactSuccessorTopologyStage(input: {
  featureId: FeatureId;
  sourceBody: OccTrackedBody;
  outputBody: OccTrackedBody;
  successorsBySourceKey: ReadonlyMap<string, DurableRef>;
  generatedTargetsBySourceKey?: ReadonlyMap<OccTopologySourceKey, DurableRef>;
  /** Exact supplemental claims never override target-side history. */
  supplementalProducerTargetsBySourceKey?: ReadonlyMap<
    OccTopologySourceKey,
    DurableRef
  >;
  generatedAdjacency?: readonly OccGeneratedAdjacencyEntry[];
}): OccFeatureTopologyStage {
  const sourceTargets = new Map<OccTopologySourceKey, DurableRef[]>();
  const unsupportedSourceKeys = new Set<OccTopologySourceKey>();
  const claimedTargetKeys = new Map<string, OccTopologySourceKey>();

  for (const source of getExactSuccessorSourceTargets(input.sourceBody)) {
    const sourceKey = formatExactSuccessorTopologySourceKey({
      featureId: input.featureId,
      bodyId: input.sourceBody.bodyId,
      kind: source.kind,
      sourcePublicId: exactSuccessorSourceId(source),
    });
    const successor = getExactSuccessor(
      input.sourceBody,
      source,
      input.successorsBySourceKey,
    );

    if (
      !successor ||
      !sameExactSuccessorKind(source, successor) ||
      successor.bodyId !== input.outputBody.bodyId
    ) {
      unsupportedSourceKeys.add(sourceKey);
      continue;
    }

    const targetKey = getOccDurableRefKey(successor);
    if (claimedTargetKeys.has(targetKey)) {
      unsupportedSourceKeys.add(sourceKey);
      unsupportedSourceKeys.add(claimedTargetKeys.get(targetKey)!);
      sourceTargets.delete(claimedTargetKeys.get(targetKey)!);
      continue;
    }

    claimedTargetKeys.set(targetKey, sourceKey);
    sourceTargets.set(sourceKey, [successor]);
  }

  for (const [sourceKey, target] of input.generatedTargetsBySourceKey ?? []) {
    if (
      !isOutputSubtopologyTarget(target, input.outputBody.bodyId) ||
      sourceTargets.has(sourceKey)
    ) {
      unsupportedSourceKeys.add(sourceKey);
      continue;
    }

    const targetKey = getOccDurableRefKey(target);
    const claimedBy = claimedTargetKeys.get(targetKey);
    if (claimedBy) {
      // A result entity cannot both survive a prior entity and be newly
      // generated, and two producer claims on one entity are ambiguous.
      unsupportedSourceKeys.add(sourceKey);
      unsupportedSourceKeys.add(claimedBy);
      sourceTargets.delete(claimedBy);
      continue;
    }

    claimedTargetKeys.set(targetKey, sourceKey);
    sourceTargets.set(sourceKey, [target]);
  }

  for (const [sourceKey, target] of input.supplementalProducerTargetsBySourceKey ?? []) {
    if (
      !isOutputSubtopologyTarget(target, input.outputBody.bodyId) ||
      sourceTargets.has(sourceKey)
    ) {
      unsupportedSourceKeys.add(sourceKey);
      continue;
    }
    const targetKey = getOccDurableRefKey(target);
    if (claimedTargetKeys.has(targetKey)) {
      // The target-side successor/generated claim is authoritative.
      unsupportedSourceKeys.add(sourceKey);
      continue;
    }
    claimedTargetKeys.set(targetKey, sourceKey);
    sourceTargets.set(sourceKey, [target]);
  }

  // Adjacency claims run last: they can only name an entity once every face
  // bounding it already carries a claim, and they must never override one.
  const adjacencyTargetsBySourceKey = new Map<OccTopologySourceKey, DurableRef>();
  const droppedAdjacencySourceKeys = new Set<OccTopologySourceKey>();
  for (const entry of input.generatedAdjacency ?? []) {
    if (
      !isOutputSubtopologyTarget(entry.target, input.outputBody.bodyId) ||
      entry.target.kind === "face" ||
      entry.adjacentFaceIds.length === 0
    ) {
      continue;
    }
    const targetKey = getOccDurableRefKey(entry.target);
    if (claimedTargetKeys.has(targetKey)) {
      continue;
    }

    const adjacentSourceKeys: OccTopologySourceKey[] = [];
    for (const faceId of new Set(entry.adjacentFaceIds)) {
      const claim = claimedTargetKeys.get(
        getOccDurableRefKey({
          kind: "face",
          bodyId: input.outputBody.bodyId,
          faceId,
        }),
      );
      if (claim === undefined) {
        // An unnamed bounding face makes the signature unreproducible, so the
        // entity stays honestly unclaimed.
        adjacentSourceKeys.length = 0;
        break;
      }
      adjacentSourceKeys.push(claim);
    }
    if (adjacentSourceKeys.length === 0) {
      continue;
    }

    const sourceKey = formatGeneratedAdjacencyTopologySourceKey({
      featureId: input.featureId,
      bodyId: input.sourceBody.bodyId,
      adjacentSourceKeys,
      role: `generated-${entry.target.kind}`,
    });
    if (sourceTargets.has(sourceKey) || adjacencyTargetsBySourceKey.has(sourceKey)) {
      // Two entities share one signature: many, so neither may claim it.
      adjacencyTargetsBySourceKey.delete(sourceKey);
      droppedAdjacencySourceKeys.add(sourceKey);
      continue;
    }
    if (droppedAdjacencySourceKeys.has(sourceKey)) {
      continue;
    }
    adjacencyTargetsBySourceKey.set(sourceKey, entry.target);
  }

  for (const [sourceKey, target] of adjacencyTargetsBySourceKey) {
    claimedTargetKeys.set(getOccDurableRefKey(target), sourceKey);
    sourceTargets.set(sourceKey, [target]);
  }

  return {
    featureId: input.featureId,
    outputs: new Map([
      [
        input.outputBody.bodyId,
        {
          outputSlot: input.outputBody.bodyId,
          body: input.outputBody,
          sourceTargets,
          unsupportedSourceKeys,
        },
      ],
    ]),
  };
}

export function getPreviousFeatureTopologyStage(
  stages: OccFeatureTopologyStageMap,
  featureId: FeatureId,
): OccFeatureTopologyStage | null {
  return stages.get(featureId) ?? null;
}

export function getPreviousFeatureTopologyLineage(
  lineage: OccFeatureTopologyLineageMap,
  featureId: FeatureId,
): AuthoredFeatureTopologyLineage | null {
  return lineage.get(featureId) ?? null;
}

export function createUnsupportedProducerTopologyStage(input: {
  featureId: FeatureId;
  bodies: readonly OccTrackedBody[];
  producedTargets: readonly DurableRef[];
}): OccFeatureTopologyStage {
  const bodiesById = new Map(input.bodies.map((body) => [body.bodyId, body]));
  const outputs = new Map<OccTopologyOutputSlot, OccTopologyStageOutput>();

  for (const target of input.producedTargets) {
    if (target.kind !== "body") {
      continue;
    }

    const body = bodiesById.get(target.bodyId);
    if (!body) {
      continue;
    }

    outputs.set(body.bodyId, {
      outputSlot: body.bodyId,
      body,
      sourceTargets: new Map(),
      unsupportedSourceKeys: new Set(),
    });
  }

  return { featureId: input.featureId, outputs };
}

export function createFeatureTopologyStage(input: {
  featureId: FeatureId;
  previousBodies: readonly OccTrackedBody[];
  currentBodies: readonly OccTrackedBody[];
  outputs?: ReadonlyMap<OccTopologyOutputSlot, OccTopologyStageOutput>;
}): OccFeatureTopologyStage {
  if (input.outputs) {
    return {
      featureId: input.featureId,
      outputs: new Map(input.outputs),
    };
  }

  const previousById = new Map(
    input.previousBodies.map((body) => [body.bodyId, body]),
  );
  const outputs = new Map<OccTopologyOutputSlot, OccTopologyStageOutput>();

  for (const body of input.currentBodies) {
    const previous = previousById.get(body.bodyId);
    if (previous === body || previous?.topologyToken === body.topologyToken) {
      continue;
    }

    outputs.set(body.bodyId, {
      outputSlot: body.bodyId,
      body,
      sourceTargets: new Map(),
      unsupportedSourceKeys: new Set(),
    });
  }

  return { featureId: input.featureId, outputs };
}
