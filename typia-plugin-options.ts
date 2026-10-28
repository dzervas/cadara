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

export function createTypiaPluginOptions(
  rootDir: string,
  { cache = false }: { cache?: boolean } = {},
) {
  return {
    cache,
    include: typiaTransformInclude,
    tsconfig: path.resolve(rootDir, "tsconfig.app.json"),
  };
}

/**
 * Typia for Vite (docs/adr/0006-uncached-typia-transforms.md): the dev server
 * and Vitest (`serve`) transform uncached; `vite build` caches, which mostly
 * buys reusing parsed sources across the transformed files of one process.
 */
export function createTypiaVitePlugins(rootDir: string): PluginOption[] {
  return [
    { ...UnpluginTypia(createTypiaPluginOptions(rootDir)), apply: "serve" },
    {
      ...UnpluginTypia(createTypiaPluginOptions(rootDir, { cache: true })),
      apply: "build",
    },
  ];
}
