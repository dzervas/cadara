import type {
  OnshapeGeometricSignature,
  OnshapeResolvedReference,
} from "@/contracts/import/onshape-capture-bundle";
import type { OnshapeFeatureNode } from "@/domain/import/onshape/bundle-reader";

/**
 * A rigid transform in document millimeters: `world = m · v + t`, where `m` is a
 * row-major 3×3 rotation and `t` a translation. Used to re-express a captured
 * Onshape topology signature into the frame Cadara's parametric probe rebuilds.
 */
export interface RigidTransform {
  m: readonly [number, number, number, number, number, number, number, number, number];
  t: readonly [number, number, number];
}

const METERS_TO_MM = 1000;

const IDENTITY: RigidTransform = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

type Vec3 = readonly [number, number, number];
type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

const POSITIONAL_KEYS = new Set(["origin", "center", "axisOrigin", "point", "support"]);
const DIRECTIONAL_KEYS = new Set(["axisDirection", "direction", "normal"]);

function isIdentity(transform: RigidTransform): boolean {
  return (
    transform === IDENTITY ||
    (transform.m.every((value, index) => value === IDENTITY.m[index]) &&
      transform.t.every((value, index) => value === IDENTITY.t[index]))
  );
}

function applyMatToVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function applyToPoint(transform: RigidTransform, v: Vec3): [number, number, number] {
  const rotated = applyMatToVec(transform.m, v);
  return [rotated[0] + transform.t[0], rotated[1] + transform.t[1], rotated[2] + transform.t[2]];
}

function applyToDirection(transform: RigidTransform, v: Vec3): Vec3 {
  return applyMatToVec(transform.m, v);
}

function matMul(a: Mat3, b: Mat3): Mat3 {
  const result: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      result.push(
        a[row * 3] * b[col] + a[row * 3 + 1] * b[col + 3] + a[row * 3 + 2] * b[col + 6],
      );
    }
  }
  return result as unknown as Mat3;
}

function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Compose two transforms so `compose(a, b)(v) === a(b(v))`. */
function compose(a: RigidTransform, b: RigidTransform): RigidTransform {
  return {
    m: matMul(a.m, b.m),
    t: applyToPoint(a, b.t),
  };
}

/** Invert a rigid transform (rotation transpose plus re-derived translation). */
function invert(transform: RigidTransform): RigidTransform {
  const inverseRotation = transpose(transform.m);
  const negatedTranslation = applyMatToVec(inverseRotation, transform.t);
  return {
    m: inverseRotation,
    t: [-negatedTranslation[0], -negatedTranslation[1], -negatedTranslation[2]],
  };
}

/** Rodrigues rotation matrix about a unit axis by an angle in radians. */
function rotationAboutAxis(axis: Vec3, angleRadians: number): Mat3 | null {
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  if (length === 0) return null;
  const [x, y, z] = [axis[0] / length, axis[1] / length, axis[2] / length];
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

function parameter(feature: OnshapeFeatureNode, id: string): Record<string, unknown> | undefined {
  return (feature.parameters ?? []).find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { parameterId?: unknown }).parameterId === id,
  ) as Record<string, unknown> | undefined;
}

function enumValue(feature: OnshapeFeatureNode, id: string): string | null {
  const value = parameter(feature, id)?.value;
  return typeof value === "string" ? value : null;
}

function booleanValue(feature: OnshapeFeatureNode, id: string): boolean {
  return parameter(feature, id)?.value === true;
}

function angleRadians(feature: OnshapeFeatureNode, id: string): number | null {
  const entry = parameter(feature, id);
  if (!entry) return null;
  const expression = entry.expression;
  if (typeof expression === "string") {
    const match = expression.trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(deg|degree|degrees|rad|radian|radians)?$/i);
    if (match) {
      const value = Number(match[1]);
      const unit = (match[2] ?? "deg").toLowerCase();
      return unit.startsWith("rad") ? value : value * (Math.PI / 180);
    }
  }
  // Onshape quantity values are SI (radians) when the expression is unavailable.
  return typeof entry.value === "number" && Number.isFinite(entry.value) ? entry.value : null;
}

