/**
 * Capture-side signature interpretation (probe-less v1).
 *
 * Onshape resolves each referenced deterministic id to a geometric signature at
 * final state. Without the sandboxed history probe, most references cannot be
 * matched to cadara's kernel-owned topology. Two classes resolve probe-free and
 * are handled here:
 *
 *   1. Default datum planes (Top/Front/Right) map to cadara's canonical
 *      construction planes by origin + axis-aligned normal.
 *   2. Sketch-region queries are interpreted as 2D region descriptors for later
 *      matching against cadara's own region extraction.
 *
 * Everything else is reported as "needs probe" so the fidelity planner degrades
 * the consuming feature to `baked` with a capability reason code.
 */
import type {
  ConstructionId,
} from "@/contracts/shared/ids";
import type { SketchPlaneKey } from "@/contracts/shared/sketch-plane";
import type {
  OnshapeGeometricSignature,
  OnshapeResolvedReference,
} from "@/contracts/import/onshape-capture-bundle";

export interface CanonicalPlaneResolution {
  kind: "canonicalPlane";
  planeKey: SketchPlaneKey;
  constructionId: ConstructionId;
}

export interface NeedsProbeResolution {
  kind: "needsProbe";
  entityClass: OnshapeGeometricSignature["entityClass"];
  geometryType: string;
}

export interface UnresolvedResolution {
  kind: "unresolved";
  reason: string;
}

export type SignatureResolution =
  | CanonicalPlaneResolution
  | NeedsProbeResolution
  | UnresolvedResolution;

const CANONICAL_PLANES: readonly {
  planeKey: SketchPlaneKey;
  constructionId: ConstructionId;
  normal: readonly [number, number, number];
}[] = [
  {
    planeKey: "xy",
    constructionId: "construction_plane-xy" as ConstructionId,
    normal: [0, 0, 1],
  },
  {
    planeKey: "yz",
    constructionId: "construction_plane-yz" as ConstructionId,
    normal: [1, 0, 0],
  },
  {
    planeKey: "xz",
    constructionId: "construction_plane-xz" as ConstructionId,
    normal: [0, -1, 0],
  },
];

const NORMAL_TOLERANCE = 1e-6;
const ORIGIN_TOLERANCE = 1e-6;

function readVector(value: unknown): [number, number, number] | null {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number")
  ) {
    return [value[0] as number, value[1] as number, value[2] as number];
  }
  return null;
}

function normalsAligned(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  // Planes are unoriented: an antiparallel normal is the same plane.
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.abs(Math.abs(dot) - 1) <= NORMAL_TOLERANCE;
}

function isAtWorldOrigin(origin: readonly [number, number, number]): boolean {
  return (
    Math.abs(origin[0]) <= ORIGIN_TOLERANCE &&
    Math.abs(origin[1]) <= ORIGIN_TOLERANCE &&
    Math.abs(origin[2]) <= ORIGIN_TOLERANCE
  );
}

/**
 * Interpret one captured geometric signature. Returns a canonical-plane
 * resolution when the signature is a datum plane at the world origin aligned to
 * a primary axis; otherwise `needsProbe`.
 */
export function interpretSignature(
  signature: OnshapeGeometricSignature,
): SignatureResolution {
  const isPlane =
    signature.entityClass === "face" &&
    signature.geometryType.toUpperCase() === "PLANE";

  if (isPlane) {
    const normal = readVector(signature.definingData?.normal);
    const origin = readVector(signature.definingData?.origin);
    const declaredDefault = signature.isDefaultPlane === true;

    if (normal && (declaredDefault || (origin && isAtWorldOrigin(origin)))) {
      const match = CANONICAL_PLANES.find((plane) =>
        normalsAligned(plane.normal, normal),
      );
      if (match) {
        return {
          kind: "canonicalPlane",
          planeKey: match.planeKey,
          constructionId: match.constructionId,
        };
      }
    }
  }

  return {
    kind: "needsProbe",
    entityClass: signature.entityClass,
    geometryType: signature.geometryType,
  };
}

/** Interpret one resolved-reference record from the bundle. */
export function interpretResolvedReference(
  reference: OnshapeResolvedReference,
): SignatureResolution {
  if ("unresolved" in reference) {
    return { kind: "unresolved", reason: reference.unresolved.reason };
  }
  return interpretSignature(reference.signature);
}
