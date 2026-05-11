import type {
  GeometryAssetAvailability,
  GeometryAssetBlobInput,
  GeometryAssetHash,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import {
  createGeometryAssetDiagnostic,
  getEmbeddedGeometryAssetBytes,
  type GeometryAssetDiagnosticCode,
} from "@/contracts/modeling/geometry-assets";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";

export type GeometryAssetStorePutResult =
  | { ok: true; hash: GeometryAssetHash; byteLength: number; deduped: boolean }
  | { ok: false; diagnostic: ModelingDiagnostic };

export type GeometryAssetStoreGetResult =
  | { ok: true; hash: GeometryAssetHash; bytes: Uint8Array }
  | { ok: false; diagnostic: ModelingDiagnostic };

export type GeometryAssetStoreHasResult =
  | { ok: true; available: boolean }
  | { ok: false; diagnostic: ModelingDiagnostic };

export interface GeometryAssetStore {
  put(input: GeometryAssetBlobInput): Promise<GeometryAssetStorePutResult>;
  get(asset: GeometryAssetRecord): Promise<GeometryAssetStoreGetResult>;
  has(asset: GeometryAssetRecord): Promise<GeometryAssetStoreHasResult>;
}

export class MemoryGeometryAssetStore implements GeometryAssetStore {
  private readonly blobs = new Map<GeometryAssetHash, Uint8Array>();

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

    const existing = this.blobs.get(input.asset.hash);
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

    this.blobs.set(input.asset.hash, input.bytes.slice());
    return {
      ok: true,
      hash: input.asset.hash,
      byteLength: input.bytes.byteLength,
      deduped: false,
    };
  }

  async get(asset: GeometryAssetRecord): Promise<GeometryAssetStoreGetResult> {
    const bytes =
      this.blobs.get(asset.hash) ?? getEmbeddedGeometryAssetBytes(asset);
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
    if (!validation.ok) {
      return validation;
    }

    return { ok: true, hash: asset.hash, bytes: bytes.slice() };
  }

  async has(asset: GeometryAssetRecord): Promise<GeometryAssetStoreHasResult> {
    const bytes =
      this.blobs.get(asset.hash) ?? getEmbeddedGeometryAssetBytes(asset);
    if (!bytes) {
      return { ok: true, available: false };
    }

    const validation = await validateGeometryAssetBytes(asset, bytes);
    return validation.ok ? { ok: true, available: true } : validation;
  }
}

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

export function createMemoryGeometryAssetStore() {
  return new MemoryGeometryAssetStore();
}

export function createIndexedDbGeometryAssetStore(
  options?: IndexedDbGeometryAssetStoreOptions,
) {
  return new IndexedDbGeometryAssetStore(options);
}

export async function validateGeometryAssetBytes(
  asset: GeometryAssetRecord,
  bytes: Uint8Array,
): Promise<GeometryAssetStorePutResult> {
  if (bytes.byteLength !== asset.byteLength) {
    return {
      ok: false,
      diagnostic: createAssetStoreDiagnostic(
        "geometry-asset-corrupt",
        asset,
        "Geometry asset byte length does not match the authored manifest.",
      ),
    };
  }

  const hash = await hashGeometryAssetBytes(bytes);
  if (hash !== asset.hash) {
    return {
      ok: false,
      diagnostic: createAssetStoreDiagnostic(
        "geometry-asset-corrupt",
        asset,
        "Geometry asset content hash does not match the authored manifest.",
      ),
    };
  }

  return {
    ok: true,
    hash: asset.hash,
    byteLength: bytes.byteLength,
    deduped: false,
  };
}

export async function hashGeometryAssetBytes(
  bytes: Uint8Array,
): Promise<GeometryAssetHash> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function collectAssetAvailability(
  store: GeometryAssetStore,
  records: readonly GeometryAssetRecord[],
) {
  const availability: GeometryAssetAvailability[] = [];
  const diagnostics: ModelingDiagnostic[] = [];

  for (const asset of records) {
    const result = await store.has(asset);
    if (!result.ok) {
      diagnostics.push(result.diagnostic);
      availability.push(createAvailability(asset, false));
      continue;
    }

    availability.push(createAvailability(asset, result.available));
    if (!result.available) {
      diagnostics.push(
        createAssetStoreDiagnostic(
          "geometry-asset-missing",
          asset,
          "Referenced geometry asset bytes are missing from local storage.",
        ),
      );
    }
  }

  return { availability, diagnostics };
}

export async function storeGeometryAssetInputsForManifest(
  store: GeometryAssetStore,
  manifestRecords: readonly GeometryAssetRecord[],
  assetInputs: readonly GeometryAssetBlobInput[],
) {
  const manifestById = new Map(
    manifestRecords.map((record) => [record.assetId, record]),
  );
  const verifiedInputs: GeometryAssetBlobInput[] = [];
  for (const input of assetInputs) {
    const manifestRecord = manifestById.get(input.asset.assetId);
    if (
      !manifestRecord ||
      !sameManifestAssetRecord(manifestRecord, input.asset)
    ) {
      return {
        ok: false as const,
        diagnostic: {
          code: "geometry-asset-unavailable",
          severity: "error" as const,
          message: `Geometry asset ${input.asset.assetId} is not part of the authored manifest.`,
          target: null,
          detail: null,
        },
      };
    }

    const validation = await validateGeometryAssetBytes(
      manifestRecord,
      input.bytes,
    );
    if (!validation.ok) {
      return validation;
    }

    verifiedInputs.push({ asset: manifestRecord, bytes: input.bytes });
  }

  for (const input of verifiedInputs) {
    const stored = await store.put(input);
    if (!stored.ok) {
      return stored;
    }
  }

  return { ok: true as const };
}

export function filterGeometryAssetInputsForManifest(
  manifestRecords: readonly GeometryAssetRecord[],
  assetInputs: readonly GeometryAssetBlobInput[],
) {
  const manifestById = new Map(
    manifestRecords.map((record) => [record.assetId, record]),
  );
  return assetInputs.filter((input) => {
    const manifestRecord = manifestById.get(input.asset.assetId);
    return Boolean(
      manifestRecord && sameManifestAssetRecord(manifestRecord, input.asset),
    );
  });
}

function sameManifestAssetRecord(
  left: GeometryAssetRecord,
  right: GeometryAssetRecord,
) {
  return (
    left.hash === right.hash &&
    left.byteLength === right.byteLength &&
    left.format === right.format &&
    left.mediaType === right.mediaType
  );
}

function createAvailability(
  asset: GeometryAssetRecord,
  available: boolean,
): GeometryAssetAvailability {
  return {
    assetId: asset.assetId,
    hash: asset.hash,
    byteLength: asset.byteLength,
    format: asset.format,
    available,
  };
}

function createAssetStoreDiagnostic(
  code: GeometryAssetDiagnosticCode,
  asset: GeometryAssetRecord,
  message: string,
) {
  return createGeometryAssetDiagnostic(code, asset, message);
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