function queryDeterministicId(feature: OnshapeFeatureNode, parameterId: string): string | null {
  const queries = parameter(feature, parameterId)?.queries;
  if (!Array.isArray(queries) || queries.length !== 1) return null;
  const ids = (queries[0] as { deterministicIds?: unknown }).deterministicIds;
  return Array.isArray(ids) && ids.length === 1 && typeof ids[0] === "string" ? ids[0] : null;
}

function toVec3(value: unknown): Vec3 | null {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === "number")
    ? (value as unknown as Vec3)
    : null;
}

/**
 * Resolve the axis line for a rotation transform: prefer the history-point
 * record authored at the transform feature, falling back to the final-state
 * record. Origin is returned in millimeters, direction unit-agnostic.
 */
function resolveAxisLine(
  axisDeterministicId: string,
  transformFeatureId: string,
  resolvedReferences: readonly OnshapeResolvedReference[],
): { origin: Vec3; direction: Vec3 } | null {
  const historyPoint = resolvedReferences.find(
    (reference) =>
      reference.deterministicId === axisDeterministicId &&
      reference.evaluatedAt === "historyPoint" &&
      reference.consumingFeatureId === transformFeatureId &&
      "signature" in reference,
  );
  const finalState = resolvedReferences.find(
    (reference) =>
      reference.deterministicId === axisDeterministicId &&
      reference.evaluatedAt === "finalState" &&
      "signature" in reference,
  );
  const record = historyPoint ?? finalState;
  if (!record || !("signature" in record)) return null;
  const data = record.signature.definingData;
  const origin = data ? toVec3(data.origin) : null;
  const direction = data ? toVec3(data.direction) : null;
  if (!origin || !direction) return null;
  return {
    origin: [origin[0] * METERS_TO_MM, origin[1] * METERS_TO_MM, origin[2] * METERS_TO_MM],
    direction,
  };
}

/**
 * Build the pre→post rigid transform a baked transform feature applies, in
 * millimeters. Only rotations are reconstructed; other transform kinds return
 * null (Cadara either applies them parametrically or cannot reframe them).
 */
function transformForFeature(
  feature: OnshapeFeatureNode,
  resolvedReferences: readonly OnshapeResolvedReference[],
): RigidTransform | null {
  if (booleanValue(feature, "makeCopy")) return null;
  if ((enumValue(feature, "transformType") ?? "") !== "ROTATION") return null;
  const angle = angleRadians(feature, "angle");
  if (angle === null || angle === 0) return null;
  const axisDeterministicId = queryDeterministicId(feature, "transformAxis");
  if (!axisDeterministicId) return null;
  const axis = resolveAxisLine(axisDeterministicId, feature.featureId, resolvedReferences);
  if (!axis) return null;
  const signedAngle = booleanValue(feature, "oppositeDirection") ? -angle : angle;
  const rotation = rotationAboutAxis(axis.direction, signedAngle);
  if (!rotation) return null;
  // world = A + R·(v - A) = R·v + (A - R·A)
  const rotatedOrigin = applyMatToVec(rotation, axis.origin);
  return {
    m: rotation,
    t: [
      axis.origin[0] - rotatedOrigin[0],
      axis.origin[1] - rotatedOrigin[1],
      axis.origin[2] - rotatedOrigin[2],
    ],
  };
}

/**
 * Compute the transform that maps a consumer's captured-frame signatures into
 * the frame Cadara's parametric probe rebuilds. Baked transform features before
 * the consumer are applied to Onshape geometry but skipped by the probe, so the
 * captured signatures must be re-expressed by the inverse of those transforms.
 * Returns `null` when no baked transform precedes the consumer (the common
 * case), so world-frame signatures are never double-transformed.
 */
