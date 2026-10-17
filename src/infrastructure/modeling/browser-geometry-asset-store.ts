import { createStoreGeometryAssetResolver } from "./geometry-asset-resolver";
import { createIndexedDbGeometryAssetStore } from "@/infrastructure/persistence/indexeddb-geometry-asset-store";
import type {
  GeometryAssetResolver,
} from "@/contracts/modeling/adapter";
import {
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
