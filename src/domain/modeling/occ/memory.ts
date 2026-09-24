export type OccDisposable = {
  delete?: () => void;
  isDeleted?: () => boolean;
};

export class OccCleanupError extends AggregateError {
  readonly retry: () => void;

  constructor(errors: readonly unknown[], retry: () => void) {
    super(errors, "One or more OpenCascade resources could not be released.");
    this.name = "OccCleanupError";
    this.retry = retry;
  }
}

export function combineOccCleanupError(
  originalError: unknown,
  cleanupError: unknown,
): AggregateError {
  return new AggregateError(
    [originalError, cleanupError],
    "OpenCascade operation and cleanup both failed.",
  );
}

/** Finds every cleanup retry reachable through nested operation aggregates. */
export function collectOccCleanupErrors(error: unknown): OccCleanupError[] {
  const cleanupErrors = new Set<OccCleanupError>();
  const visited = new Set<unknown>();
  const visit = (candidate: unknown) => {
    if (visited.has(candidate)) return;
    visited.add(candidate);
    if (candidate instanceof OccCleanupError) cleanupErrors.add(candidate);
    if (candidate instanceof AggregateError) {
      for (const nested of candidate.errors) visit(nested);
    }
  };
  visit(error);
  return [...cleanupErrors];
}

type OccBakedShapeCacheEntry<Shape extends OccDisposable> = {
  shape: Shape;
};

type OccOwnedTrackedBody = {
  shape: OccDisposable;
  facesById: ReadonlyMap<unknown, OccDisposable>;
  edgesById: ReadonlyMap<unknown, OccDisposable>;
  verticesById: ReadonlyMap<unknown, OccDisposable>;
  naming?: {
    document: OccDisposable;
    bodyLabel: OccDisposable;
    topologyLabelsByKey: ReadonlyMap<unknown, OccDisposable>;
    selectorLabelsByKey: ReadonlyMap<unknown, OccDisposable>;
  };
};

type OccOwnedTopologyStageMap = ReadonlyMap<
  unknown,
  {
    outputs: ReadonlyMap<unknown, { body: OccOwnedTrackedBody }>;
  }
>;

type OccOwnershipGraph = {
  bodies?: readonly OccOwnedTrackedBody[];
  baseBodies?: readonly OccOwnedTrackedBody[];
  bakedShapeCache?: Map<
    unknown,
    readonly OccBakedShapeCacheEntry<OccDisposable>[]
  >;
  featureTopologyStages?: OccOwnedTopologyStageMap;
  previousFeatureTopologyStages?: OccOwnedTopologyStageMap;
};

export function deleteOccObject(object: OccDisposable | null | undefined) {
  object?.delete?.();
}

/** Releases each wrapper identity once and retains only failed identities for retry. */
export function releaseOccObjects(
  objects: Iterable<OccDisposable>,
  onReleased?: () => void,
) {
  const pendingObjects = new Set(objects);
  const releasePending = () => {
    const errors: unknown[] = [];
    for (const object of pendingObjects) {
      try {
        deleteOccObject(object);
        pendingObjects.delete(object);
      } catch (error) {
        // Embind exposes isDeleted() on wrappers. A destructor may report an
        // error after invalidating the wrapper; such a wrapper must not be
        // retried. Without that signal, conservatively retain it for retry.
        try {
          if (object.isDeleted?.()) pendingObjects.delete(object);
        } catch (statusError) {
          errors.push(statusError);
        }
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new OccCleanupError(errors, releasePending);
    }
    onReleased?.();
  };

  releasePending();
}

function collectOccBodyObjects(
  objects: Set<OccDisposable>,
  namingDocuments: Set<OccDisposable>,
  body: OccOwnedTrackedBody,
) {
  objects.add(body.shape);
  for (const face of body.facesById.values()) objects.add(face);
  for (const edge of body.edgesById.values()) objects.add(edge);
  for (const vertex of body.verticesById.values()) objects.add(vertex);
  if (body.naming) {
    // Labels retain document-owned OCAF nodes, so release every label wrapper
    // before releasing the document wrapper that owns their native graph.
    objects.add(body.naming.bodyLabel);
    for (const label of body.naming.topologyLabelsByKey.values()) {
      objects.add(label);
    }
    for (const label of body.naming.selectorLabelsByKey.values()) {
      objects.add(label);
    }
    namingDocuments.add(body.naming.document);
  }
}

function collectOccOwnershipGraphObjects(state: OccOwnershipGraph) {
  const objects = new Set<OccDisposable>();
  const namingDocuments = new Set<OccDisposable>();
  for (const body of state.baseBodies ?? [])
    collectOccBodyObjects(objects, namingDocuments, body);
  for (const body of state.bodies ?? [])
    collectOccBodyObjects(objects, namingDocuments, body);
  for (const entries of state.bakedShapeCache?.values() ?? []) {
    for (const entry of entries) objects.add(entry.shape);
  }
  for (const stages of [
    state.featureTopologyStages,
    state.previousFeatureTopologyStages,
  ]) {
    for (const stage of stages?.values() ?? []) {
      for (const output of stage.outputs.values()) {
        collectOccBodyObjects(objects, namingDocuments, output.body);
      }
    }
  }
  for (const document of namingDocuments) objects.add(document);
  return objects;
}

/**
 * Releases wrapper identities reachable only from a discarded ownership graph.
 * OCC geometric identity (for example IsSame) is intentionally irrelevant:
 * distinct embind wrappers each own their own native handle.
 */
export function releaseDiscardedOccAuthoringStateObjects(
  discarded: OccOwnershipGraph,
  retained: readonly OccOwnershipGraph[],
) {
  const retainedObjects = new Set<OccDisposable>();
  for (const state of retained) {
    for (const object of collectOccOwnershipGraphObjects(state)) {
      retainedObjects.add(object);
    }
  }

  const pendingObjects = new Set(
    [...collectOccOwnershipGraphObjects(discarded)].filter(
      (object) => !retainedObjects.has(object),
    ),
  );
  const clearDiscardedCache =
    discarded.bakedShapeCache &&
    !retained.some(
      (state) => state.bakedShapeCache === discarded.bakedShapeCache,
    )
      ? () => discarded.bakedShapeCache?.clear()
      : null;

  releaseOccObjects(pendingObjects, clearDiscardedCache ?? undefined);
}

/** Releases every embind wrapper owned by a discarded OCC authoring state once. */
export function releaseOccAuthoringStateObjects(state: OccOwnershipGraph) {
  releaseDiscardedOccAuthoringStateObjects(state, []);
}