export function computeCaptureFrameToWorld(input: {
  features: readonly OnshapeFeatureNode[];
  consumerFeatureId: string;
  isParametric: (featureId: string) => boolean;
  resolvedReferences: readonly OnshapeResolvedReference[];
}): RigidTransform | null {
  let world = IDENTITY;
  for (const feature of input.features) {
    if (feature.featureId === input.consumerFeatureId) break;
    if (feature.featureType !== "transform") continue;
    if (input.isParametric(feature.featureId)) continue;
    const transform = transformForFeature(feature, input.resolvedReferences);
    if (!transform) continue;
    world = compose(world, invert(transform));
  }
  return isIdentity(world) ? null : world;
}

/** Compose optional capture-frame reframes so `result(v) === outer(inner(v))`. */
export function composeCaptureFrameTransforms(
  inner: RigidTransform | null | undefined,
  outer: RigidTransform | null | undefined,
): RigidTransform | null {
  if (!inner) return outer ?? null;
  if (!outer) return inner;
  const combined = compose(outer, inner);
  return isIdentity(combined) ? null : combined;
}

/**
 * Compute the transform that maps a consumer's captured creation-frame
 * signatures into the world frame Cadara's parametric probe rebuilds when the
 * preceding transform features are PARAMETRIC. Onshape records a downstream
 * face/edge in the pre-transform (creation) frame, but the parametric probe
 * applies the transform, so the captured signature must be re-expressed by the
 * forward transform. Returns `null` when no parametric transform precedes the
 * consumer, so already-world-frame signatures are never double-transformed.
 */
export function computeParametricTransformReframe(input: {
  features: readonly OnshapeFeatureNode[];
  consumerFeatureId: string;
  isParametric: (featureId: string) => boolean;
  resolvedReferences: readonly OnshapeResolvedReference[];
}): RigidTransform | null {
  let world = IDENTITY;
  for (const feature of input.features) {
    if (feature.featureId === input.consumerFeatureId) break;
    if (feature.featureType !== "transform") continue;
    if (!input.isParametric(feature.featureId)) continue;
    const transform = transformForFeature(feature, input.resolvedReferences);
    if (!transform) continue;
    world = compose(invert(transform), world);
  }
  return isIdentity(world) ? null : world;
}

/** Re-express a normalized captured signature through a world-frame transform. */
export function reframeSignature(
  signature: OnshapeGeometricSignature,
  transform: RigidTransform,
): OnshapeGeometricSignature {
  const reframeDefiningData = (data: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const vector = toVec3(value);
      if (vector && POSITIONAL_KEYS.has(key)) {
        result[key] = applyToPoint(transform, vector);
      } else if (vector && DIRECTIONAL_KEYS.has(key)) {
        result[key] = applyToDirection(transform, vector);
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        result[key] = reframeDefiningData(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  let boundingBox = signature.boundingBox;
  if (boundingBox) {
    const { low, high } = boundingBox;
    const corners: Vec3[] = [];
    for (const x of [low[0], high[0]]) {
      for (const y of [low[1], high[1]]) {
        for (const z of [low[2], high[2]]) {
          corners.push(applyToPoint(transform, [x, y, z]));
        }
      }
    }
    const newLow: [number, number, number] = [Infinity, Infinity, Infinity];
    const newHigh: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const corner of corners) {
      for (const axis of [0, 1, 2] as const) {
        newLow[axis] = Math.min(newLow[axis], corner[axis]);
        newHigh[axis] = Math.max(newHigh[axis], corner[axis]);
      }
    }
    boundingBox = { low: newLow, high: newHigh };
  }

  let tessellationSample = signature.tessellationSample;
  if (tessellationSample && tessellationSample.length % 3 === 0) {
    const reframed: number[] = [];
    for (let index = 0; index < tessellationSample.length; index += 3) {
      const point = applyToPoint(transform, [
        tessellationSample[index]!,
        tessellationSample[index + 1]!,
        tessellationSample[index + 2]!,
      ]);
      reframed.push(point[0], point[1], point[2]);
    }
    tessellationSample = reframed;
  }

  return {
    ...signature,
    definingData: signature.definingData ? reframeDefiningData(signature.definingData) : undefined,
    centroid: signature.centroid ? applyToPoint(transform, signature.centroid) : undefined,
    boundingBox,
    tessellationSample,
  };
}
