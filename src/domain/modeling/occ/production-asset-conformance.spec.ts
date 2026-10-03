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
  RegionBoundaryVertex,
  RegionRecord,
  SketchRecord,
} from "@/contracts/sketch/schema";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import {
  addRectangle,
  FIXTURE_SKETCH_ID,
  FIXTURE_TOLERANCE,
  makeSketchFixture,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  executeOccFeature,
  type OccFeatureExecutionContext,
} from "@/domain/modeling/occ/features";
import {
  buildRegionProfileFace,
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
    bodies: [],
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
            sketch: sketch.sketch,
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
      expect(
        () =>
          buildRegionProfileFace(
            oc,
            {
              plane,
              sketch: sketch.sketch,
              modelingTolerance: FIXTURE_TOLERANCE,
            },
            moved(1.5 * cap),
          ),
        "a gap above the join's cap fails closed",
      ).toThrow(/^profile-vertex-gap-exceeds-join: /);

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
              sketch: splitSketch.sketch,
              modelingTolerance: FIXTURE_TOLERANCE,
            },
            shifted,
          ),
        "an intersection vertex off its witness enclosure fails closed below τ",
      ).toThrow(/^profile-vertex-gap-exceeds-join: /);
    });
  }
});
