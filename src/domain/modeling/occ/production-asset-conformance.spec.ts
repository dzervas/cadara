import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";

import type {
  ConstructionSnapshotRecord,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type {
  ConstructionId,
  FeatureId,
  SketchId,
} from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  REVOLVE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import type {
  RegionBoundarySegmentRecord,
  RegionBoundaryVertex,
  RegionRecord,
  SketchRecord,
} from "@/contracts/sketch/schema";
import type { MeshTriangle } from "@/contracts/export/capabilities";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { RegionId, RegionLoopId } from "@/contracts/shared/ids";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import { resolveRegionBoundaryCurve } from "@/contracts/sketch/region-boundary-curves";
import {
  addRectangle,
  closedCurvesSignedArea,
  cubicOracle,
  FIXTURE_SKETCH_ID,
  FIXTURE_TOLERANCE,
  lineOracle,
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
  type OracleCurve,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createOccExportCapabilities } from "@/domain/export/occ-export-capabilities";
import { stlExportProvider } from "@/domain/export/providers/stl-export-provider";
import { threeMfExportProvider } from "@/domain/export/providers/threemf-export-provider";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import { mapSketchPointToWorld } from "@/domain/modeling/occ/geometry";
import { buildOccRenderExport } from "@/domain/modeling/occ/snapshot";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  executeOccFeature,
  type OccFeatureExecutionContext,
} from "@/domain/modeling/occ/features";
import {
  collectOccCleanupErrors,
  releaseOccObjects,
} from "@/domain/modeling/occ/memory";
import {
  buildOpenSketchCurveWire,
  buildRegionProfileFace,
  regionBoundaryBasisOfSketchRecord,
  releaseBuiltSketchProfileFace,
} from "@/domain/modeling/occ/sketch-profile";
import {
  getDefaultOpenCascadeInstance,
  type OpenCascadeInstance,
} from "@/domain/modeling/occ/runtime";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  createStandardPlaneDefinition,
} from "@/domain/modeling/opencascade-kernel-seed";

// T-1 (T10 review R5): the logic lane's default Node runtime is the stock
// opencascade.js package, which binds types the shipped `public/cadara-occ`
// build does not (open problem 8). These rows build every OCC path that makes
// curve edges today through the production feature executor on BOTH runtimes
// and check them against closed-form oracles, so a missing binding on the
// shipped build fails here instead of only in the browser.

type CustomOpenCascadeMainJS = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

let productionRuntime: Promise<OpenCascadeInstance> | null = null;
function loadProductionOcc() {
  productionRuntime ??= (async () => {
    const module = (await import("../../../../public/cadara-occ.js")) as {
      default: CustomOpenCascadeMainJS;
    };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );
    return new module.default({ wasmBinary });
  })();
  return productionRuntime;
}

const RUNTIMES = [
  ["production public/cadara-occ", loadProductionOcc],
  ["stock opencascade.js", getDefaultOpenCascadeInstance],
] as const;

/** Relative error bound for areas and volumes against the closed forms (review A2). */
const RELATIVE = 1e-9;
const DEG = Math.PI / 180;
const HEIGHT = 2;

const deriver = createSketchArrangementDeriver(
  createCertifiedNeutralCurveQueryCapabilityForTest(),
);

function constructionSnapshot(
  plane: SketchPlaneDefinition,
): ConstructionSnapshotRecord {
  const constructionId = (plane.support as { constructionId: ConstructionId })
    .constructionId;
  return {
    ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
    ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    ownerFeatureId: null,
    ownerSketchId: null,
    ownerBodyId: null,
    constructionId,
    label: constructionId,
    constructionType: "plane",
    plane,
    target: { kind: "construction", constructionId },
  };
}

function createContext(
  oc: OpenCascadeInstance,
  sketches: SketchSnapshotRecord[],
  bodies: readonly unknown[] = [],
): OccFeatureExecutionContext {
  const planes = (["xy", "yz", "xz"] as const).map(
    createStandardPlaneDefinition,
  );
  // The same minimal context as features.spec.ts's harness.
  return {
    oc,
    documentId: OCC_KERNEL_DOCUMENT_ID,
    revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    modelingTolerance: FIXTURE_TOLERANCE,
    sketches,
    constructions: planes.map(constructionSnapshot),
    constructionPlanes: new Map(
      planes.map((plane) => [
        (plane.support as { constructionId: ConstructionId }).constructionId,
        plane,
      ]),
    ),
    bodies,
  } as unknown as OccFeatureExecutionContext;
}

/** A sketch snapshot carrying the fixture's solve and the owner's derived regions. */
async function sketchSnapshot(
  fixture: SketchFixture,
  plane: SketchPlaneDefinition,
): Promise<SketchSnapshotRecord> {
  const input = fixture.build();
  const { regions } = await deriver.derive(input);
  const sketchId = FIXTURE_SKETCH_ID as SketchId;
  const ownership = {
    ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
    ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
    ownerFeatureId: null,
    ownerSketchId: sketchId,
    ownerBodyId: null,
  } as const;
  const sketch: SketchRecord = {
    ...ownership,
    sketchId,
    label: sketchId,
    planeSupport: plane.support,
    definition: input.definition,
    solvedSnapshot: input.solvedSnapshot,
    derivedValidity: { state: "current", diagnostics: [] },
    projectedReferences: input.projectedReferences,
    regions: regions as RegionRecord[],
  };
  return { ...ownership, sketchId, label: sketchId, plane, sketch };
}

function shapeProperties(
  oc: OpenCascadeInstance,
  shape: object,
  kind: "volume" | "surface",
) {
  const props = new oc.GProp_GProps_1();
  try {
    if (kind === "volume")
      oc.BRepGProp.VolumeProperties_1(
        shape as never,
        props,
        false,
        false,
        false,
      );
    else oc.BRepGProp.SurfaceProperties_1(shape as never, props, false, false);
    const centre = props.CentreOfMass();
    try {
      return {
        mass: props.Mass(),
        centroid: [centre.X(), centre.Y(), centre.Z()] as const,
      };
    } finally {
      centre.delete();
    }
  } finally {
    props.delete();
  }
}

function producedShape(result: ReturnType<typeof executeOccFeature>) {
  const target = result.producedTargets[0];
  expect(target?.kind, "the feature produces one new body").toBe("body");
  const body = result.bodies.find(
    (entry) => target?.kind === "body" && entry.bodyId === target.bodyId,
  );
  expect(body, "the produced body target resolves").toBeDefined();
  return body!.shape;
}

function expectRelative(actual: number, expected: number, label: string) {
  expect(
    Math.abs(actual - expected) / Math.abs(expected),
    `${label}: ${actual} vs closed form ${expected}`,
  ).toBeLessThanOrEqual(RELATIVE);
}

function expectNear(
  actual: number,
  expected: number,
  scale: number,
  label: string,
) {
  expect(
    Math.abs(actual - expected),
    `${label}: ${actual} vs closed form ${expected}`,
  ).toBeLessThanOrEqual(RELATIVE * scale);
}

/**
 * Closed-form circular segment cut off by the chord of an arc of sweep φ:
 * area r²(φ − sin φ)/2, centroid on the sweep bisector at
 * 4r·sin³(φ/2) / (3(φ − sin φ)) from the centre (valid for φ ∈ (0, 2π)).
 */
function circularSegment(
  center: readonly [number, number],
  radius: number,
  bisector: number,
  sweep: number,
) {
  const area = (radius * radius * (sweep - Math.sin(sweep))) / 2;
  const distance =
    (4 * radius * Math.sin(sweep / 2) ** 3) / (3 * (sweep - Math.sin(sweep)));
  return {
    area,
    centroid: [
      center[0] + distance * Math.cos(bisector),
      center[1] + distance * Math.sin(bisector),
    ] as const,
  };
}

/** An authored arc (by angles) closed by its chord: one region. */
function arcChordFixture(
  center: readonly [number, number],
  radius: number,
  startAngle: number,
  endAngle: number,
  sweep: "clockwise" | "counterClockwise",
) {
  const fixture = makeSketchFixture();
  const at = (angle: number) =>
    [
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ] as const;
  fixture.point("c", ...center);
  fixture.point("s", ...at(startAngle));
  fixture.point("e", ...at(endAngle));
  fixture.arc("arc", "c", "s", "e", sweep);
  fixture.line("chord", "e", "s");
  return fixture;
}

/**
 * The sketch record carrying `regions` (forged records included): a profile
 * resolves only through its own record's basis (T10c), so a forged region is
 * read as one of the record's regions.
 */
function recordWith(
  sketch: SketchSnapshotRecord,
  ...regions: RegionRecord[]
): SketchRecord {
  return { ...sketch.sketch, regions };
}

function extrudeParameters(
  sketch: SketchSnapshotRecord,
  region: RegionRecord,
  boolean: { operation: "newBody" | "cut"; booleanScope: unknown },
) {
  return {
    kind: "extrude",
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      resultBodyType: "solid",
      profiles: [
        {
          kind: "region",
          sketchId: sketch.sketchId,
          regionId: region.regionId,
        },
      ],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: { kind: "blind", direction: "positive", distance: HEIGHT },
      },
      ...boolean,
    },
  } as never;
}

const labelOf = (segment: RegionBoundarySegmentRecord) =>
  segment.branch.source.kind === "entity"
    ? segment.branch.source.entityId.replace(/^sketch_entity_/, "")
    : segment.branch.source.reference.geometryId;

/**
 * Independent area oracle of one boundary segment (review A2): the piece of
 * the record's source geometry, read straight from the solved snapshot or
 * the projection (not through the region-boundary owner), over the record's
 * own interval in traversal order. The shared fixture quadrature
 * (`closedCurvesSignedArea`, composite Gauss–Legendre, exact for the cubic
 * Green integrand) is written independently of
 * `certifyNeutralCurvePieceSignedArea`.
 */
