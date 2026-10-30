import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createEmptyGeometryAssetManifest } from "@/contracts/modeling/geometry-assets";
import type { DocumentId } from "@/contracts/shared/ids";
import {
  AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
  CONTRACT_VERSION,
} from "@/contracts/shared/versioning";
import {
  OCC_KERNEL_DOCUMENT_NAME,
  OCC_KERNEL_INITIAL_REVISION_ID,
  OCC_KERNEL_SETTINGS,
} from "./opencascade-kernel-seed";

/** Standard construction planes are derived on OCC restore, not persisted as authored features. */
export function createEmptyAuthoredModelDocument(
  documentId: DocumentId,
): AuthoredModelDocument {
  return {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: AUTHORED_MODEL_DOCUMENT_SCHEMA_VERSION,
    documentId,
    name: OCC_KERNEL_DOCUMENT_NAME,
    revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    settings: { ...OCC_KERNEL_SETTINGS },
    variables: [],
    sketches: [],
    features: [],
    featureOrder: [],
    historyOrder: [],
    cursor: { kind: "empty" },
    bodyLabels: [],
    bodyAppearances: [],
    assets: createEmptyGeometryAssetManifest(),
    embeddedBinaryAssets: [],
    topologyLineage: [],
  };
}
