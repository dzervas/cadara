type OccDisposable = { delete?: () => void };

type OccBakedShapeCacheEntry<Shape extends OccDisposable> = {
  shape: Shape;
};

export function deleteOccObject(object: OccDisposable | null | undefined) {
  object?.delete?.();
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
