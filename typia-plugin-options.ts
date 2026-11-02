import path from "node:path";
import UnpluginTypia from "@typia/unplugin/vite";
import type { PluginOption } from "vite";

export const typiaTransformInclude = [
  /[/\\]src[/\\].*(?:[/\\]|\.)runtime-schema\.ts$/,
  /[/\\]src[/\\]contracts[/\\]import[/\\](?:base-validation|onshape-capture-bundle|validation)\.ts$/,
  /[/\\]src[/\\]contracts[/\\]shared[/\\]typia-transform-sentinel\.spec\.ts$/,
  /[/\\]src[/\\]core[/\\]import[/\\]onshape[/\\]bundle-reader\.ts$/,
  /[/\\]src[/\\]infrastructure[/\\]occ[/\\](?:native-topology-payload|worker-protocol)\.ts$/,
];

export function shouldTransformWithTypia(filePath: string) {
  return typiaTransformInclude.some((pattern) => pattern.test(filePath));
}

/**
 * Cached Typia transforms (docs/adr/0006-uncached-typia-transforms.md, 2026-11-02
 * amendment). The cache key is the validator file's own source, so changing a
 * type it imports reuses the stale validator until `bun run typia:clean`.
 */
export function createTypiaPluginOptions(rootDir: string) {
  return {
    cache: true,
    include: typiaTransformInclude,
    tsconfig: path.resolve(rootDir, "tsconfig.app.json"),
  };
}

export function createTypiaVitePlugins(rootDir: string): PluginOption[] {
  return [UnpluginTypia(createTypiaPluginOptions(rootDir))];
}
