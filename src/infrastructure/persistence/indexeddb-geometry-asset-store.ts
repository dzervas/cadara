import type {
  GeometryAssetBlobInput,
  GeometryAssetRecord,
  GeometryAssetHash,
} from "@/contracts/modeling/geometry-assets";
import { getEmbeddedGeometryAssetBytes } from "@/contracts/modeling/geometry-assets";
import {
  validateGeometryAssetBytes,
  createAssetStoreDiagnostic,
  type GeometryAssetStore,
  type GeometryAssetStorePutResult,
  type GeometryAssetStoreGetResult,
  type GeometryAssetStoreHasResult,
} from "@/core/modeling/geometry-asset-store";
export interface IndexedDbGeometryAssetStoreOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  storeName?: string;
}

export class IndexedDbGeometryAssetStore implements GeometryAssetStore {
  private readonly indexedDB: IDBFactory | undefined;
  private readonly databaseName: string;
  private readonly storeName: string;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbGeometryAssetStoreOptions = {}) {
    this.indexedDB = options.indexedDB ?? globalThis.indexedDB;
    this.databaseName = options.databaseName ?? "cadara-geometry-assets";
    this.storeName = options.storeName ?? "assets";
  }

  async put(
    input: GeometryAssetBlobInput,
  ): Promise<GeometryAssetStorePutResult> {
    const validation = await validateGeometryAssetBytes(
      input.asset,
      input.bytes,
    );
    if (!validation.ok) {
      return validation;
    }

    try {
      const existing = await this.read(input.asset.hash);
      if (existing) {
        const existingValidation = await validateGeometryAssetBytes(
          input.asset,
          existing,
        );
        if (existingValidation.ok) {
          return {
            ok: true,
            hash: input.asset.hash,
            byteLength: existing.byteLength,
            deduped: true,
          };
        }
      }

      await this.write(input.asset.hash, input.bytes.slice());
      return {
        ok: true,
        hash: input.asset.hash,
        byteLength: input.bytes.byteLength,
        deduped: false,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        diagnostic: createStorageFailureDiagnostic(input.asset, error),
      };
    }
  }

  async get(asset: GeometryAssetRecord): Promise<GeometryAssetStoreGetResult> {
    try {
      const bytes =
        (await this.read(asset.hash)) ?? getEmbeddedGeometryAssetBytes(asset);
      if (!bytes) {
        return {
          ok: false,
          diagnostic: createAssetStoreDiagnostic(
            "geometry-asset-missing",
            asset,
            "Referenced geometry asset bytes are missing.",
          ),
        };
      }

      const validation = await validateGeometryAssetBytes(asset, bytes);
      return validation.ok ? { ok: true, hash: asset.hash, bytes } : validation;
    } catch (error: unknown) {
      return {
        ok: false,
        diagnostic: createStorageFailureDiagnostic(asset, error),
      };
    }
  }

  async has(asset: GeometryAssetRecord): Promise<GeometryAssetStoreHasResult> {
    try {
      const bytes =
        (await this.read(asset.hash)) ?? getEmbeddedGeometryAssetBytes(asset);
      if (!bytes) {
        return { ok: true, available: false };
      }

      const validation = await validateGeometryAssetBytes(asset, bytes);
      return validation.ok ? { ok: true, available: true } : validation;
    } catch (error: unknown) {
      return {
        ok: false,
        diagnostic: createStorageFailureDiagnostic(asset, error),
      };
    }
  }

  private async openDatabase() {
    if (!this.indexedDB) {
      throw new Error("IndexedDB is unavailable for geometry asset storage.");
    }

    this.databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDB!.open(this.databaseName, 1);
      request.onerror = () =>
        reject(
          request.error ??
            new Error("Geometry asset database could not be opened."),
        );
      request.onupgradeneeded = () => {
        request.result.createObjectStore(this.storeName);
      };
      request.onsuccess = () => resolve(request.result);
    });

    return this.databasePromise;
  }

  private async read(hash: GeometryAssetHash) {
    const database = await this.openDatabase();
    return new Promise<Uint8Array | null>((resolve, reject) => {
      const request = database
        .transaction(this.storeName, "readonly")
        .objectStore(this.storeName)
        .get(hash);
      request.onerror = () =>
        reject(request.error ?? new Error("Geometry asset read failed."));
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof Uint8Array ? value.slice() : null);
      };
    });
  }

  private async write(hash: GeometryAssetHash, bytes: Uint8Array) {
    const database = await this.openDatabase();
    return new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(this.storeName, "readwrite")
        .objectStore(this.storeName)
        .put(bytes.slice(), hash);
      request.onerror = () =>
        reject(request.error ?? new Error("Geometry asset write failed."));
      request.onsuccess = () => resolve();
    });
  }
}

export function createIndexedDbGeometryAssetStore(
  options?: IndexedDbGeometryAssetStoreOptions,
) {
  return new IndexedDbGeometryAssetStore(options);
}

function createStorageFailureDiagnostic(
  asset: GeometryAssetRecord,
  error: unknown,
) {
  return createAssetStoreDiagnostic(
    "geometry-asset-storage-failed",
    asset,
    error instanceof Error ? error.message : "Geometry asset storage failed.",
  );
}
