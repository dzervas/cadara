import type {
  GeometryAssetAvailability,
  GeometryAssetBlobInput,
  GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import {
  createAssetStoreDiagnostic,
  sameManifestAssetRecord,
  validateGeometryAssetBytes,
  type GeometryAssetStore,
} from "@/core/modeling/geometry-asset-store";

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
