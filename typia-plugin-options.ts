import path from "node:path";

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

export function createTypiaPluginOptions(rootDir: string) {
  return {
    cache: false,
    include: typiaTransformInclude,
    tsconfig: path.resolve(rootDir, "tsconfig.app.json"),
  };
}
