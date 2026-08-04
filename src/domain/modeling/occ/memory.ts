type OccDisposable = { delete?: () => void };

type OccBakedShapeCacheEntry<Shape extends OccDisposable> = {
  shape: Shape;
};

export function deleteOccObject(object: OccDisposable | null | undefined) {
  object?.delete?.();
}

type OccOwnedTrackedBody = {
  shape: OccDisposable;
  facesById: ReadonlyMap<unknown, OccDisposable>;
  edgesById: ReadonlyMap<unknown, OccDisposable>;
  verticesById: ReadonlyMap<unknown, OccDisposable>;
};

/** Releases every embind wrapper owned by a discarded OCC authoring state once. */
export function releaseOccAuthoringStateObjects(state: {
  bodies: readonly OccOwnedTrackedBody[];
  baseBodies: readonly OccOwnedTrackedBody[];
  bakedShapeCache: Map<unknown, readonly OccBakedShapeCacheEntry<OccDisposable>[]>;
}) {
  const objects = new Set<OccDisposable>();
  const collectBody = (body: OccOwnedTrackedBody) => {
    objects.add(body.shape);
    for (const face of body.facesById.values()) objects.add(face);
    for (const edge of body.edgesById.values()) objects.add(edge);
    for (const vertex of body.verticesById.values()) objects.add(vertex);
  };
  for (const body of state.baseBodies) collectBody(body);
  for (const body of state.bodies) collectBody(body);
  for (const entries of state.bakedShapeCache.values()) {
    for (const entry of entries) objects.add(entry.shape);
  }
  state.bakedShapeCache.clear();
  for (const object of objects) deleteOccObject(object);
}

/**
 * Releases a baked-shape cache only after its owning runtime state is replaced.
 * Cached TopoDS wrappers are also used directly by that state's bodies, so a
 * cache retained by the replacement must never be released during a rebuild.
 */
export function releaseReplacedOccBakedShapeCache<
  AssetId,
  Shape extends OccDisposable,
>(
  discarded: Map<AssetId, readonly OccBakedShapeCacheEntry<Shape>[]> | undefined,
  replacement: ReadonlyMap<
    AssetId,
    readonly OccBakedShapeCacheEntry<Shape>[]
  > | undefined,
) {
  if (!discarded || discarded === replacement) {
    return;
  }

  const shapes = new Set<Shape>();
  for (const entries of discarded.values()) {
    for (const { shape } of entries) {
      shapes.add(shape);
    }
  }
  discarded.clear();

  for (const shape of shapes) {
    deleteOccObject(shape);
  }
}
