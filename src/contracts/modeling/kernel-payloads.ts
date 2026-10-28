import { type tags } from "typia";

import type { CadaraBrepGeometryAssetData } from "@/contracts/modeling/geometry-assets";
import type { RevisionId } from "@/contracts/shared/ids";
import type { DurableRef } from "@/contracts/shared/references";
import type { AuthoredFeatureTopologyLineage } from "@/contracts/modeling/authored-document";

export const OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION =
  "occ-native-topology-payload/v1alpha1";

export const OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS = [
  "CadaraNativeTopologyProbe",
  "CadaraBuildNativeTopologyPayload",
  "CadaraExecuteNativeFeatureTransaction",
  "CadaraBuildNativeExactBrepPayload",
  "CadaraBuildNativeMeshExportPayload",
] as const;

export type OccNativeTopologyKernelEntrypoint =
  (typeof OCC_NATIVE_TOPOLOGY_KERNEL_ENTRYPOINTS)[number];

export type OccNativeNonEmptyString = string & tags.Pattern<"^.*\\S.*$">;

export type OccNativeBufferScalar =
  | "uint8"
  | "uint16"
  | "uint32"
  | "int32"
  | "float32"
  | "float64";

export interface OccNativeBufferRef {
  bufferId: `occ_buffer_${string}`;
  scalar: OccNativeBufferScalar;
  byteOffset: number;
  byteLength: number;
  itemStride: number;
}

export interface OccNativeTransferableBuffer {
  bufferId: OccNativeBufferRef["bufferId"];
  buffer: ArrayBuffer;
}

export interface OccNativeTableLayout {
  rowCount: number;
  columns: Record<string, OccNativeBufferRef>;
}

export interface OccNativeTopologyTableLayout {
  bodies: OccNativeTableLayout;
  solids: OccNativeTableLayout;
  shells: OccNativeTableLayout;
  faces: OccNativeTableLayout;
  loops: OccNativeTableLayout;
  coedges: OccNativeTableLayout;
  edges: OccNativeTableLayout;
  vertices: OccNativeTableLayout;
}

export interface OccNativeMeshTableLayout {
  positions: OccNativeBufferRef;
  normals: OccNativeBufferRef;
  triangleIndices: OccNativeBufferRef;
  triangleFaceBindings: OccNativeBufferRef;
}

export interface OccNativeExactBrepTableLayout {
  topology: OccNativeTopologyTableLayout;
  curves: OccNativeTableLayout;
  surfaces: OccNativeTableLayout;
  trims: OccNativeTableLayout;
  fallbackTriangles: OccNativeMeshTableLayout | null;
}

export interface OccNativeTopologyDiagnostic {
  code: OccNativeNonEmptyString;
  severity: "info" | "warning" | "error";
  message: OccNativeNonEmptyString;
  target: DurableRef | null;
  detail: Record<string, unknown> | null;
}

export interface OccNativeExactBrepPayload {
  schemaVersion: typeof OCC_NATIVE_TOPOLOGY_PAYLOAD_SCHEMA_VERSION;
  revisionId: RevisionId;
  target: DurableRef;
  brep: CadaraBrepGeometryAssetData;
  /** Exact current OCC stage source claims; transient review/apply evidence only. */
  topologyLineage?: readonly AuthoredFeatureTopologyLineage[];
  tables: OccNativeExactBrepTableLayout;
  buffers: readonly OccNativeTransferableBuffer[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}

export interface OccNativeTopologyCapabilityProbeResult {
  kind: "available" | "missing";
  requiredEntrypoints: readonly OccNativeTopologyKernelEntrypoint[];
  missingEntrypoints: readonly OccNativeTopologyKernelEntrypoint[];
  diagnostics: readonly OccNativeTopologyDiagnostic[];
}