function segmentOracle(
  record: SketchRecord,
  segment: RegionBoundarySegmentRecord,
): OracleCurve {
  const [a, b] = segment.sourceParameterInterval;
  const traversed = (curve: OracleCurve): OracleCurve =>
    segment.traversalDirection === "forward"
      ? { ...curve, from: a, to: b }
      : { ...curve, from: b, to: a };
  const circle = (
    center: readonly [number, number],
    radius: number,
  ): OracleCurve =>
    traversed({
      point: (t) => [
        center[0] + radius * Math.cos(t),
        center[1] + radius * Math.sin(t),
      ],
      derivative: (t) => [-radius * Math.sin(t), radius * Math.cos(t)],
      from: a,
      to: b,
    });
  const source = segment.branch.source;
  if (source.kind === "projectedGeometry") {
    const geometry = record
      .projectedReferences!.find(
        (reference) => reference.referenceId === source.reference.referenceId,
      )!
      .geometry.find(
        (entry) => entry.geometryId === source.reference.geometryId,
      )!;
    switch (geometry.kind) {
      case "lineSegment":
        return traversed(
          lineOracle(geometry.startPosition, geometry.endPosition),
        );
      case "arc":
        return circle(
          geometry.centerPosition,
          Math.hypot(
            geometry.startPosition[0] - geometry.centerPosition[0],
            geometry.startPosition[1] - geometry.centerPosition[1],
          ),
        );
      case "circle":
        return circle(geometry.centerPosition, geometry.radius);
      case "spline": {
        if (geometry.representation.kind !== "neutralCubicSpans")
          throw new Error("oracle: projected samples");
        const span =
          geometry.representation.spans[
            Number(segment.branch.spanId.slice(4))
          ]!;
        return traversed(cubicOracle(span.poles, span.interval, a, b));
      }
      default:
        throw new Error(`oracle: projected ${geometry.kind}`);
    }
  }
  const solved = record.solvedSnapshot.solvedEntities.find(
    (entity) => entity.entityId === source.entityId,
  )!;
  switch (solved.kind) {
    case "lineSegment":
      return traversed(lineOracle(solved.startPosition, solved.endPosition));
    case "arc":
      return circle(
        solved.centerPosition,
        Math.hypot(
          solved.startPosition[0] - solved.centerPosition[0],
          solved.startPosition[1] - solved.centerPosition[1],
        ),
      );
    case "circle":
      return circle(solved.centerPosition, solved.solvedRadius);
    case "spline": {
      const span = solved.reconstruction.spans.find(
        (candidate) =>
          `${candidate.source.startOccurrenceId}>${candidate.source.endOccurrenceId}` ===
          segment.branch.spanId,
      )!;
      return traversed(cubicOracle(span.poles, span.interval, a, b));
    }
    default:
      throw new Error(`oracle: ${solved.kind}`);
  }
}

/** Signed oracle area of a region: outer loops counter-clockwise, holes clockwise. */
function regionOracleArea(record: SketchRecord, region: RegionRecord) {
  return region.loops.reduce(
    (total, loop) =>
      total +
      closedCurvesSignedArea(
        loop.segments.map((segment) => segmentOracle(record, segment)),
      ),
    0,
  );
}

/** Face area and prism volume of a region against the independent oracle (≤ 1e-9 rel.). */
function expectPrismMatchesOracle(
  oc: OpenCascadeInstance,
  context: OccFeatureExecutionContext,
  sketch: SketchSnapshotRecord,
  region: RegionRecord,
  label: string,
) {
  const area = regionOracleArea(sketch.sketch, region);
  expect(area, `${label}: premise, a positive oracle area`).toBeGreaterThan(0);
  const built = buildRegionProfileFace(
    oc,
    {
      plane: sketch.plane,
      sketch: sketch.sketch,
      modelingTolerance: FIXTURE_TOLERANCE,
    },
    region,
  );
  try {
    expectRelative(
      shapeProperties(oc, built.face, "surface").mass,
      area,
      `${label} face area`,
    );
  } finally {
    releaseBuiltSketchProfileFace(built);
  }
  const solid = shapeProperties(
    oc,
    producedShape(extrudeRegion(context, sketch, region, "solid")),
    "volume",
  );
  expectRelative(solid.mass, area * HEIGHT, `${label} prism volume`);
}

/**
 * Exact source witnesses on the built face: every OCC edge's curve value at
 * each end of its parameter range lies within its vertex's tolerance, every
 * vertex sits at one of the record's vertex representatives (an unsplit
 * circle's seam aside), and the face has one edge per record segment.
 */
function expectExactFaceWitnesses(
  oc: OpenCascadeInstance,
  sketch: SketchSnapshotRecord,
  region: RegionRecord,
  label: string,
) {
  const segments = region.loops.flatMap((loop) => loop.segments);
  const representatives = segments
    .flatMap((segment) => [segment.start, segment.end])
    .flatMap((vertex) =>
      vertex ? [mapSketchPointToWorld(sketch.plane, vertex.position)] : [],
    );
  const unsplitCircle = segments.some((segment) => segment.start === null);
  const built = buildRegionProfileFace(
    oc,
    {
      plane: sketch.plane,
      sketch: sketch.sketch,
      modelingTolerance: FIXTURE_TOLERANCE,
    },
    region,
  );
  try {
    const explorer = new oc.TopExp_Explorer_2(
      built.face as never,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    let edges = 0;
    try {
      while (explorer.More()) {
        const shape = explorer.Current();
        const edge = oc.TopoDS.Edge_1(shape);
        const adaptor = new oc.BRepAdaptor_Curve_2(edge);
        try {
          for (const [parameter, vertex] of [
            [adaptor.FirstParameter(), oc.TopExp.FirstVertex(edge, false)],
            [adaptor.LastParameter(), oc.TopExp.LastVertex(edge, false)],
          ] as const) {
            const value = adaptor.Value(parameter);
            const point = oc.BRep_Tool.Pnt(vertex);
            try {
              const at = [point.X(), point.Y(), point.Z()];
              expect(
                Math.hypot(
                  value.X() - at[0]!,
                  value.Y() - at[1]!,
                  value.Z() - at[2]!,
                ),
                `${label}: the OCC curve value at edge ${edges}'s end lies within its vertex tolerance`,
              ).toBeLessThanOrEqual(oc.BRep_Tool.Tolerance_3(vertex));
              expect(
                unsplitCircle ||
                  representatives.some(
                    (position) =>
                      position[0] === at[0] &&
                      position[1] === at[1] &&
                      position[2] === at[2],
                  ),
                `${label}: edge ${edges}'s vertex is a record vertex representative`,
              ).toBe(true);
            } finally {
              value.delete();
              point.delete();
              vertex.delete();
            }
          }
        } finally {
          adaptor.delete();
          edge.delete();
          shape.delete();
        }
        edges += 1;
        explorer.Next();
      }
    } finally {
      explorer.delete();
    }
    expect(edges, `${label}: one OCC edge per record segment`).toBe(
      segments.length,
    );
  } finally {
    releaseBuiltSketchProfileFace(built);
  }
}

/** A diamond hole whose bottom corner is declared on the square's bottom side (hole↔outer). */
function touchingDiamond() {
  const fixture = makeSketchFixture();
  addRectangle(fixture, "r", [0, 0, 10, 10]);
  for (const [name, x, y] of [
    ["d0", 5, 0],
    ["d1", 7, 3],
    ["d2", 5, 6],
    ["d3", 3, 3],
  ] as const)
    fixture.point(name, x, y);
  for (let index = 0; index < 4; index += 1)
    fixture.line(`e${index}`, `d${index}`, `d${(index + 1) % 4}`);
  fixture.pointOnCurve("d0", "r_s0");
  return fixture;
}

/**
 * A hand-built one-loop region on the arrangement's own branches, for shapes
 * the owner does not publish: each piece runs forward over `interval` from
 * `from` to `to`; consecutive pieces meet at forged declared joins at those
 * positions (registering the authored point there, if any).
 */
function forgedLoopRegion(
  sketch: SketchSnapshotRecord,
  pieces: readonly {
    source: RegionBoundarySegmentRecord["branch"]["source"];
    interval: readonly [number, number];
    from: readonly [number, number];
    to: readonly [number, number];
  }[],
): RegionRecord {
  const record = sketch.sketch;
  const join = (position: readonly [number, number]): RegionBoundaryVertex => {
    const point = record.definition.points.find(
      (entry) =>
        entry.position[0] === position[0] && entry.position[1] === position[1],
    );
    return {
      kind: "declaredJoin",
      key: `j[${JSON.stringify(point?.pointId ?? position)}]`,
      pointIds: point ? [point.pointId] : [],
      portPointId: point?.pointId ?? null,
      position,
      ballRadius: 1e-12,
    };
  };
  const regionId = "region_t10c_forged" as RegionId;
  return {
    ownerDocumentId: record.ownerDocumentId,
    ownerRevisionId: record.ownerRevisionId,
    ownerFeatureId: null,
    ownerSketchId: record.sketchId,
    ownerBodyId: null,
    regionId,
    signature: "forged",
    label: "forged",
    target: { kind: "region", sketchId: record.sketchId, regionId },
    sourceSketch: { kind: "sketch", sketchId: record.sketchId },
    loops: [
      {
        loopId: "region_loop_t10c_forged" as RegionLoopId,
        role: "outer",
        orientation: "counterClockwise",
        segments: pieces.map((piece) => ({
          branch: { source: piece.source, spanId: "whole" },
          sourceParameterInterval: piece.interval,
          traversalDirection: "forward",
          start: join(piece.from),
          end: join(piece.to),
          sourceSegmentOrdinal: 0,
        })),
        isClosed: true,
      },
    ],
    isClosed: true,
  };
}

/** A forged micro arc + chord region (an `arc` from `s` to `e`, closed by `chord`). */
function forgedArcChordRegion(
  sketch: SketchSnapshotRecord,
  interval: readonly [number, number],
): RegionRecord {
  const { definition } = sketch.sketch;
  const entity = (label: string) =>
    ({
      kind: "entity",
      entityId: definition.entities.find((entry) => entry.label === label)!
        .entityId,
    }) as const;
  const at = (label: string) =>
    definition.points.find((entry) => entry.label === label)!.position;
  return forgedLoopRegion(sketch, [
    { source: entity("arc"), interval, from: at("s"), to: at("e") },
    { source: entity("chord"), interval: [0, 1], from: at("e"), to: at("s") },
  ]);
}

/** Signed volume enclosed by a triangle mesh (divergence theorem). */
function meshVolume(triangles: readonly MeshTriangle[]) {
  return triangles.reduce((total, { vertices: [p, q, r] }) => {
    const cross = [
      q[1] * r[2] - q[2] * r[1],
      q[2] * r[0] - q[0] * r[2],
      q[0] * r[1] - q[1] * r[0],
    ];
    return total + (p[0] * cross[0]! + p[1] * cross[1]! + p[2] * cross[2]!) / 6;
  }, 0);
}

/** Directed mesh edges whose reverse occurs a different number of times. */
function unmatchedDirectedEdges(triangles: readonly MeshTriangle[]) {
  const counts = new Map<string, number>();
  const key = (from: readonly number[], to: readonly number[]) =>
    `${from.join(",")}>${to.join(",")}`;
  for (const { vertices } of triangles)
    vertices.forEach((from, index) => {
      const edge = key(from, vertices[(index + 1) % 3]!);
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    });
  return [...counts].filter(([edge, count]) => {
    const [from, to] = edge.split(">");
    return (counts.get(`${to}>${from}`) ?? 0) !== count;
  });
}

/** The sketch with one constraint's solve status replaced (an open curve set derives no region). */
function withConstraintStatus(
  snapshot: SketchSnapshotRecord,
  constraintId: string,
  status: "satisfied" | "unsatisfied",
): SketchSnapshotRecord {
  const solvedSnapshot = snapshot.sketch.solvedSnapshot;
  return {
    ...snapshot,
    sketch: {
      ...snapshot.sketch,
      solvedSnapshot: {
        ...solvedSnapshot,
        constraintStatuses: solvedSnapshot.constraintStatuses.map((entry) =>
          entry.constraintId === constraintId ? { ...entry, status } : entry,
        ),
      },
    },
  };
}

function entityIdOf(snapshot: SketchSnapshotRecord, label: string) {
  return snapshot.sketch.definition.entities.find(
    (entity) => entity.label === label,
  )!.entityId;
}

function openWire(
  oc: OpenCascadeInstance,
  snapshot: SketchSnapshotRecord,
  labels: readonly string[],
) {
  return buildOpenSketchCurveWire(
    oc,
    {
      plane: snapshot.plane,
      sketch: snapshot.sketch,
      modelingTolerance: FIXTURE_TOLERANCE,
    },
    labels.map((label) => entityIdOf(snapshot, label)),
  );
}

function releaseOpenWire(built: ReturnType<typeof buildOpenSketchCurveWire>) {
  releaseOccObjects([
    built.wire,
    ...built.provenance.edges.values(),
    ...built.provenance.vertices.values(),
  ]);
}

function openSurfaceExtrude(
  oc: OpenCascadeInstance,
  snapshot: SketchSnapshotRecord,
  labels: readonly string[],
) {
  return shapeProperties(
    oc,
    producedShape(
      executeOccFeature(
        createContext(oc, [snapshot]),
        "feature_t10d_open_extrude" as FeatureId,
        {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            resultBodyType: "surface",
            profiles: labels.map((label) => ({
              kind: "sketchEntity",
              sketchId: snapshot.sketchId,
              entityId: entityIdOf(snapshot, label),
            })),
            startExtent: { kind: "profilePlane" },
            extent: {
              mode: "oneSide",
              end: { kind: "blind", direction: "positive", distance: HEIGHT },
            },
          },
        } as never,
      ),
    ),
    "surface",
  );
}

