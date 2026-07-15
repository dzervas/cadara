import type { OnshapeGeometricSignature } from "@/contracts/import/onshape-capture-bundle";

const METERS_TO_DOCUMENT_MILLIMETERS = 1000;
const DIMENSIONAL_VECTOR_KEYS = new Set([
  "origin",
  "center",
  "axisOrigin",
  "point",
  "support",
  "low",
  "high",
]);
const DIMENSIONAL_SCALAR_KEYS = new Set(["radius", "diameter", "offset", "distance"]);

function scaleVector(value: unknown): unknown {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number")
    ? value.map((entry) => entry * METERS_TO_DOCUMENT_MILLIMETERS)
    : value;
}

function normalizeDefiningData(data: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = key === "axis" ? "axisDirection" : key;
    if (DIMENSIONAL_VECTOR_KEYS.has(key)) {
      normalized[targetKey] = scaleVector(value);
    } else if (DIMENSIONAL_SCALAR_KEYS.has(key) && typeof value === "number") {
      normalized[targetKey] = value * METERS_TO_DOCUMENT_MILLIMETERS;
    } else if (Array.isArray(value)) {
      normalized[targetKey] = [...value];
    } else if (typeof value === "object" && value !== null) {
      normalized[targetKey] = normalizeDefiningData(value as Record<string, unknown>);
    } else {
      normalized[targetKey] = value;
    }
  }
  return normalized;
}

/** Convert captured meter-based signatures to the document's millimeter units. */
export function normalizeOnshapeTopologySignature(
  signature: OnshapeGeometricSignature,
): OnshapeGeometricSignature {
  return {
    ...signature,
    definingData: signature.definingData
      ? normalizeDefiningData(signature.definingData)
      : undefined,
    centroid: signature.centroid?.map(
      (value) => value * METERS_TO_DOCUMENT_MILLIMETERS,
    ) as [number, number, number] | undefined,
    boundingBox: signature.boundingBox
      ? {
          low: signature.boundingBox.low.map(
            (value) => value * METERS_TO_DOCUMENT_MILLIMETERS,
          ) as [number, number, number],
          high: signature.boundingBox.high.map(
            (value) => value * METERS_TO_DOCUMENT_MILLIMETERS,
          ) as [number, number, number],
        }
      : undefined,
    tessellationSample: signature.tessellationSample?.map(
      (value) => value * METERS_TO_DOCUMENT_MILLIMETERS,
    ),
  };
}
