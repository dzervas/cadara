import type {
  GeometryAssetResolver,
  ResolvedGeometryAssetBytes,
} from "@/contracts/modeling/adapter";
import {
  createGeometryAssetRecordFromReference,
  type BakedGeometryAssetReference,
} from "@/contracts/modeling/geometry-assets";
import type { GeometryAssetStore } from "@/core/modeling/geometry-asset-store";
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