const GAUSS_5 = [
  [0, 128 / 225],
  [-0.5384693101056831, 0.47862867049936647],
  [0.5384693101056831, 0.47862867049936647],
  [-0.906179845938664, 0.23692688505618908],
  [0.906179845938664, 0.23692688505618908],
] as const;

/**
 * ∫ weight(B(u))·|B'(u)| du over [0, 1] for the planar cubic B with `poles`:
 * composite 5-point Gauss–Legendre on 256 cells (independent of OCC and of
 * the arrangement; weight 1 is the arc length).
 */
function cubicArcIntegral(
  poles: readonly (readonly [number, number])[],
  weight: (point: readonly [number, number]) => number = () => 1,
) {
  const [p0, p1, p2, p3] = poles as readonly (readonly [number, number])[];
  const cells = 256;
  let sum = 0;
  for (let cell = 0; cell < cells; cell += 1)
    for (const [node, w] of GAUSS_5) {
      const u = (cell + (node + 1) / 2) / cells;
      const v = 1 - u;
      const derivative = [0, 1].map(
        (axis) =>
          3 *
          (v * v * (p1![axis]! - p0![axis]!) +
            2 * u * v * (p2![axis]! - p1![axis]!) +
            u * u * (p3![axis]! - p2![axis]!)),
      );
      const point = [0, 1].map(
        (axis) =>
          v * v * v * p0![axis]! +
          3 * u * v * v * p1![axis]! +
          3 * u * u * v * p2![axis]! +
          u * u * u * p3![axis]!,
      ) as unknown as readonly [number, number];
      sum +=
        (w / 2 / cells) *
        weight(point) *
        Math.hypot(derivative[0]!, derivative[1]!);
    }
  return sum;
}

function splineSpans(snapshot: SketchSnapshotRecord, label: string) {
  const id = entityIdOf(snapshot, label);
  const geometry = snapshot.sketch.solvedSnapshot.solvedEntities.find(
    (entity) => entity.entityId === id,
  )!;
  if (
    geometry.kind !== "spline" ||
    geometry.reconstruction.validity !== "valid"
  )
    throw new Error(`premise: ${label} is a valid spline`);
  return geometry.reconstruction.spans;
}

function extrudeRegion(
  context: OccFeatureExecutionContext,
  sketch: SketchSnapshotRecord,
  region: RegionRecord,
  resultBodyType: "solid" | "surface",
) {
  return executeOccFeature(
    context,
    `feature_t10c0_extrude_${resultBodyType}` as FeatureId,
    {
      kind: "extrude",
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
        resultBodyType,
        profiles: [
          {
            kind: "region",
            sketchId: sketch.sketchId,
            regionId: region.regionId,
          },
        ],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: HEIGHT },
        },
        ...(resultBodyType === "solid"
          ? {
              operation: "newBody" as const,
              booleanScope: { kind: "standalone" as const },
            }
          : {}),
      },
    } as never,
  );
}

