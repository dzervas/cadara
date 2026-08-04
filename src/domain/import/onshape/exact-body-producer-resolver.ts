import type { ImportDeferredValue } from "@/contracts/import/actions";
import type { RollbackTopologyTimeline } from "@/domain/import/onshape/rollback-topology-reader";
import type { OnshapeTopologyQueryRef } from "@/domain/import/onshape/topology-query-reader";

export interface DeferredBodyOfSourceFeature {
  kind: "bodyOfSourceFeature";
  producerSourceFeatureId: string;
  deterministicId: string;
}

export interface ExactBodyProducerBinding {
  query: OnshapeTopologyQueryRef;
  /** Review-only source identity; preparation rebases this to bodyOf. */
  deferred:
    | Extract<ImportDeferredValue, { kind: "bodyOf" }>
    | DeferredBodyOfSourceFeature;
  producerFeatureId: string;
}

/**
 * Resolves whole-body slots only when rollback history proves one exact, live,
 * single-output producer action. This deliberately has no geometric fallback:
 * callers retain their existing topology resolver when this proof is absent.
 * The first captured snapshot is treated as that first feature's introduced
 * output because no preceding rollback boundary exists for it.
 */
export function resolveExactBodyProducerBindings(input: {
  featureIds: readonly string[];
  consumerFeatureId: string;
  queries: readonly OnshapeTopologyQueryRef[];
  rollback: RollbackTopologyTimeline;
  isParametric: (featureId: string) => boolean;
  /** Omit in review mode: source-feature identity is deliberately index-free. */
  featureIdToOrderedActionIndex?: ReadonlyMap<string, number>;
  reviewMode?: boolean;
}): readonly ExactBodyProducerBinding[] | null {
  const consumerIndex = input.featureIds.indexOf(input.consumerFeatureId);
  if (consumerIndex <= 0 || input.queries.length === 0) return null;
  if (!input.queries.every(
    (query) => query.expectedKinds.length === 1 && query.expectedKinds[0] === "body",
  )) return null;

  const bindings: ExactBodyProducerBinding[] = [];
  for (const query of input.queries) {
    let producerFeatureId: string | null = null;
    for (let index = 0; index < consumerIndex; index += 1) {
      const featureId = input.featureIds[index]!;
      const delta = input.rollback.bodyDeltaBetweenFeatures(featureId, featureId);
      const hasPrecedingSnapshot = input.featureIds
        .slice(0, index)
        .some((previousFeatureId) => input.rollback.snapshotAfterFeature(previousFeatureId));
      const initialBodyIds = !hasPrecedingSnapshot
        ? input.rollback.snapshotAfterFeature(featureId)?.bodies.map((body) => body.id) ?? []
        : [];
      if (!delta && initialBodyIds.length === 0) continue;
      if (delta?.removedBodyDeterministicIds.includes(query.deterministicId)) {
        producerFeatureId = null;
        continue;
      }
      const outputs = delta
        ? [
            ...new Set([
              ...delta.introducedBodyDeterministicIds,
              ...delta.changedBodyDeterministicIds,
            ]),
          ]
        : initialBodyIds;
      if (!outputs.includes(query.deterministicId)) continue;
      producerFeatureId =
        outputs.length === 1 && outputs[0] === query.deterministicId ? featureId : null;
    }
    if (!producerFeatureId || !input.isParametric(producerFeatureId)) return null;
    const actionIndex = input.featureIdToOrderedActionIndex?.get(producerFeatureId);
    if (!input.reviewMode && actionIndex === undefined) return null;
    bindings.push({
      query,
      deferred: input.reviewMode
        ? {
            kind: "bodyOfSourceFeature",
            producerSourceFeatureId: producerFeatureId,
            deterministicId: query.deterministicId,
          }
        : { kind: "bodyOf", actionIndex: actionIndex! },
      producerFeatureId,
    });
  }
  return bindings;
}
