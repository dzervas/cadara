import type { ImportSplitInterfaceOwnerWitness } from "@/contracts/import/actions";
import type { CadaraBrepFaceRecord } from "@/contracts/modeling/geometry-assets";
import type { DurableRef } from "@/contracts/shared/references";
import type { RollbackTopologySnapshot } from "./rollback-topology-reader";
import { normalizeOnshapeTopologySignature } from "./topology-signature-normalizer";
import { DEFAULT_MATCH_TOLERANCE, matchSignature } from "./signature-matcher";

type Point = readonly [number, number, number];
type FaceRef = Extract<DurableRef, { kind: "face" }>;
const sub = (a: Point, b: Point): [number, number, number] => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(value: Point): [number, number, number] {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length === 0)
    throw new Error("Split owner has unknown orientation.");
  return value.map((entry) => entry / length) as [number, number, number];
}
function normal(a: Point, b: Point, c: Point) {
  const u = sub(b, a),
    v = sub(c, a);
  return unit([
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]);
}
function box(points: readonly Point[]) {
  if (
    points.length === 0 ||
    points.some((point) => point.some((value) => !Number.isFinite(value)))
  )
    throw new Error("Split owner has no finite geometry.");
  const bounds = (fn: (...values: number[]) => number) =>
    [0, 1, 2].map((axis) => fn(...points.map((point) => point[axis]!))) as [
      number,
      number,
      number,
    ];
  return { low: bounds(Math.min), high: bounds(Math.max) };
}
function coherent(normals: readonly Point[], expected: Point) {
  return (
    normals.length > 0 &&
    normals.every(
      (value) =>
        dot(value, expected) >=
        Math.cos(DEFAULT_MATCH_TOLERANCE.angularRadians),
    )
  );
}

type Segment = readonly [Point, Point];
function boundary(triangles: readonly (readonly Point[])[]): Segment[] {
  const edges = new Map<string, { segment: Segment; count: number }>();
  for (const triangle of triangles) {
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const segment: Segment = [triangle[a]!, triangle[b]!];
      const key = segment
        .map((point) => JSON.stringify(point))
        .sort()
        .join("|");
      const previous = edges.get(key);
      edges.set(key, { segment, count: (previous?.count ?? 0) + 1 });
    }
  }
  if ([...edges.values()].some((edge) => edge.count > 2))
    throw new Error("Nonmanifold split trim is unsupported.");
  const result = [...edges.values()]
    .filter((edge) => edge.count === 1)
    .map((edge) => edge.segment);
  if (result.length === 0)
    throw new Error("Split owner has no certified trim boundary.");
  return result;
}
function sameBoundary(left: readonly Segment[], right: readonly Segment[]) {
  const covered = (segments: readonly Segment[], other: readonly Segment[]) =>
    segments.every(([a, b]) => {
      const direction = sub(b, a);
      const length = Math.hypot(...direction);
      if (length === 0)
        throw new Error("Degenerate split trim is unsupported.");
      const tolerance = DEFAULT_MATCH_TOLERANCE.linear;
      const intervals = other
        .flatMap((segment) => {
          const projections = segment.map((point) => {
            const t = dot(sub(point, a), direction) / (length * length);
            const projected = a.map(
              (value, i) => value + t * direction[i]!,
            ) as [number, number, number];
            return { t, distance: Math.hypot(...sub(point, projected)) };
          });
          if (projections.some((point) => point.distance > tolerance))
            return [];
          const low = Math.max(
            0,
            Math.min(...projections.map((point) => point.t)),
          );
          const high = Math.min(
            1,
            Math.max(...projections.map((point) => point.t)),
          );
          return high >= low ? [[low, high] as const] : [];
        })
        .sort((a, b) => a[0] - b[0]);
      if (intervals.length === 0) return false;
      let through = 0;
      for (const [low, high] of intervals) {
        if (low > through + tolerance / length) return false;
        through = Math.max(through, high);
      }
      return through >= 1 - tolerance / length;
    });
  return covered(left, right) && covered(right, left);
}

