import type { OpenCascadeInstance } from "opencascade.js/dist/opencascade.full";
import {
  getMissingNativeTopologyKernelEntrypoints,
  probeNativeTopologyKernelCapabilities,
  type OccNativeTopologyCapabilityProbeResult,
} from "@/domain/modeling/occ/native-topology-payload";
import {
  OCC_ASSET_VERSION,
  getVersionedOpenCascadeAssetUrl,
} from "@/domain/modeling/occ/assets";

export function getOpenCascadeRuntimeAssetVersion() {
  return OCC_ASSET_VERSION;
}

export const getVersionedOpenCascadeRuntimeAssetUrl =
  getVersionedOpenCascadeAssetUrl;
export type OpenCascadeMainJS = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

export interface OpenCascadeInitializationOptions {
  mainJS?: OpenCascadeMainJS;
  mainWasm?: string;
  worker?: string;
  libs?: string[];
  module?: Record<string, unknown>;
}

export type OpenCascadeInitializer = (
  settings?: OpenCascadeInitializationOptions,
) => Promise<OpenCascadeInstance>;

export function probeOpenCascadeNativeTopologyKernelCapabilities(
  oc: OpenCascadeInstance,
): OccNativeTopologyCapabilityProbeResult {
  return probeNativeTopologyKernelCapabilities(
    oc as unknown as Parameters<
      typeof probeNativeTopologyKernelCapabilities
    >[0],
  );
}

export function assertOpenCascadeNativeTopologyKernelCapabilities(
  oc: OpenCascadeInstance,
) {
  const missingEntrypoints = getMissingNativeTopologyKernelEntrypoints(
    oc as unknown as Parameters<
      typeof getMissingNativeTopologyKernelEntrypoints
    >[0],
  );

  if (missingEntrypoints.length > 0) {
    throw new Error(
      `Loaded OpenCascade build is missing native topology kernel entrypoints: ${missingEntrypoints.join(", ")}.`,
    );
  }
}

export type { OpenCascadeInstance };
