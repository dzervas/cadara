import type {
  GeometryAssetResolver,
  ResolvedGeometryAssetBytes,
} from "@/contracts/modeling/adapter";
import {
  createGeometryAssetRecordFromReference,
  type BakedGeometryAssetReference,
} from "@/contracts/modeling/geometry-assets";
import {
  createIndexedDbGeometryAssetStore,
  type GeometryAssetStore,
} from "@/domain/modeling/geometry-asset-store";

/**
 * App-level composition for baked geometry: one `GeometryAssetStore` shared by
 * the import baking capability (writer) and the kernel asset resolver (reader),
 * so bytes baked during import are the same bytes materialized by the kernel.
 */
let browserGeometryAssetStore: GeometryAssetStore | null = null;

export function getBrowserGeometryAssetStore(): GeometryAssetStore {
  browserGeometryAssetStore ??= createIndexedDbGeometryAssetStore();
  return browserGeometryAssetStore;
}

/**
 * Resolve a baked geometry asset from a self-describing reference carried by the
 * feature definition. The reference reconstructs the store record, so resolution
 * is a pure `store.get(record)` with no session-scoped registry. Missing asset →
 * null, never fabricated geometry.
 */
export function createStoreGeometryAssetResolver(
  store: GeometryAssetStore,
): GeometryAssetResolver {
  return {
    async resolveGeometryAsset(
      reference: BakedGeometryAssetReference,
    ): Promise<ResolvedGeometryAssetBytes | null> {
      const record = createGeometryAssetRecordFromReference(reference);
      const stored = await store.get(record);
      return stored.ok
        ? { bytes: stored.bytes.slice(), format: reference.format }
        : null;
    },
  };
}

/**
 * Single composition seam for baked geometry: given one `GeometryAssetStore`,
 * produces BOTH the import baking capability's store binding (writer) AND the
 * kernel adapter's asset resolver (reader). Browser composition and tests must
 * obtain both ends from this helper so they never drift apart.
 */
export interface GeometryAssetComposition {
  assetStore: GeometryAssetStore;
  resolver: GeometryAssetResolver;
}

export function createGeometryAssetComposition(
  store: GeometryAssetStore = getBrowserGeometryAssetStore(),
): GeometryAssetComposition {
  return {
    assetStore: store,
    resolver: createStoreGeometryAssetResolver(store),
  };
}

/**
 * Memoized browser composition so the workbench document owner (writer store)
 * and the kernel runtime (reader resolver) share one seam instance.
 */
let browserGeometryAssetComposition: GeometryAssetComposition | null = null;

export function getBrowserGeometryAssetComposition(): GeometryAssetComposition {
  browserGeometryAssetComposition ??= createGeometryAssetComposition(
    getBrowserGeometryAssetStore(),
  );
  return browserGeometryAssetComposition;
}