/** Capture only an unchanged planar owner face at its actual producer boundary. */
export function captureSplitInterfaceOwnerWitness(
  producer: RollbackTopologySnapshot | null,
  consumer: RollbackTopologySnapshot | null,
  faceId: string | null,
): ImportSplitInterfaceOwnerWitness {
  const occurrences = (snapshot: RollbackTopologySnapshot | null) =>
    snapshot?.bodies.flatMap((body) =>
      body.faces
        .filter((face) => face.id === faceId)
        .map((face) => ({ body, face })),
    ) ?? [];
  const before = occurrences(producer),
    after = occurrences(consumer);
  if (
    before.length !== 1 ||
    after.length !== 1 ||
    before[0]!.body.id !== after[0]!.body.id ||
    JSON.stringify(before[0]!.face.facets) !==
      JSON.stringify(after[0]!.face.facets)
  ) {
    throw new Error(
      "Split owner witness is missing, ambiguous, or changed between producer and consumer.",
    );
  }
  const { body, face } = before[0]!;
  const normals = face.facets.map((facet) => {
    if (facet.vertices.length !== 3)
      throw new Error(
        "Split owner requires triangular planar source evidence.",
      );
    return normal(facet.vertices[0]!, facet.vertices[1]!, facet.vertices[2]!);
  });
  const points = face.facets.flatMap((facet) => facet.vertices);
  const orientedNormal = normals[0];
  if (!orientedNormal || !coherent(normals, orientedNormal))
    throw new Error("Split owner source winding is inconsistent.");
  const origin = points[0]!;
  if (
    points.some(
      (point) =>
        Math.abs(dot(sub(point, origin), orientedNormal)) * 1000 >
        DEFAULT_MATCH_TOLERANCE.linear,
    )
  ) {
    throw new Error("Nonplanar split owner evidence is unsupported.");
  }
  return {
    capturedBodyId: body.id,
    capturedFaceId: face.id,
    orientedNormal,
    boundary: boundary(
      face.facets.map((facet) =>
        facet.vertices.map(
          (point) =>
            point.map((value) => value * 1000) as [number, number, number],
        ),
      ),
    ),
    capturedSignature: normalizeOnshapeTopologySignature({
      entityClass: "face",
      geometryType: "plane",
      definingData: { origin, normal: orientedNormal },
      boundingBox: box(points),
    }),
  };
}

/** Candidate membership comes exclusively from the exact output-scoped producer claims. */
export function selectSplitInterfaceOwner(
  witness: ImportSplitInterfaceOwnerWitness | undefined,
  candidates: readonly { reference: FaceRef; face: CadaraBrepFaceRecord }[],
): FaceRef {
  const signature = witness?.capturedSignature;
  const sourceNormal = signature?.definingData?.normal as Point | undefined;
  const origin = signature?.definingData?.origin as Point | undefined;
  if (
    !witness?.capturedBodyId ||
    !witness.capturedFaceId ||
    signature?.entityClass !== "face" ||
    signature.geometryType !== "plane" ||
    !signature.boundingBox ||
    !witness.boundary?.length ||
    !sourceNormal ||
    !origin ||
    !coherent([unit(sourceNormal)], unit(witness.orientedNormal))
  ) {
    throw new Error("Split interface lacks a coherent captured owner witness.");
  }
  const expected = unit(witness.orientedNormal);
  const accepted = candidates.filter(({ reference, face }) => {
    if (face.surface.kind !== "plane" || face.triangles.length === 0)
      throw new Error(
        "Split interface has unknown or unsupported occurrence orientation.",
      );
    const frame = face.surface.frame;
    const match = matchSignature(
      signature,
      [
        {
          entityClass: "face",
          geometryType: "plane",
          reference,
          definingData: { origin: frame.origin, normal: frame.zDirection },
          boundingBox: box(face.meshVertices),
        },
      ],
      { ...DEFAULT_MATCH_TOLERANCE, ambiguityMargin: Infinity },
    );
    if (match.kind !== "unique") return false;
    const normals = face.triangles.map((triangle) => {
      const points = triangle.map((index) => face.meshVertices[index]);
      if (points.some((point) => !point))
        throw new Error("Split interface has malformed native triangles.");
      return normal(points[0]!, points[1]!, points[2]!);
    });
    if (!coherent(normals, normals[0]!))
      throw new Error("Split interface occurrence winding is inconsistent.");
    return (
      coherent(normals, expected) &&
      sameBoundary(
        witness.boundary,
        boundary(
          face.triangles.map((triangle) =>
            triangle.map((index) => face.meshVertices[index]!),
          ),
        ),
      ) &&
      face.meshVertices.every(
        (point) =>
          Math.abs(dot(sub(point, origin), expected)) <=
          DEFAULT_MATCH_TOLERANCE.linear,
      )
    );
  });
  if (accepted.length !== 1)
    throw new Error(
      `Captured split owner certifies ${accepted.length} exact occurrences, expected one.`,
    );
  return accepted[0]!.reference;
}
