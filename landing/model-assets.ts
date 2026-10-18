import bracket from "./examples/bracket/model.json";
import wheel from "./examples/wheel/model.json";
import enclosure from "./examples/enclosure/model.json";

export type ModelId = "bracket" | "wheel" | "enclosure";
export type Finish = "silver" | "graphite" | "orange" | "black";
export type NativePart = {
  file: string;
  label: string;
  finish: Finish;
  explode: [number, number, number];
};
export type NativeModel = {
  name: string;
  dimensions: string;
  parts: NativePart[];
};

// These manifests describe CLI exports of the same native files opened below.
// Finishes are presentation metadata; they never replace native screw geometry.
export const nativeModels = { bracket, wheel, enclosure } as Record<
  ModelId,
  NativeModel
>;
const meshUrls = import.meta.glob<string>("./examples/*/*.stl", {
  eager: true,
  query: "?url",
  import: "default",
});
export const nativeDocumentUrls = {
  bracket: new URL("./examples/bracket/model.cadara", import.meta.url),
  wheel: new URL("./examples/wheel/model.cadara", import.meta.url),
  enclosure: new URL("./examples/enclosure/model.cadara", import.meta.url),
};
export function nativeMeshUrl(model: ModelId, part: NativePart) {
  const url = meshUrls[`./examples/${model}/${part.file}`];
  if (!url) throw new Error(`Missing CLI mesh export: ${part.file}`);
  return url;
}
