import type {
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

export function createMemoryGeometryAssetStore() {
  return new MemoryGeometryAssetStore();
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
  const digestInput =
    bytes.buffer instanceof ArrayBuffer &&
      bytes.byteOffset === 0 &&
      bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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

export function sameManifestAssetRecord(
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

export function createAssetStoreDiagnostic(
  code: GeometryAssetDiagnosticCode,
  asset: GeometryAssetRecord,
  message: string,
) {
  return createGeometryAssetDiagnostic(code, asset, message);
}