describe("src/domain/modeling/occ/production-asset-conformance.spec.ts", () => {
  const arcRows = [
    {
      name: "minor ccw arc (90°)",
      center: [0.5, -0.25] as const,
      radius: 3,
      start: 20 * DEG,
      end: 110 * DEG,
      sweep: "counterClockwise" as const,
      bisector: 65 * DEG,
      angle: 90 * DEG,
    },
    {
      name: "major ccw arc (250°)",
      center: [-1, 2] as const,
      radius: 2.5,
      start: 30 * DEG,
      end: 280 * DEG,
      sweep: "counterClockwise" as const,
      bisector: 155 * DEG,
      angle: 250 * DEG,
    },
    {
      name: "ccw arc starting at a negative angle (−100° → 20°)",
      center: [1, 1] as const,
      radius: 2,
      start: -100 * DEG,
      end: 20 * DEG,
      sweep: "counterClockwise" as const,
      bisector: -40 * DEG,
      angle: 120 * DEG,
    },
    {
      name: "cw major arc from a negative angle (−100° → 20° clockwise)",
      center: [1, 1] as const,
      radius: 2,
      start: -100 * DEG,
      end: 20 * DEG,
      sweep: "clockwise" as const,
      bisector: 140 * DEG,
      angle: 240 * DEG,
    },
  ];

  for (const [runtimeName, loadRuntime] of RUNTIMES) {
    for (const row of arcRows) {
      test(`${runtimeName}: arc + chord region extrudes to the closed-form segment prism — ${row.name}`, async () => {
        const oc = await loadRuntime();
        const sketch = await sketchSnapshot(
          arcChordFixture(
            row.center,
            row.radius,
            row.start,
            row.end,
            row.sweep,
          ),
          createStandardPlaneDefinition("xy"),
        );
        expect(
          sketch.sketch.regions,
          "the arc and its chord bound one region",
        ).toHaveLength(1);
        const context = createContext(oc, [sketch]);
        const segment = circularSegment(
          row.center,
          row.radius,
          row.bisector,
          row.angle,
        );
        const solid = shapeProperties(
          oc,
          producedShape(
            extrudeRegion(context, sketch, sketch.sketch.regions[0]!, "solid"),
          ),
          "volume",
        );
        expectRelative(solid.mass, segment.area * HEIGHT, `${row.name} volume`);
        // The centroid side of the chord proves the arc direction.
        const scale = Math.hypot(...row.center) + row.radius;
        expectNear(
          solid.centroid[0],
          segment.centroid[0],
          scale,
          `${row.name} centroid x`,
        );
        expectNear(
          solid.centroid[1],
          segment.centroid[1],
          scale,
          `${row.name} centroid y`,
        );
        expectNear(
          solid.centroid[2],
          HEIGHT / 2,
          scale,
          `${row.name} centroid z`,
        );

        // Surface extrude of the same region builds its boundary wire.
        const sheet = shapeProperties(
          oc,
          producedShape(
            extrudeRegion(
              context,
              sketch,
              sketch.sketch.regions[0]!,
              "surface",
            ),
          ),
          "surface",
        );
        const perimeter =
          row.radius * row.angle + 2 * row.radius * Math.sin(row.angle / 2);
        expectRelative(
          sheet.mass,
          perimeter * HEIGHT,
          `${row.name} boundary sheet area`,
        );
      });
    }

    test(`${runtimeName}: a circle split by a line builds both arc-bounded cells`, async () => {
      const oc = await loadRuntime();
      const fixture = makeSketchFixture();
      const radius = 2;
      fixture.point("c", 0.25, -0.5);
      fixture.circle("disk", "c", radius);
      fixture.point("l0", -3, 0.5);
      fixture.point("l1", 3.5, 0.5);
      fixture.line("cut", "l0", "l1");
      const sketch = await sketchSnapshot(
        fixture,
        createStandardPlaneDefinition("xy"),
      );
      expect(
        sketch.sketch.regions,
        "the chord splits the disk into two cells",
      ).toHaveLength(2);
      const context = createContext(oc, [sketch]);
      // The chord is 1 above the centre: the cap has half-angle acos(1/2).
      const angle = 2 * Math.acos(1 / radius);
      const cap = circularSegment([0.25, -0.5], radius, Math.PI / 2, angle);
      const diskArea = Math.PI * radius * radius;
      const rest = {
        area: diskArea - cap.area,
        centroid: [
          0.25,
          -0.5 - (cap.area * (cap.centroid[1] + 0.5)) / (diskArea - cap.area),
        ] as const,
      };
      const built = sketch.sketch.regions.map((region) =>
        shapeProperties(
          oc,
          producedShape(extrudeRegion(context, sketch, region, "solid")),
          "volume",
        ),
      );
      const [small, large] = [...built].sort((a, b) => a.mass - b.mass);
      for (const [label, solid, expected] of [
        ["cap", small!, cap],
        ["remainder", large!, rest],
      ] as const) {
        expectRelative(
          solid.mass,
          expected.area * HEIGHT,
          `split circle ${label} volume`,
        );
        expectNear(
          solid.centroid[0],
          expected.centroid[0],
          3,
          `split circle ${label} centroid x`,
        );
        expectNear(
          solid.centroid[1],
          expected.centroid[1],
          3,
          `split circle ${label} centroid y`,
        );
      }
    });

    test(`${runtimeName}: a line/arc rounded rectangle extrudes to its closed form`, async () => {
      const oc = await loadRuntime();
      const fixture = makeSketchFixture();
      const [w, h, r] = [10, 6, 1.5];
      for (const [name, x, y] of [
        ["a", r, 0],
        ["b", w - r, 0],
        ["c", w, r],
        ["d", w, h - r],
        ["e", w - r, h],
        ["f", r, h],
        ["g", 0, h - r],
        ["h", 0, r],
        ["k1", w - r, r],
        ["k2", w - r, h - r],
        ["k3", r, h - r],
        ["k4", r, r],
      ] as const)
        fixture.point(name, x, y);
      fixture.line("l1", "a", "b");
      fixture.arc("a1", "k1", "b", "c");
      fixture.line("l2", "c", "d");
      fixture.arc("a2", "k2", "d", "e");
      fixture.line("l3", "e", "f");
      fixture.arc("a3", "k3", "f", "g");
      fixture.line("l4", "g", "h");
      fixture.arc("a4", "k4", "h", "a");
      const sketch = await sketchSnapshot(
        fixture,
        createStandardPlaneDefinition("xy"),
      );
      expect(sketch.sketch.regions).toHaveLength(1);
      const solid = shapeProperties(
        oc,
        producedShape(
          extrudeRegion(
            createContext(oc, [sketch]),
            sketch,
            sketch.sketch.regions[0]!,
            "solid",
          ),
        ),
        "volume",
      );
      expectRelative(
        solid.mass,
        (w * h - (4 - Math.PI) * r * r) * HEIGHT,
        "rounded rectangle volume",
      );
      expectNear(solid.centroid[0], w / 2, w, "rounded rectangle centroid x");
      expectNear(solid.centroid[1], h / 2, w, "rounded rectangle centroid y");
    });

    test(`${runtimeName}: an open arc surface-extrudes and a half disk revolves`, async () => {
      const oc = await loadRuntime();
      const radius = 2;
      // Half disk right of the y axis: a ccw arc −90° → 90° (negative start
      // angle) closed by its diameter on the axis.
      const fixture = makeSketchFixture();
      fixture.point("c", 0, 0);
      fixture.point("s", 0, -radius);
      fixture.point("e", 0, radius);
      fixture.arc("arc", "c", "s", "e");
      fixture.line("axis", "e", "s");
      const sketch = await sketchSnapshot(
        fixture,
        createStandardPlaneDefinition("xy"),
      );
      expect(sketch.sketch.regions).toHaveLength(1);
      const context = createContext(oc, [sketch]);
      const arcId = sketch.sketch.definition.entities.find(
        (entity) => entity.label === "arc",
      )!.entityId;
      const axisId = sketch.sketch.definition.entities.find(
        (entity) => entity.label === "axis",
      )!.entityId;

      // Open-curve profile (buildOpenSketchCurveWire): a half-cylinder sheet.
      const openSheet = executeOccFeature(
        context,
        "feature_t10c0_open_arc" as FeatureId,
        {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
            resultBodyType: "surface",
            profiles: [
              {
                kind: "sketchEntity",
                sketchId: sketch.sketchId,
                entityId: arcId,
              },
            ],
            startExtent: { kind: "profilePlane" },
            extent: {
              mode: "oneSide",
              end: { kind: "blind", direction: "positive", distance: HEIGHT },
            },
          },
        } as never,
      );
      const sheet = shapeProperties(oc, producedShape(openSheet), "surface");
      expectRelative(
        sheet.mass,
        Math.PI * radius * HEIGHT,
        "open arc sheet area",
      );
      expectNear(
        sheet.centroid[0],
        (2 * radius) / Math.PI,
        radius,
        "open arc sheet centroid x (arc side)",
      );

      // Revolve the half disk by π about its diameter (Pappus: π · 2r³/3).
      const revolve = executeOccFeature(
        context,
        "feature_t10c0_revolve" as FeatureId,
        {
          kind: "revolve",
          featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
          parameters: {
            resultBodyType: "solid",
            profiles: [
              {
                kind: "region",
                sketchId: sketch.sketchId,
                regionId: sketch.sketch.regions[0]!.regionId,
              },
            ],
            axis: {
              kind: "sketchEntity",
              sketchId: sketch.sketchId,
              entityId: axisId,
            },
            startAngle: 0,
            extent: {
              mode: "oneSide",
              end: {
                kind: "blind",
                direction: "counterClockwise",
                angle: Math.PI,
              },
            },
            operation: "newBody",
            booleanScope: { kind: "standalone" },
          },
        } as never,
      );
      const solid = shapeProperties(oc, producedShape(revolve), "volume");
      expectRelative(
        solid.mass,
        (2 * Math.PI * radius ** 3) / 3,
        "revolved half disk volume",
      );
    });

    test(`${runtimeName}: a square sweeps along a solved sketch arc path`, async () => {
      const oc = await loadRuntime();
      const profileFixture = makeSketchFixture();
      addRectangle(profileFixture, "p", [-0.2, -0.2, 0.2, 0.2]);
      const profile = await sketchSnapshot(
        profileFixture,
        createStandardPlaneDefinition("xy"),
      );
      expect(profile.sketch.regions).toHaveLength(1);

      // Path on the XZ plane (sketch (u, v) → world (u, 0, v)): a clockwise
      // arc about (R, 0) from the profile centroid (angle π) to angle π/3.
      const pathRadius = 3;
      const pathAngle = (2 * Math.PI) / 3;
      const pathFixture = makeSketchFixture();
      pathFixture.point("c", pathRadius, 0);
      pathFixture.point("s", 0, 0);
      pathFixture.point(
        "e",
        pathRadius + pathRadius * Math.cos(Math.PI / 3),
        pathRadius * Math.sin(Math.PI / 3),
      );
      pathFixture.arc("path", "c", "s", "e", "clockwise");
      const path = {
        ...(await sketchSnapshot(
          pathFixture,
          createStandardPlaneDefinition("xz"),
        )),
        sketchId: "sketch_t10c0_path" as SketchId,
      };
      const pathEntityId = path.sketch.definition.entities[0]!.entityId;
      const context = createContext(oc, [profile, path]);
      const sweep = executeOccFeature(
        context,
        "feature_t10c0_sweep" as FeatureId,
        {
          kind: "sweep",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            operationIntent: "create",
            participants: [
              {
                role: "profile",
                targets: [
                  {
                    kind: "region",
                    sketchId: profile.sketchId,
                    regionId: profile.sketch.regions[0]!.regionId,
                  },
                ],
              },
              {
                role: "path",
                targets: [
                  {
                    kind: "sketchEntity",
                    sketchId: path.sketchId,
                    entityId: pathEntityId,
                  },
                ],
              },
            ],
          },
        } as never,
      );
      const solid = shapeProperties(oc, producedShape(sweep), "volume");
      // Pappus: the profile centroid sits on the path, at distance R from the
      // path circle's axis, and travels R·φ.
      expectRelative(
        solid.mass,
        0.16 * pathRadius * pathAngle,
        "arc-path sweep volume",
      );
      const chordCentroid =
        (2 * pathRadius * Math.sin(pathAngle / 2)) / pathAngle;
      // Centroid of the swept body (thin tube about the path): on the bisector
      // at 2π/3, about R·sin(φ/2)/(φ/2) from the axis (to the tube's width).
      const bisector = (2 * Math.PI) / 3;
      expect(
        Math.hypot(
          solid.centroid[0] - (pathRadius + chordCentroid * Math.cos(bisector)),
          solid.centroid[2] - chordCentroid * Math.sin(bisector),
        ),
        "the sweep follows the clockwise path (centroid near the arc's mean point)",
      ).toBeLessThan(0.02);
    });
    test(`${runtimeName}: a boundary vertex absorbs an arc-end gap up to its cap and fails closed beyond it`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const center = [0.5, -0.25] as const;
      const radius = 3;
      const sketch = await sketchSnapshot(
        arcChordFixture(
          center,
          radius,
          20 * DEG,
          110 * DEG,
          "counterClockwise",
        ),
        plane,
      );
      const [region] = sketch.sketch.regions;
      const arcSegment = region!.loops[0]!.segments.find(
        (segment) =>
          segment.branch.source.kind === "entity" &&
          segment.branch.source.entityId.endsWith("_arc"),
      )!;
      const join = arcSegment.start!;
      expect(join.kind, "the arc start is a declared join").toBe(
        "declaredJoin",
      );
      const cap = Math.min(
        (join as Extract<RegionBoundaryVertex, { kind: "declaredJoin" }>)
          .ballRadius,
        FIXTURE_TOLERANCE,
      );
      // Moves the join representative radially inward, off the circle by
      // `gap` (inward keeps the chord inside the arc; an outward move makes
      // the chord cross the arc, a genuinely invalid face).
      const moved = (gap: number): RegionRecord => {
        const direction = [
          join.position[0] - center[0],
          join.position[1] - center[1],
        ];
        const length = Math.hypot(direction[0]!, direction[1]!);
        const position = [
          join.position[0] - (gap * direction[0]!) / length,
          join.position[1] - (gap * direction[1]!) / length,
        ] as const;
        return {
          ...region!,
          loops: region!.loops.map((loop) => ({
            ...loop,
            segments: loop.segments.map((segment) => ({
              ...segment,
              start:
                segment.start?.key === join.key
                  ? { ...segment.start, position }
                  : segment.start,
              end:
                segment.end?.key === join.key
                  ? { ...segment.end, position }
                  : segment.end,
            })),
          })),
        };
      };
      const joinTolerance = (record: RegionRecord) => {
        const built = buildRegionProfileFace(
          oc,
          {
            plane,
            sketch: recordWith(sketch, record),
            modelingTolerance: FIXTURE_TOLERANCE,
          },
          record,
        );
        try {
          const analyzer = new oc.BRepCheck_Analyzer(built.face, true, false);
          expect(analyzer.IsValid_2(), "the face is BRepCheck-valid").toBe(
            true,
          );
          analyzer.delete();
          const pointId = (
            join as Extract<RegionBoundaryVertex, { kind: "declaredJoin" }>
          ).pointIds[0]!;
          return oc.BRep_Tool.Tolerance_3(
            built.provenance.vertices.get(pointId)!,
          );
        } finally {
          releaseBuiltSketchProfileFace(built);
        }
      };
      const point = new oc.gp_Pnt_3(0, 0, 0);
      const fresh = new oc.BRepBuilderAPI_MakeVertex(point);
      const freshVertex = fresh.Vertex();
      const defaultTolerance = oc.BRep_Tool.Tolerance_3(freshVertex);
      for (const object of [freshVertex, fresh, point]) object.delete();
      // OCC's own edge construction may round the default up by a few ulps.
      expect(
        Math.abs(joinTolerance(region!) - defaultTolerance),
        "gap 0 keeps OCC's default vertex tolerance",
      ).toBeLessThanOrEqual(4 * Number.EPSILON * defaultTolerance);
      const half = 0.5 * cap;
      expect(
        Math.abs(joinTolerance(moved(half)) - half),
        "gap ½·cap builds with the measured gap as the vertex tolerance (within the rounding bound)",
      ).toBeLessThanOrEqual(1e-12);
      const overCap = moved(1.5 * cap);
      expect(
        () =>
          buildRegionProfileFace(
            oc,
            {
              plane,
              sketch: recordWith(sketch, overCap),
              modelingTolerance: FIXTURE_TOLERANCE,
            },
            overCap,
          ),
        "a gap above the join's cap fails closed",
      ).toThrow(/^profile-vertex-gap-exceeds-join: /);
      // Moved outward within the cap, the chord crosses the arc: every edge
      // builds, and BRepCheck rejects the self-crossing face (no healing).
      const selfCrossing = moved(-0.5 * cap);
      expect(
        () =>
          buildRegionProfileFace(
            oc,
            {
              plane,
              sketch: recordWith(sketch, selfCrossing),
              modelingTolerance: FIXTURE_TOLERANCE,
            },
            selfCrossing,
          ),
        "a face BRepCheck rejects fails closed",
      ).toThrow(/^profile-face-invalid: /);

      // A verified intersection's cap is its witness enclosure, not τ (R6):
      // a split-circle crossing moved 1e-6 (≪ τ) off its witness fails closed.
      const split = makeSketchFixture();
      split.point("c", 0, 0);
      split.circle("disk", "c", 2);
      split.point("l0", -3, 1);
      split.point("l1", 3, 1);
      split.line("cut", "l0", "l1");
      const splitSketch = await sketchSnapshot(split, plane);
      const cell = splitSketch.sketch.regions[0]!;
      const crossing = cell.loops[0]!.segments.find(
        (segment) => segment.start?.kind === "verifiedIntersection",
      )!.start!;
      const shifted: RegionRecord = {
        ...cell,
        loops: cell.loops.map((loop) => ({
          ...loop,
          segments: loop.segments.map((segment) => ({
            ...segment,
            start:
              segment.start?.key === crossing.key
                ? {
                    ...segment.start,
                    position: [
                      crossing.position[0],
                      crossing.position[1] + 1e-6,
                    ] as const,
                  }
                : segment.start,
            end:
              segment.end?.key === crossing.key
                ? {
                    ...segment.end,
                    position: [
                      crossing.position[0],
                      crossing.position[1] + 1e-6,
                    ] as const,
                  }
                : segment.end,
          })),
        })),
      };
      const intact = buildRegionProfileFace(
        oc,
        {
          plane,
          sketch: splitSketch.sketch,
          modelingTolerance: FIXTURE_TOLERANCE,
        },
        cell,
      );
      releaseBuiltSketchProfileFace(intact);
      expect(
        () =>
          buildRegionProfileFace(
            oc,
            {
              plane,
              sketch: recordWith(splitSketch, shifted),
              modelingTolerance: FIXTURE_TOLERANCE,
            },
            shifted,
          ),
        "an intersection vertex off its witness enclosure fails closed below τ",
      ).toThrow(/^profile-vertex-gap-exceeds-join: /);
    });

    test(`${runtimeName}: a spline lobe closed by a line extrudes to its oracle prism, with exact Bézier edge witnesses`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const fixture = makeSketchFixture();
      fixture.point("s0", 0, 0);
      fixture.point("s1", 1, 1.6);
      fixture.point("s2", 3, 1.9);
      fixture.point("s3", 4, 0);
      fixture.spline("arch", ["s0", "s1", "s2", "s3"], "open");
      fixture.line("base", "s3", "s0");
      const sketch = await sketchSnapshot(fixture, plane);
      expect(
        sketch.sketch.regions,
        "the arch and its base bound one lobe",
      ).toHaveLength(1);
      const [lobe] = sketch.sketch.regions;
      expectExactFaceWitnesses(oc, sketch, lobe!, "spline lobe");
      expectPrismMatchesOracle(
        oc,
        createContext(oc, [sketch]),
        sketch,
        lobe!,
        "spline lobe",
      );
    }, 60_000);

    test(`${runtimeName}: each lobe of a figure-eight spline (distinct region ids) extrudes to its oracle prism`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const fixture = makeSketchFixture();
      const names = [...Array(8).keys()].map((k) => {
        const t = Math.PI / 8 + (k * Math.PI) / 4;
        fixture.point(
          `p${k}`,
          Math.round(6 * Math.cos(t) * 1000) / 1000,
          Math.round(6 * Math.sin(t) * Math.cos(t) * 1000) / 1000,
        );
        return `p${k}`;
      });
      fixture.spline("fig", names, "smooth");
      const sketch = await sketchSnapshot(fixture, plane);
      const lobes = sketch.sketch.regions;
      expect(lobes, "the self-crossing spline bounds two lobes").toHaveLength(
        2,
      );
      expect(
        new Set(lobes.map((region) => region.regionId)).size,
        "the lobes have distinct region ids",
      ).toBe(2);
      const context = createContext(oc, [sketch]);
      for (const [index, lobe] of lobes.entries()) {
        expect(
          lobe.loops[0]!.segments.some(
            (segment) => segment.start?.kind === "verifiedIntersection",
          ),
          `lobe ${index} passes through the verified self-crossing`,
        ).toBe(true);
        expectExactFaceWitnesses(oc, sketch, lobe, `lobe ${index}`);
        expectPrismMatchesOracle(oc, context, sketch, lobe, `lobe ${index}`);
      }
    }, 120_000);

    test(`${runtimeName}: a spline annulus (spline in spline) and a circle-in-spline annulus extrude to their oracle prisms`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const outer = (fixture: SketchFixture) => {
        [
          [6, 0],
          [0, 5],
          [-6, 0],
          [0, -5],
        ].forEach(([x, y], index) => fixture.point(`o${index}`, x!, y!));
        fixture.spline("outer", ["o0", "o1", "o2", "o3"], "smooth");
      };
      const splineHole = makeSketchFixture();
      outer(splineHole);
      [
        [2.5, 0.5],
        [0, 2],
        [-2, 0],
        [0, -1.5],
      ].forEach(([x, y], index) => splineHole.point(`i${index}`, x!, y!));
      splineHole.spline("inner", ["i0", "i1", "i2", "i3"], "smooth");
      const circleHole = makeSketchFixture();
      outer(circleHole);
      circleHole.point("c", 0.5, -0.25);
      circleHole.circle("hole", "c", 2);
      for (const [label, fixture] of [
        ["spline-in-spline", splineHole],
        ["circle-in-spline", circleHole],
      ] as const) {
        const sketch = await sketchSnapshot(fixture, plane);
        const annulus = sketch.sketch.regions.find(
          (region) => region.loops.length === 2,
        );
        expect(
          annulus,
          `${label}: the owner derives the annulus`,
        ).toBeDefined();
        expect(annulus!.loops.map((loop) => loop.role)).toEqual([
          "outer",
          "inner",
        ]);
        expectExactFaceWitnesses(oc, sketch, annulus!, label);
        const context = createContext(oc, [sketch]);
        for (const region of sketch.sketch.regions)
          expectPrismMatchesOracle(
            oc,
            context,
            sketch,
            region,
            `${label} ${region.loops.length === 2 ? "annulus" : "disk"}`,
          );
      }
    }, 120_000);

    test(`${runtimeName}: a mixed line/arc/cubic outline extrudes to its oracle prism; the OCC circle is the arrangement's circle at its source angles`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const fixture = makeSketchFixture();
      fixture.point("A", 0, 0);
      fixture.point("B", 10, 0);
      fixture.point("K", 10, 3);
      fixture.point("C", 10, 6);
      fixture.point("D", 5, 8.5);
      fixture.point("E", 0, 6);
      fixture.line("base", "A", "B");
      fixture.arc("bulge", "K", "B", "C");
      fixture.spline("top", ["C", "D", "E"], "open");
      fixture.line("side", "E", "A");
      const sketch = await sketchSnapshot(fixture, plane);
      expect(sketch.sketch.regions).toHaveLength(1);
      const [region] = sketch.sketch.regions;
      expectExactFaceWitnesses(oc, sketch, region!, "mixed outline");
      const arcSegment = region!.loops[0]!.segments.find(
        (segment) => labelOf(segment) === "bulge",
      )!;
      const resolved = resolveRegionBoundaryCurve(
        regionBoundaryBasisOfSketchRecord(sketch.sketch),
        arcSegment,
      );
      if (resolved.kind !== "resolved" || resolved.curve.kind !== "circle")
        throw new Error(
          "premise: the bulge resolves to the arrangement's circle",
        );
      const built = buildRegionProfileFace(
        oc,
        { plane, sketch: sketch.sketch, modelingTolerance: FIXTURE_TOLERANCE },
        region!,
      );
      try {
        const edge = built.provenance.edges.get(
          arcSegment.branch.source.kind === "entity"
            ? arcSegment.branch.source.entityId
            : ("" as never),
        )!;
        const adaptor = new oc.BRepAdaptor_Curve_2(edge);
        const circle = adaptor.Circle();
        const location = circle.Location();
        try {
          const center = mapSketchPointToWorld(plane, resolved.curve.center);
          expect(
            [location.X(), location.Y(), location.Z(), circle.Radius()],
            "the OCC circle's centre and radius are the arrangement's, bitwise",
          ).toEqual([...center, resolved.curve.radius]);
          const [low, high] = arcSegment.sourceParameterInterval;
          const turns = (value: number) => {
            const wrapped =
              value - 2 * Math.PI * Math.round(value / (2 * Math.PI));
            return Math.abs(wrapped);
          };
          expect(
            turns(adaptor.FirstParameter() - low),
            "the edge starts at the record's source angle (mod 2π, R3)",
          ).toBeLessThanOrEqual(8 * Number.EPSILON * 2 * Math.PI);
          expect(
            turns(adaptor.LastParameter() - high),
            "the edge ends at the record's source angle (mod 2π, R3)",
          ).toBeLessThanOrEqual(8 * Number.EPSILON * 2 * Math.PI);
        } finally {
          location.delete();
          circle.delete();
          adaptor.delete();
        }
      } finally {
        releaseBuiltSketchProfileFace(built);
      }
      expectPrismMatchesOracle(
        oc,
        createContext(oc, [sketch]),
        sketch,
        region!,
        "mixed outline",
      );
    }, 60_000);

    test(`${runtimeName}: projected neutral spans and projected arc ends (A5 keys) build exact faces`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const fixture = makeSketchFixture();
      addRectangle(fixture, "r", [0, 0, 10, 10]);
      fixture.project("loop", [
        projectedSpline("projected_geometry_loop", [
          neutralSpan(
            [
              [2, 5],
              [2, 8],
              [8, 8],
              [8, 5],
            ],
            0,
            ["o0", "o1"],
            0,
          ),
          neutralSpan(
            [
              [8, 5],
              [8, 2],
              [2, 2],
              [2, 5],
            ],
            1,
            ["o1", "o0"],
            1,
          ),
        ]),
      ]);
      const sketch = await sketchSnapshot(fixture, plane);
      expect(
        sketch.sketch.regions,
        "the projected loop splits the square",
      ).toHaveLength(2);
      const context = createContext(oc, [sketch]);
      for (const region of sketch.sketch.regions) {
        expectExactFaceWitnesses(
          oc,
          sketch,
          region,
          `projected spans ${region.loops.length}`,
        );
        expectPrismMatchesOracle(
          oc,
          context,
          sketch,
          region,
          `projected spans ${region.loops.length}`,
        );
      }

      // A5: a projected arc's ends at its own draft domain ends carry the
      // projected `…:start/:end` keys. Endpoint contacts are no arrangement
      // events (U2), so no derived region reaches a projected arc's domain
      // end today; the record is forged on the arrangement's own branches.
      for (const sweep of ["counterClockwise", "clockwise"] as const) {
        const arcs = makeSketchFixture();
        const [start, end] =
          sweep === "counterClockwise"
            ? ([
                [3, 1],
                [-3, 1],
              ] as const)
            : ([
                [-3, 1],
                [3, 1],
              ] as const);
        const referenceId = arcs.project("d", [
          {
            geometryId: "projected_geometry_arc",
            kind: "arc",
            centerPosition: [0, 0],
            startPosition: start,
            endPosition: end,
            sweepDirection: sweep,
          },
          {
            geometryId: "projected_geometry_chord",
            kind: "lineSegment",
            startPosition: [-3, 1],
            endPosition: [3, 1],
          },
        ] as never);
        const arcSketch = await sketchSnapshot(arcs, plane);
        const source = (geometryId: string, kind: string) =>
          ({
            kind: "projectedGeometry",
            reference: { kind, referenceId, geometryId },
          }) as RegionBoundarySegmentRecord["branch"]["source"];
        // The arc draft's counter-clockwise domain: (3, 1) → (−3, 1).
        const domain = [Math.atan2(1, 3), Math.atan2(1, -3)] as const;
        const forged = forgedLoopRegion(arcSketch, [
          {
            source: source("projected_geometry_chord", "projectedLineSegment"),
            interval: [0, 1],
            from: [-3, 1],
            to: [3, 1],
          },
          {
            source: source("projected_geometry_arc", "projectedArc"),
            interval: domain,
            from: [3, 1],
            to: [-3, 1],
          },
        ]);
        const record = recordWith(arcSketch, forged);
        const built = buildRegionProfileFace(
          oc,
          { plane, sketch: record, modelingTolerance: FIXTURE_TOLERANCE },
          forged,
        );
        try {
          expectRelative(
            shapeProperties(oc, built.face, "surface").mass,
            regionOracleArea(record, forged),
            `projected ${sweep} arc segment area`,
          );
          const key = (geometry: string, end: "start" | "end") =>
            `projected:${referenceId}/projected_geometry_${geometry}:${end}` as never;
          const vertices = built.provenance.vertices;
          const arcStart = vertices.get(key("arc", "start"));
          const arcEnd = vertices.get(key("arc", "end"));
          expect(
            arcStart && arcEnd,
            `${sweep}: both projected arc ends are named`,
          ).toBeTruthy();
          // A counter-clockwise arc starts where the chord ends (3, 1); a
          // clockwise one starts where the chord starts (−3, 1).
          const [atChordStart, atChordEnd] =
            sweep === "counterClockwise"
              ? [arcEnd, arcStart]
              : [arcStart, arcEnd];
          expect(
            atChordStart!.IsSame(vertices.get(key("chord", "start"))!) &&
              atChordEnd!.IsSame(vertices.get(key("chord", "end"))!),
            `${sweep}: each projected arc end names the vertex at its own authored end`,
          ).toBe(true);
        } finally {
          releaseBuiltSketchProfileFace(built);
        }
      }
    }, 120_000);

    test(`${runtimeName}: a touch-vertex circle and point-touching loops (hole↔hole, hole↔outer; line and curved) build valid faces and prisms`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const cases: [string, SketchFixture, number][] = [];
      const tangentCircle = makeSketchFixture();
      addRectangle(tangentCircle, "r", [0, 0, 10, 10]);
      tangentCircle.point("c", 5, 3);
      tangentCircle.circle("disk", "c", 3);
      cases.push([
        "curved hole↔outer (a circle tangent to the square)",
        tangentCircle,
        2,
      ]);
      const tangentCircles = makeSketchFixture();
      addRectangle(tangentCircles, "r", [0, 0, 10, 10]);
      tangentCircles.point("c1", 3, 5);
      tangentCircles.circle("d1", "c1", 2);
      tangentCircles.point("c2", 7, 5);
      tangentCircles.circle("d2", "c2", 2);
      cases.push(["curved hole↔hole (two tangent circles)", tangentCircles, 3]);
      const diamonds = makeSketchFixture();
      addRectangle(diamonds, "r", [0, 0, 10, 10]);
      for (const [name, x, y] of [
        ["a0", 2, 5],
        ["a1", 3.5, 3.5],
        ["m", 5, 5],
        ["a3", 3.5, 6.5],
        ["b1", 6.5, 3.5],
        ["b2", 8, 5],
        ["b3", 6.5, 6.5],
      ] as const)
        diamonds.point(name, x, y);
      for (const [name, from, to] of [
        ["a_0", "a0", "a1"],
        ["a_1", "a1", "m"],
        ["a_2", "m", "a3"],
        ["a_3", "a3", "a0"],
        ["b_0", "m", "b1"],
        ["b_1", "b1", "b2"],
        ["b_2", "b2", "b3"],
        ["b_3", "b3", "m"],
      ] as const)
        diamonds.line(name, from, to);
      cases.push([
        "line hole↔hole (two diamonds sharing a point)",
        diamonds,
        3,
      ]);
      cases.push([
        "line hole↔outer (a diamond touching the square)",
        touchingDiamond(),
        2,
      ]);
      for (const [label, fixture, count] of cases) {
        const sketch = await sketchSnapshot(fixture, plane);
        expect(sketch.sketch.regions, `${label}: region count`).toHaveLength(
          count,
        );
        const context = createContext(oc, [sketch]);
        for (const region of sketch.sketch.regions) {
          const name = `${label}, ${region.loops.length}-loop region`;
          expectExactFaceWitnesses(oc, sketch, region, name);
          expectPrismMatchesOracle(oc, context, sketch, region, name);
        }
        const band = sketch.sketch.regions.find(
          (region) => region.loops.length > 1,
        )!;
        const keys = band.loops.map(
          (loop) =>
            new Set(
              loop.segments.flatMap((segment) =>
                [segment.start, segment.end].flatMap((vertex) =>
                  vertex ? [vertex.key] : [],
                ),
              ),
            ),
        );
        expect(
          keys.some((left, index) =>
            keys
              .slice(index + 1)
              .some((right) => [...left].some((key) => right.has(key))),
          ),
          `${label}: premise, two loops of one face share a boundary vertex`,
        ).toBe(true);
      }
      const disk = (
        await sketchSnapshot(tangentCircle, plane)
      ).sketch.regions.find((region) => region.loops.length === 1)!;
      const [touch] = disk.loops[0]!.segments;
      expect(
        disk.loops[0]!.segments.length === 1 &&
          touch!.start !== null &&
          touch!.start.key === touch!.end?.key,
        "premise: the tangent disk is one circle segment through one touch vertex",
      ).toBe(true);
    }, 180_000);

    test(`${runtimeName}: a point-touching prism takes booleans and exports to STL and 3MF as a closed oriented mesh (review A5)`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const sketch = await sketchSnapshot(touchingDiamond(), plane);
      const band = sketch.sketch.regions.find(
        (region) => region.loops.length === 2,
      )!;
      const prism = executeOccFeature(
        createContext(oc, [sketch]),
        "feature_t10c_touching" as FeatureId,
        extrudeParameters(sketch, band, {
          operation: "newBody",
          booleanScope: { kind: "standalone" },
        }),
      );
      const [body] = prism.bodies;
      expectRelative(
        shapeProperties(oc, body!.shape, "volume").mass,
        88 * HEIGHT,
        "touching prism volume",
      );

      // Export the prism that still has its non-manifold touch edge. Mesh
      // export is native to the shipped build (the stock package has no
      // payload builder), so it runs on the production runtime only.
      const capabilities = createOccExportCapabilities(
        createOccAuthoringState(oc, { bodies: [body!] }),
      );
      const target = { kind: "body", bodyId: body!.bodyId } as const;
      const triangles = await capabilities.mesh.tessellate(target, {
        chordTolerance: 0.05,
        angleToleranceRadians: 0.1,
      });
      if (!runtimeName.startsWith("production")) {
        expect(
          Array.isArray(triangles) ? "meshed" : triangles.message,
          "premise: the stock package has no native mesh export",
        ).toMatch(/not available in this OpenCascade runtime/);
      } else {
        if (!Array.isArray(triangles))
          throw new Error(`mesh export failed: ${triangles.message}`);
        expectRelative(
          meshVolume(triangles),
          88 * HEIGHT,
          "exported mesh volume",
        );
        expect(
          unmatchedDirectedEdges(triangles),
          "every directed mesh edge has its reverse: a closed, consistently oriented surface",
        ).toEqual([]);
        for (const provider of [
          stlExportProvider,
          threeMfExportProvider,
        ] as const) {
          const result = await provider.export({
            target,
            targetLabel: "touching prism",
            options: provider.getDefaultOptions() as never,
            capabilities,
          });
          expect(
            result.ok,
            `${provider.label} export of the point-touching prism`,
          ).toBe(true);
          expect(
            result.ok && result.payload.length > 0,
            `${provider.label} payload is non-empty`,
          ).toBe(true);
        }
      }

      // Booleans: a cut through the touch point (removes the non-manifold
      // edge) and a cut away from it (keeps it).
      const cutter = makeSketchFixture();
      addRectangle(cutter, "t", [4, -1, 6, 1]);
      addRectangle(cutter, "u", [8, 4, 9, 5]);
      const cutterSketch = {
        ...(await sketchSnapshot(cutter, plane)),
        sketchId: "sketch_t10c_cutter" as SketchId,
      };
      expect(
        cutterSketch.sketch.regions,
        "premise: two cutter rectangles",
      ).toHaveLength(2);
      let bodies = prism.bodies;
      for (const [index, region] of cutterSketch.sketch.regions.entries()) {
        const context = createContext(oc, [sketch, cutterSketch], bodies);
        const cut = executeOccFeature(
          context,
          `feature_t10c_cut_${index}` as FeatureId,
          extrudeParameters(cutterSketch, region, {
            operation: "cut",
            booleanScope: { kind: "targetBody", bodyId: bodies[0]!.bodyId },
          }),
        );
        bodies = cut.bodies;
        expect(bodies, `cut ${index} keeps one body`).toHaveLength(1);
        const analyzer = new oc.BRepCheck_Analyzer(
          bodies[0]!.shape as never,
          true,
          false,
        );
        try {
          expect(
            analyzer.IsValid_2(),
            `cut ${index}: BRepCheck accepts the result`,
          ).toBe(true);
        } finally {
          analyzer.delete();
        }
      }
      // Removed areas: [4, 6]×[0, 1] minus the diamond's tip (area 2/3), and
      // [8, 9]×[4, 5].
      expectRelative(
        shapeProperties(oc, bodies[0]!.shape, "volume").mass,
        (88 - (2 - 2 / 3) - 1) * HEIGHT,
        "volume after both cuts",
      );
    }, 120_000);

    test(`${runtimeName}: a declared join of three members (spokes meeting within τ) caps each end at the class's ball, min(ballRadius, τ), and the faces run through the join representative`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const fixture = makeSketchFixture();
      const g = 0.4 * FIXTURE_TOLERANCE;
      fixture.point("A", 0, 0);
      fixture.point("B", 10, 0);
      fixture.point("C", 5, 9);
      fixture.point("o1", 5, 3);
      fixture.point("o2", 5 + g, 3);
      fixture.point("o3", 5, 3 + g);
      fixture.line("ab", "A", "B");
      fixture.line("bc", "B", "C");
      fixture.line("ca", "C", "A");
      fixture.line("sa", "A", "o1");
      fixture.line("sb", "B", "o2");
      fixture.line("sc", "C", "o3");
      fixture.coincident("o1", "o2");
      fixture.coincident("o2", "o3");
      const sketch = await sketchSnapshot(fixture, plane);
      expect(sketch.sketch.regions, "three spoke cells").toHaveLength(3);
      for (const region of sketch.sketch.regions) {
        const loop = region.loops[0]!;
        const hub = loop.segments.find(
          (segment) =>
            segment.start?.kind === "declaredJoin" &&
            segment.start.pointIds.length === 3,
        )!.start as Extract<RegionBoundaryVertex, { kind: "declaredJoin" }>;
        expect(
          hub,
          "premise: the cell visits the three-member class",
        ).toBeDefined();
        const cap = Math.min(hub.ballRadius, FIXTURE_TOLERANCE);
        const built = buildRegionProfileFace(
          oc,
          {
            plane,
            sketch: sketch.sketch,
            modelingTolerance: FIXTURE_TOLERANCE,
          },
          region,
        );
        try {
          const vertex = built.provenance.vertices.get(hub.pointIds[0]!)!;
          for (const pointId of hub.pointIds)
            expect(
              built.provenance.vertices.get(pointId)!.IsSame(vertex),
              "every member names the one hub vertex",
            ).toBe(true);
          const tolerance = oc.BRep_Tool.Tolerance_3(vertex);
          expect(
            tolerance,
            `the hub vertex tolerance ${tolerance} stays within the class cap ${cap}`,
          ).toBeLessThanOrEqual(cap);
          // Lines run between the vertex representatives: the face is the
          // polygon through the record's vertex positions.
          const polygon = loop.segments.map(
            (segment) => segment.start!.position,
          );
          const shoelace =
            polygon.reduce((total, [x, y], index) => {
              const [nx, ny] = polygon[(index + 1) % polygon.length]!;
              return total + x * ny - nx * y;
            }, 0) / 2;
          expectRelative(
            shapeProperties(oc, built.face, "surface").mass,
            shoelace,
            "spoke cell area through the join representative",
          );
        } finally {
          releaseBuiltSketchProfileFace(built);
        }
      }
      // An end beyond the class cap fails closed explicitly: the hub
      // representative moved 2·cap along the spokes' bisector.
      const [cell] = sketch.sketch.regions;
      const hub = cell!.loops[0]!.segments.find(
        (segment) =>
          segment.start?.kind === "declaredJoin" &&
          segment.start.pointIds.length === 3,
      )!.start as Extract<RegionBoundaryVertex, { kind: "declaredJoin" }>;
      const cap = Math.min(hub.ballRadius, FIXTURE_TOLERANCE);
      const moved = (vertex: RegionBoundaryVertex | null) =>
        vertex?.key === hub.key
          ? {
              ...vertex,
              position: [
                hub.position[0] - 2 * cap,
                hub.position[1] - 2 * cap,
              ] as const,
            }
          : vertex;
      const beyond: RegionRecord = {
        ...cell!,
        loops: cell!.loops.map((loop) => ({
          ...loop,
          segments: loop.segments.map((segment) => ({
            ...segment,
            start: moved(segment.start),
            end: moved(segment.end),
          })),
        })),
      };
      expect(
        () =>
          buildRegionProfileFace(
            oc,
            {
              plane,
              sketch: recordWith(sketch, beyond),
              modelingTolerance: FIXTURE_TOLERANCE,
            },
            beyond,
          ),
        "a member end beyond the class cap fails closed",
      ).toThrow(/^profile-vertex-gap-exceeds-join: /);
    });

    test(`${runtimeName}: a failed release of a profile temporary is an OccCleanupError retained for retry, rethrown by the part-mode render (review R-1)`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const fixture = makeSketchFixture();
      fixture.point("s0", 0, 0);
      fixture.point("s1", 1, 1.6);
      fixture.point("s2", 3, 1.9);
      fixture.point("s3", 4, 0);
      fixture.spline("arch", ["s0", "s1", "s2", "s3"], "open");
      fixture.line("base", "s3", "s0");
      const sketch = await sketchSnapshot(fixture, plane);
      const [lobe] = sketch.sketch.regions;
      // Arms the first wrapper `constructor` makes: its first delete throws
      // without releasing it; the next delete releases it.
      const armFirst = (name: "BRepCheck_Analyzer" | "Handle_Geom_Curve_2") => {
        const module = oc as unknown as Record<string, unknown>;
        const original = module[name] as new (...args: unknown[]) => object;
        const injected = new Error(`injected ${name} release failure`);
        let armed: { delete(): void; isDeleted(): boolean } | null = null;
        module[name] = new Proxy(original, {
          construct(target, args) {
            const wrapper = Reflect.construct(target, args) as {
              delete(): void;
              isDeleted(): boolean;
            };
            if (armed === null) {
              armed = wrapper;
              const native = wrapper.delete.bind(wrapper);
              let attempts = 0;
              wrapper.delete = () => {
                attempts += 1;
                if (attempts === 1) throw injected;
                native();
              };
            }
            return wrapper;
          },
        });
        return {
          injected,
          wrapper: () => armed!,
          restore: () => {
            module[name] = original;
          },
        };
      };

      // Through the part-mode render: the analyzer's release fails after a
      // valid check; the render rethrows instead of a region diagnostic.
      const analyzer = armFirst("BRepCheck_Analyzer");
      const diagnostics: ModelingDiagnostic[] = [];
      let rendered: unknown = null;
      try {
        buildOccRenderExport(
          createOccAuthoringState(oc, { sketches: [sketch] }),
          undefined,
          {},
          [sketch],
          diagnostics,
        );
      } catch (error) {
        rendered = error;
      } finally {
        analyzer.restore();
      }
      const renderCleanup = collectOccCleanupErrors(rendered);
      expect(
        renderCleanup,
        "the render rethrows one cleanup error",
      ).toHaveLength(1);
      expect(renderCleanup[0]!.errors).toContain(analyzer.injected);
      expect(diagnostics, "a cleanup failure is no region diagnostic").toEqual(
        [],
      );
      expect(
        analyzer.wrapper().isDeleted(),
        "the analyzer is retained for retry",
      ).toBe(false);
      renderCleanup[0]!.retry();
      expect(analyzer.wrapper().isDeleted(), "the retry releases it").toBe(
        true,
      );

      // Directly: the Bézier edge's curve handle release fails; the face
      // build fails with the cleanup error, every built wrapper released.
      const handle = armFirst("Handle_Geom_Curve_2");
      let built: unknown = null;
      try {
        buildRegionProfileFace(
          oc,
          {
            plane,
            sketch: sketch.sketch,
            modelingTolerance: FIXTURE_TOLERANCE,
          },
          lobe!,
        );
      } catch (error) {
        built = error;
      } finally {
        handle.restore();
      }
      const buildCleanup = collectOccCleanupErrors(built);
      expect(
        buildCleanup,
        "the face build fails with one cleanup error",
      ).toHaveLength(1);
      expect(buildCleanup[0]!.errors).toContain(handle.injected);
      expect(handle.wrapper().isDeleted()).toBe(false);
      buildCleanup[0]!.retry();
      expect(handle.wrapper().isDeleted()).toBe(true);
    });

    test(`${runtimeName}: an arc below OCC's resolution fails closed naming its branch (micro-arc rejection, R12)`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      for (const radius of [1e-8, 5e-8]) {
        const fixture = makeSketchFixture();
        fixture.point("c", 0, 0);
        fixture.point("s", radius, 0);
        fixture.point("e", 0, radius);
        fixture.arc("arc", "c", "s", "e");
        fixture.line("chord", "e", "s");
        const sketch = await sketchSnapshot(fixture, plane);
        // The owner itself publishes no region here (join balls crowd), so
        // the arc/chord record is forged on the arrangement's own branches.
        const micro = forgedArcChordRegion(sketch, [0, Math.PI / 2]);
        expect(
          () =>
            buildRegionProfileFace(
              oc,
              {
                plane,
                sketch: recordWith(sketch, micro),
                modelingTolerance: FIXTURE_TOLERANCE,
              },
              micro,
            ),
          `r = ${radius}: the edge is below the kernel's resolution`,
        ).toThrow(
          new RegExp(
            `^profile-edge-below-kernel-resolution: The edge of sketch entity ${micro.loops[0]!.segments[0]!.branch.source.kind === "entity" ? micro.loops[0]!.segments[0]!.branch.source.entityId : ""} has radius `,
          ),
        );
      }
    });

    test(`${runtimeName}: a region whose face does not build gets a region diagnostic in the part-mode render, the others render`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const fixture = makeSketchFixture();
      addRectangle(fixture, "r", [2, 2, 4, 4]);
      fixture.point("c", 0, 0);
      fixture.point("s", 1e-8, 0);
      fixture.point("e", 0, 1e-8);
      fixture.arc("arc", "c", "s", "e");
      fixture.line("chord", "e", "s");
      const sketch = await sketchSnapshot(fixture, plane);
      expect(
        sketch.sketch.regions,
        "premise: only the square derives",
      ).toHaveLength(1);
      const micro = forgedArcChordRegion(sketch, [0, Math.PI / 2]);
      const withMicro = {
        ...sketch,
        sketch: recordWith(sketch, ...sketch.sketch.regions, micro),
      };
      const diagnostics: ModelingDiagnostic[] = [];
      const state = createOccAuthoringState(oc, { sketches: [withMicro] });
      const render = buildOccRenderExport(
        state,
        undefined,
        {},
        [withMicro],
        diagnostics,
      );
      expect(
        render.records
          .filter((record) => record.binding.semanticClass === "region")
          .map((record) => record.binding.target),
        "the square still renders its face",
      ).toEqual([sketch.sketch.regions[0]!.target]);
      expect(
        diagnostics.map(({ code, severity, target }) => ({
          code,
          severity,
          target,
        })),
        "the micro region is named with the builder's code instead of a console warning",
      ).toEqual([
        {
          code: "profile-edge-below-kernel-resolution",
          severity: "warning",
          target: micro.target,
        },
      ]);
    });

    // T10d (A6, user decision 2026-09-28): open curves chain only through
    // declared joins, never by endpoint distance.
    test(`${runtimeName}: open curves chain through shared points and satisfied coincident constraints (one vertex per class at its smallest member point, admitted within τ)`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const gap = 0.4 * FIXTURE_TOLERANCE;
      const fixture = makeSketchFixture();
      fixture.point("a", 0, 0);
      fixture.point("b", 4, 0);
      fixture.point("b2", 4, gap);
      fixture.point("c", 4, 3);
      fixture.point("d", 1, 3);
      fixture.line("ab", "a", "b");
      fixture.line("bc", "b2", "c");
      fixture.line("cd", "c", "d");
      fixture.coincident("b", "b2");
      const sketch = await sketchSnapshot(fixture, plane);

      const built = openWire(oc, sketch, ["ab", "bc", "cd"]);
      try {
        const vertices = built.provenance.vertices;
        const joined = vertices.get("sketch_point_b" as never)!;
        expect(
          vertices.get("sketch_point_b2" as never),
          "the coincident class is one shared vertex",
        ).toBe(joined);
        const point = oc.BRep_Tool.Pnt(joined);
        try {
          expect(
            [point.X(), point.Y(), point.Z()],
            "the class vertex sits bitwise at its lexicographically smallest member point (b)",
          ).toEqual([4, 0, 0]);
        } finally {
          point.delete();
        }
        const tolerance = oc.BRep_Tool.Tolerance_3(joined);
        expect(
          tolerance,
          "b2's line end is admitted at the class vertex: its gap",
        ).toBeGreaterThanOrEqual(gap);
        expect(tolerance, "…capped at τ").toBeLessThanOrEqual(
          FIXTURE_TOLERANCE,
        );
        expect(
          vertices.get("sketch_point_c" as never),
          "the shared point id c is one vertex",
        ).toBeDefined();
        expect([...built.provenance.edges.keys()].sort()).toEqual(
          ["ab", "bc", "cd"].map((label) => entityIdOf(sketch, label)).sort(),
        );
      } finally {
        releaseOpenWire(built);
      }

      // The bc edge runs from the class vertex (b) to c.
      const sheet = openSurfaceExtrude(oc, sketch, ["ab", "bc", "cd"]);
      expectRelative(sheet.mass, (4 + 3 + 3) * HEIGHT, "open chain sheet area");
    });

    test(`${runtimeName}: open curves without a satisfied declaration are disconnected, branches are rejected, and a satisfied join beyond τ fails closed`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const twoLines = async (
        offset: number,
        declare: "none" | "satisfied" | "unsatisfied",
      ) => {
        const fixture = makeSketchFixture();
        fixture.point("a", 0, 0);
        fixture.point("b", 4, 0);
        fixture.point("b2", 4, offset);
        fixture.point("c", 4, 3);
        fixture.line("ab", "a", "b");
        fixture.line("bc", "b2", "c");
        if (declare === "none") return sketchSnapshot(fixture, plane);
        const constraint = fixture.coincident("b", "b2");
        return withConstraintStatus(
          await sketchSnapshot(fixture, plane),
          constraint,
          declare,
        );
      };
      const disconnected =
        /^unsupported-profile-group: Open sketch curves sketch_entity_bc are not connected to the rest of the surface profile chain: curve ends connect only through a shared point or a satisfied coincident constraint\.$/;

      const nearMiss = await twoLines(5e-7, "none");
      const bitwise = await twoLines(0, "none");
      const unsatisfied = await twoLines(0, "unsatisfied");
      const beyond = await twoLines(2 * FIXTURE_TOLERANCE, "satisfied");
      // Formerly chained by the 1e-6 endpoint rule; now nothing declares it.
      expect(
        () => openWire(oc, nearMiss, ["ab", "bc"]),
        "an undeclared near-miss (5e-7) is disconnected",
      ).toThrow(disconnected);
      expect(
        () => openWire(oc, bitwise, ["ab", "bc"]),
        "even bitwise-equal undeclared ends are disconnected",
      ).toThrow(disconnected);
      expect(
        () => openWire(oc, unsatisfied, ["ab", "bc"]),
        "an unsatisfied coincident is no join",
      ).toThrow(disconnected);
      expect(
        () => openWire(oc, beyond, ["ab", "bc"]),
        "a satisfied join whose member end lies beyond τ fails closed",
      ).toThrow(
        /^profile-vertex-gap-exceeds-join: The end of sketch entity sketch_entity_bc lies /,
      );

      const star = makeSketchFixture();
      star.point("o", 0, 0);
      for (const [name, x, y] of [
        ["p", 1, 0],
        ["q", 0, 1],
        ["r", -1, 0],
      ] as const) {
        star.point(name, x, y);
        star.line(`o${name}`, "o", name);
      }
      const starSketch = await sketchSnapshot(star, plane);
      expect(
        () => openWire(oc, starSketch, ["op", "oq", "or"]),
        "three ends in one class branch",
      ).toThrow(
        /^unsupported-profile-group: Open sketch curves .* branch at a declared join and do not form one sweepable chain\.$/,
      );

      const tee = makeSketchFixture();
      tee.point("s0", 0, 0);
      tee.point("s1", 2, 1);
      tee.point("s2", 4, 0);
      tee.point("t", 2, 3);
      tee.spline("sp", ["s0", "s1", "s2"], "open");
      tee.line("leg", "t", "s1");
      const teeSketch = await sketchSnapshot(tee, plane);
      expect(
        () => openWire(oc, teeSketch, ["sp", "leg"]),
        "a curve end joined to a spline's interior knot branches",
      ).toThrow(/branch at a declared join/);
    });

    test(`${runtimeName}: an open spline chained to a line surface-extrudes and an open spline surface-revolves (per-span Bézier edges, shared knot vertices; T-8)`, async () => {
      const oc = await loadRuntime();
      const plane = createStandardPlaneDefinition("xy");
      const fixture = makeSketchFixture();
      fixture.point("s0", 0, 0);
      fixture.point("s1", 1, 1.5);
      fixture.point("s2", 3, 2);
      fixture.point("s3", 5, 0.5);
      fixture.point("l", 6, 2);
      fixture.spline("sp", ["s0", "s1", "s2", "s3"], "open");
      fixture.line("tail", "s3", "l");
      fixture.point("x0", -2, -1, true);
      fixture.point("x1", 8, -1, true);
      fixture.line("axis", "x0", "x1", true);
      const sketch = await sketchSnapshot(fixture, plane);
      const spans = splineSpans(sketch, "sp");
      expect(spans, "premise: three spans").toHaveLength(3);
      const splineId = entityIdOf(sketch, "sp");

      const built = openWire(oc, sketch, ["sp", "tail"]);
      try {
        const keys = spans.map(
          (span) =>
            `${splineId}@${span.source.startOccurrenceId}>${span.source.endOccurrenceId}`,
        );
        expect([...built.provenance.edges.keys()].sort()).toEqual(
          [...keys, entityIdOf(sketch, "tail")].sort(),
        );
        const edges = keys.map(
          (key) => built.provenance.edges.get(key as never)!,
        );
        for (const [index, edge] of edges.entries()) {
          const adaptor = new oc.BRepAdaptor_Curve_2(edge);
          try {
            expect(adaptor.GetType(), `span ${index} is a Bézier edge`).toBe(
              oc.GeomAbs_CurveType.GeomAbs_BezierCurve,
            );
            expect(
              [adaptor.FirstParameter(), adaptor.LastParameter()],
              `span ${index} runs over its whole Bézier [0, 1]`,
            ).toEqual([0, 1]);
          } finally {
            adaptor.delete();
          }
        }
        for (let index = 0; index + 1 < edges.length; index += 1) {
          const knot = built.provenance.vertices.get(
            spans[index]!.source.endPointId as never,
          )!;
          const last = oc.TopExp.LastVertex(edges[index]!, false);
          const first = oc.TopExp.FirstVertex(edges[index + 1]!, false);
          const point = oc.BRep_Tool.Pnt(knot);
          try {
            expect(
              last.IsSame(knot) && first.IsSame(knot),
              `interior knot ${index + 1} is one vertex shared by its two spans`,
            ).toBe(true);
            expect(
              [point.X(), point.Y()],
              `interior knot ${index + 1} sits at its span pole`,
            ).toEqual([...spans[index]!.poles[3]]);
          } finally {
            last.delete();
            first.delete();
            point.delete();
          }
        }
        const tailStart = oc.TopExp.FirstVertex(
          built.provenance.edges.get(entityIdOf(sketch, "tail"))!,
          false,
        );
        try {
          expect(
            tailStart.IsSame(
              oc.TopExp.LastVertex(edges[edges.length - 1]!, false),
            ),
            "the line starts at the spline's end vertex (shared point s3)",
          ).toBe(true);
        } finally {
          tailStart.delete();
        }
      } finally {
        releaseOpenWire(built);
      }

      const splineLength = spans.reduce(
        (sum, span) => sum + cubicArcIntegral(span.poles),
        0,
      );
      const sheet = openSurfaceExtrude(oc, sketch, ["sp", "tail"]);
      expectRelative(
        sheet.mass,
        (splineLength + Math.hypot(1, 1.5)) * HEIGHT,
        "spline + line sheet area (oracle: Gauss–Legendre arc length)",
      );

      // Pappus: revolving by π about y = −1 sweeps π·∫(y + 1) ds.
      const revolve = executeOccFeature(
        createContext(oc, [sketch]),
        "feature_t10d_spline_revolve" as FeatureId,
        {
          kind: "revolve",
          featureTypeVersion: REVOLVE_FEATURE_SCHEMA_VERSION,
          parameters: {
            resultBodyType: "surface",
            profiles: [
              {
                kind: "sketchEntity",
                sketchId: sketch.sketchId,
                entityId: splineId,
              },
            ],
            axis: {
              kind: "sketchEntity",
              sketchId: sketch.sketchId,
              entityId: entityIdOf(sketch, "axis"),
            },
            startAngle: 0,
            extent: {
              mode: "oneSide",
              end: {
                kind: "blind",
                direction: "counterClockwise",
                angle: Math.PI,
              },
            },
          },
        } as never,
      );
      const surface = shapeProperties(oc, producedShape(revolve), "surface");
      expectRelative(
        surface.mass,
        Math.PI *
          spans.reduce(
            (sum, span) =>
              sum + cubicArcIntegral(span.poles, (point) => point[1] + 1),
            0,
          ),
        "revolved spline sheet area (Pappus)",
      );
    });

    test(`${runtimeName}: a square sweeps along an open spline path (volume = A·L against the Gauss–Legendre path length)`, async () => {
      const oc = await loadRuntime();
      const profileFixture = makeSketchFixture();
      addRectangle(profileFixture, "p", [-0.2, -0.2, 0.2, 0.2]);
      const profile = await sketchSnapshot(
        profileFixture,
        createStandardPlaneDefinition("xy"),
      );
      // Path on the XZ plane (sketch (u, v) → world (u, 0, v)), leaving the
      // profile centroid along +z (authored start tangent).
      const pathFixture = makeSketchFixture();
      pathFixture.point("p0", 0, 0);
      pathFixture.point("p1", 1, 2.5);
      pathFixture.point("p2", 3, 3.5);
      pathFixture.point("p3", 5, 3);
      pathFixture.spline("path", ["p0", "p1", "p2", "p3"], "open", [[0, 2]]);
      const path = {
        ...(await sketchSnapshot(
          pathFixture,
          createStandardPlaneDefinition("xz"),
        )),
        sketchId: "sketch_t10d_path" as SketchId,
      };
      const spans = splineSpans(path, "path");
      const sweep = executeOccFeature(
        createContext(oc, [profile, path]),
        "feature_t10d_spline_sweep" as FeatureId,
        {
          kind: "sweep",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            operationIntent: "create",
            participants: [
              {
                role: "profile",
                targets: [
                  {
                    kind: "region",
                    sketchId: profile.sketchId,
                    regionId: profile.sketch.regions[0]!.regionId,
                  },
                ],
              },
              {
                role: "path",
                targets: [
                  {
                    kind: "sketchEntity",
                    sketchId: path.sketchId,
                    entityId: entityIdOf(path, "path"),
                  },
                ],
              },
            ],
          },
        } as never,
      );
      const solid = shapeProperties(oc, producedShape(sweep), "volume");
      const length = spans.reduce(
        (sum, span) => sum + cubicArcIntegral(span.poles),
        0,
      );
      // Exact tube volume: the profile (centroid on the planar path, normal to
      // it) gives A·L. OCC approximates each swept lateral face within its
      // sweep tolerance Tol3d = 1e-4 (BRepFill_Sweep's default, OCCT
      // BRepFill_Sweep.cxx `SetTolerance(1.e-4)`), so the solid's volume is
      // within Tol3d × lateral area (perimeter·L) of A·L. The two lateral
      // faces in the path's planes are exact planes.
      const sweepTolerance = 1e-4;
      expect(
        Math.abs(solid.mass - 0.16 * length),
        `spline-path sweep volume ${solid.mass} vs A·L = ${0.16 * length}`,
      ).toBeLessThanOrEqual(sweepTolerance * 1.6 * length);
      const polyline =
        Math.hypot(1, 2.5) + Math.hypot(2, 1) + Math.hypot(2, -0.5);
      expect(
        0.16 * (length - polyline),
        "premise: the bound separates the spline path from its fit-point polyline",
      ).toBeGreaterThan(sweepTolerance * 1.6 * length);
    });
  }
});
