import { test, expect } from "vitest";
import {
  deriveSketchRegionsCore,
  findSketchRings,
} from "@/contracts/sketch/region-extraction";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type { ReferenceId } from "@/contracts/shared/ids";

test("src/contracts/sketch/region-extraction.spec.ts", async () => {
  function assertNear(actual: number, expected: number, message: string) {
    if (Math.abs(actual - expected) > 1e-9) {
      throw new Error(`${message}: expected ${expected}, received ${actual}`);
    }
  }

  function makePoint(pointId: string, label: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: pointId as `sketch_point_${string}`,
      } as const,
      position: [x, y] as const,
      isConstruction: false,
    };
  }

  function makeLine(
    entityId: string,
    label: string,
    startPointId: string,
    endPointId: string,
    isConstruction = false,
  ) {
    return {
      kind: "lineSegment" as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: entityId as `sketch_entity_${string}`,
      } as const,
      isConstruction,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
    };
  }

  function makeCircle(
    entityId: string,
    label: string,
    centerPointId: string,
    radius: number,
  ) {
    return {
      kind: "circle" as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: entityId as `sketch_entity_${string}`,
      } as const,
      isConstruction: false,
      centerPointId: centerPointId as `sketch_point_${string}`,
      radius,
    };
  }

  function makeAuthoredReference(
    referenceId: ReferenceId = "ref_projected_profile",
  ) {
    return {
      referenceId,
      kind: "modelReference" as const,
      label: "Projected profile",
      source: {
        kind: "edge" as const,
        bodyId: "body_projected",
        edgeId: "edge_profile",
      },
      projectionMode: "projectAlongPlaneNormal" as const,
    };
  }

  function makeProjectedReference(
    geometry: ProjectedSketchReferenceRecord["geometry"],
    referenceId: ReferenceId = "ref_projected_profile",
  ): ProjectedSketchReferenceRecord {
    return {
      referenceId,
      status: "projected",
      geometry,
      diagnostics: [],
    };
  }

  function makeArc(
    entityId: string,
    label: string,
    centerPointId: string,
    startPointId: string,
    endPointId: string,
    isConstruction = false,
  ) {
    return {
      kind: "arc" as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: entityId as `sketch_entity_${string}`,
      } as const,
      isConstruction,
      centerPointId: centerPointId as `sketch_point_${string}`,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
      sweepDirection: "counterClockwise" as const,
    };
  }

  function makeSolvedSnapshot(
    definition: SketchDefinition,
  ): SolvedSketchSnapshot {
    const solvedPoints = definition.points.map((point) => ({
      pointId: point.pointId,
      target: point.target,
      solvedPosition: point.position,
    }));

    const pointMap = new Map(
      definition.points.map((point) => [point.pointId, point]),
    );

    return {
      schemaVersion: "solved-sketch/v1alpha1",
      status: {
        solveState: "solved",
        constraintState: "wellConstrained",
      },
      solvedPoints,
      solvedEntities: definition.entities.flatMap((entity) => {
        if (entity.kind === "lineSegment") {
          const start = pointMap.get(entity.startPointId);
          const end = pointMap.get(entity.endPointId);
          if (!start || !end) {
            return [];
          }
          return [
            {
              kind: "lineSegment" as const,
              entityId: entity.entityId,
              target: entity.target,
              startPosition: start.position,
              endPosition: end.position,
            },
          ];
        }
        if (entity.kind === "circle") {
          const center = pointMap.get(entity.centerPointId);
          if (!center) {
            return [];
          }
          return [
            {
              kind: "circle" as const,
              entityId: entity.entityId,
              target: entity.target,
              centerPosition: center.position,
              solvedRadius: entity.radius,
            },
          ];
        }
        if (entity.kind === "arc") {
          const center = pointMap.get(entity.centerPointId);
          const start = pointMap.get(entity.startPointId);
          const end = pointMap.get(entity.endPointId);
          if (!center || !start || !end) {
            return [];
          }
          return [
            {
              kind: "arc" as const,
              entityId: entity.entityId,
              target: entity.target,
              centerPosition: center.position,
              startPosition: start.position,
              endPosition: end.position,
              sweepDirection: entity.sweepDirection,
            },
          ];
        }
        return [];
      }),
      constraintStatuses: [],
      dimensionStatuses: [],
      diagnostics: [],
    };
  }

  async function testFindRingsNone() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_c"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 2, 0),
        makePoint("sketch_point_c", "C", 3, 1),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_bc"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const found = findSketchRings(definition, makeSolvedSnapshot(definition));
    expect(found.rings.length, "Open chains should not produce rings.").toBe(0);
    expect(
      found.unusedSegments.length,
      "All open segments should remain unused.",
    ).toBe(2);
  }

  async function testFindRingsOne() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
        makePoint("sketch_point_c", "C", 4, 3),
        makePoint("sketch_point_d", "D", 0, 3),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const found = findSketchRings(definition, makeSolvedSnapshot(definition));
    expect(found.rings.length, "One rectangle should produce one ring.").toBe(
      1,
    );
    expect(
      found.unusedSegments.length,
      "Closed rectangle should consume all segments.",
    ).toBe(0);
    expect(
      found.rings[0]?.boundaryEntityIds.length,
      "The ring should contain four edges.",
    ).toBe(4);
  }

  async function testJiggledRectangleRegionsStayStableAndPositioned() {
    const baseDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
        makePoint("sketch_point_c", "C", 4, 3),
        makePoint("sketch_point_d", "D", 0, 3),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const translateDefinition = (dx: number, dy: number): SketchDefinition => ({
      ...baseDefinition,
      points: baseDefinition.points.map((point) => ({
        ...point,
        position: [point.position[0] + dx, point.position[1] + dy] as const,
      })),
    });

    let expectedRegionId: string | null = null;
    let expectedLoopSignature: string | null = null;

    for (const [dx, dy] of [
      [0, 0],
      [0.125, -0.25],
      [-0.2, 0.3],
      [0.05, 0.05],
      [0, 0],
    ] as const) {
      const definition = translateDefinition(dx, dy);
      const solvedSnapshot = makeSolvedSnapshot(definition);
      const found = findSketchRings(definition, solvedSnapshot);
      const derived = deriveSketchRegionsCore({
        documentId: "doc_workspace",
        revisionId: "rev_0001",
        sketchId: "sketch_primary",
        definition,
        solvedSnapshot,
      });

      expect(
        found.rings.length,
        "Jiggled rectangle should keep producing exactly one ring.",
      ).toBe(1);
      expect(
        derived.regions.length,
        "Jiggled rectangle should keep producing exactly one region.",
      ).toBe(1);

      const ring = found.rings[0]!;
      const region = derived.regions[0]!;
      const xs = ring.points.map((point) => point[0]);
      const ys = ring.points.map((point) => point[1]);
      const loopSignature = region.loops[0]!.segments.map((segment) =>
        segment.source.kind === "entity"
          ? segment.source.entityId
          : segment.source.reference.geometryId,
      ).join("|");

      expectedRegionId ??= region.regionId;
      expectedLoopSignature ??= loopSignature;

      expect(
        region.regionId,
        "Region id should remain stable while the profile is jiggled.",
      ).toBe(expectedRegionId);
      expect(
        loopSignature,
        "Region boundary sources should remain stable while the profile is jiggled.",
      ).toBe(expectedLoopSignature);
      assertNear(
        Math.min(...xs),
        dx,
        "Jiggled region should keep the translated minimum x.",
      );
      assertNear(
        Math.max(...xs),
        dx + 4,
        "Jiggled region should keep the translated maximum x.",
      );
      assertNear(
        Math.min(...ys),
        dy,
        "Jiggled region should keep the translated minimum y.",
      );
      assertNear(
        Math.max(...ys),
        dy + 3,
        "Jiggled region should keep the translated maximum y.",
      );
      assertNear(
        Math.abs(ring.signedArea),
        12,
        "Jiggled region should preserve its profile area.",
      );
    }
  }

  async function testEndpointSelectionResidualsDeriveAdjacentProfiles() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_1_rect-bottom-left",
        "sketch_point_1_rect-bottom-right",
        "sketch_point_1_rect-top-right",
        "sketch_point_1_rect-top-left",
        "sketch_point_2_line-start",
        "sketch_point_2_line-end",
        "sketch_point_4_line-start",
        "sketch_point_4_line-end",
        "sketch_point_5_line-start",
        "sketch_point_5_line-end",
      ],
      points: [
        makePoint(
          "sketch_point_1_rect-bottom-left",
          "Bottom left",
          -14.291285910941498,
          -1.091872713913713,
        ),
        makePoint(
          "sketch_point_1_rect-bottom-right",
          "Bottom right",
          -3.820764551724851,
          -1.0918727118189422,
        ),
        makePoint(
          "sketch_point_1_rect-top-right",
          "Top right",
          -3.8207645448174223,
          6.534128625935561,
        ),
        makePoint(
          "sketch_point_1_rect-top-left",
          "Top left",
          -14.291285906887033,
          6.534128628579854,
        ),
        makePoint(
          "sketch_point_2_line-start",
          "Line 2 start",
          -17.50622951036383,
          -4.747048831429789,
        ),
        makePoint(
          "sketch_point_2_line-end",
          "Line 2 end",
          -14.291285908581912,
          -1.0918727156232404,
        ),
        makePoint(
          "sketch_point_4_line-start",
          "Line 4 start",
          -17.50622951036383,
          -4.747048831429789,
        ),
        makePoint(
          "sketch_point_4_line-end",
          "Line 4 end",
          -19.066456551723654,
          5.886265464155363,
        ),
        makePoint(
          "sketch_point_5_line-start",
          "Line 5 start",
          -19.066456551723654,
          5.886265464155363,
        ),
        makePoint(
          "sketch_point_5_line-end",
          "Line 5 end",
          -14.291285911202246,
          6.534128625935561,
        ),
      ],
      entityIds: [
        "sketch_entity_1_rect-bottom",
        "sketch_entity_1_rect-right",
        "sketch_entity_1_rect-top",
        "sketch_entity_1_rect-left",
        "sketch_entity_2_line",
        "sketch_entity_4_line",
        "sketch_entity_5_line",
      ],
      entities: [
        makeLine(
          "sketch_entity_1_rect-bottom",
          "Bottom",
          "sketch_point_1_rect-bottom-left",
          "sketch_point_1_rect-bottom-right",
        ),
        makeLine(
          "sketch_entity_1_rect-right",
          "Right",
          "sketch_point_1_rect-bottom-right",
          "sketch_point_1_rect-top-right",
        ),
        makeLine(
          "sketch_entity_1_rect-top",
          "Top",
          "sketch_point_1_rect-top-right",
          "sketch_point_1_rect-top-left",
        ),
        makeLine(
          "sketch_entity_1_rect-left",
          "Left",
          "sketch_point_1_rect-top-left",
          "sketch_point_1_rect-bottom-left",
        ),
        makeLine(
          "sketch_entity_2_line",
          "Line 2",
          "sketch_point_2_line-start",
          "sketch_point_2_line-end",
        ),
        makeLine(
          "sketch_entity_4_line",
          "Line 4",
          "sketch_point_4_line-start",
          "sketch_point_4_line-end",
        ),
        makeLine(
          "sketch_entity_5_line",
          "Line 5",
          "sketch_point_5_line-start",
          "sketch_point_5_line-end",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const solvedSnapshot = makeSolvedSnapshot(definition);
    const found = findSketchRings(definition, solvedSnapshot);
    expect(
      found.rings.length,
      "Endpoint selections with floating-point residuals should produce both adjacent rings.",
    ).toBe(2);
    expect(
      found.unusedSegments.length,
      "Endpoint-selection residuals should not leave profile segments unused.",
    ).toBe(0);

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot,
    });

    expect(
      derived.regions.length,
      "Endpoint selections from existing vertices should derive both selectable profiles.",
    ).toBe(2);
    expect(
      derived.regions.some((region) =>
        region.loops[0]?.segments.some(
          (segment) =>
            segment.source.kind === "entity" &&
            segment.source.entityId === "sketch_entity_2_line",
        ),
      ),
      "Derived profiles should include the second loop bounded by the referenced line endpoints.",
    ).toBeTruthy();
  }

  async function testRegionIdsSurviveSortOrderChanges() {
    function makeDefinition(secondWidth: number): SketchDefinition {
      const points = [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 2, 0),
        makePoint("sketch_point_a2", "A2", 2, 2),
        makePoint("sketch_point_a3", "A3", 0, 2),
        makePoint("sketch_point_b0", "B0", 4, 0),
        makePoint("sketch_point_b1", "B1", 4 + secondWidth, 0),
        makePoint("sketch_point_b2", "B2", 4 + secondWidth, secondWidth),
        makePoint("sketch_point_b3", "B3", 4, secondWidth),
      ];
      const entities = [
        makeLine(
          "sketch_entity_a_bottom",
          "A bottom",
          "sketch_point_a0",
          "sketch_point_a1",
        ),
        makeLine(
          "sketch_entity_a_right",
          "A right",
          "sketch_point_a1",
          "sketch_point_a2",
        ),
        makeLine(
          "sketch_entity_a_top",
          "A top",
          "sketch_point_a2",
          "sketch_point_a3",
        ),
        makeLine(
          "sketch_entity_a_left",
          "A left",
          "sketch_point_a3",
          "sketch_point_a0",
        ),
        makeLine(
          "sketch_entity_b_bottom",
          "B bottom",
          "sketch_point_b0",
          "sketch_point_b1",
        ),
        makeLine(
          "sketch_entity_b_right",
          "B right",
          "sketch_point_b1",
          "sketch_point_b2",
        ),
        makeLine(
          "sketch_entity_b_top",
          "B top",
          "sketch_point_b2",
          "sketch_point_b3",
        ),
        makeLine(
          "sketch_entity_b_left",
          "B left",
          "sketch_point_b3",
          "sketch_point_b0",
        ),
      ];
      return {
        schemaVersion: "sketch-definition/v1alpha1",
        referenceIds: [],
        references: [],
        pointIds: points.map((point) => point.pointId),
        points,
        entityIds: entities.map((entity) => entity.entityId),
        entities,
        constraintIds: [],
        constraints: [],
        dimensionIds: [],
        dimensions: [],
      };
    }

    function regionIdForEntity(definition: SketchDefinition, entityId: string) {
      const derived = deriveSketchRegionsCore({
        documentId: "doc_workspace",
        revisionId: "rev_0001",
        sketchId: "sketch_primary",
        definition,
        solvedSnapshot: makeSolvedSnapshot(definition),
      });
      const region = derived.regions.find((candidate) =>
        candidate.loops[0]?.segments.some(
          (segment) =>
            segment.source.kind === "entity" &&
            segment.source.entityId === entityId,
        ),
      );
      expect(region, `Expected a region containing ${entityId}.`).toBeTruthy();
      return region.regionId;
    }

    const stableRegionId = regionIdForEntity(
      makeDefinition(1),
      "sketch_entity_a_bottom",
    );
    const resortedRegionId = regionIdForEntity(
      makeDefinition(4),
      "sketch_entity_a_bottom",
    );

    expect(
      stableRegionId,
      "Region ids should be based on boundary content, not sorted position.",
    ).toBe(resortedRegionId);
  }

  async function testRegionIdsUseCanonicalBoundarySource() {
    const points = [
      makePoint("sketch_point_0", "P0", 0, 0),
      makePoint("sketch_point_1", "P1", 2, 0),
      makePoint("sketch_point_2", "P2", 2, 2),
      makePoint("sketch_point_3", "P3", 0, 2),
    ];
    const entities = [
      makeLine("sketch_entity_z_bottom", "Bottom", "sketch_point_0", "sketch_point_1"),
      makeLine("sketch_entity_a_right", "Right", "sketch_point_1", "sketch_point_2"),
      makeLine("sketch_entity_b_top", "Top", "sketch_point_2", "sketch_point_3"),
      makeLine("sketch_entity_c_left", "Left", "sketch_point_3", "sketch_point_0"),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    });

    expect(
      derived.regions[0]?.regionId,
      "Region identity should use the canonical boundary source rather than traversal start.",
    ).toMatch(/^region_primary-sketch_entity_a_right-/);
  }

  async function testFindRingsMultipleAndDeriveRegions() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_e",
        "sketch_point_f",
        "sketch_point_g",
        "sketch_point_h",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 8, 0),
        makePoint("sketch_point_c", "C", 8, 8),
        makePoint("sketch_point_d", "D", 0, 8),
        makePoint("sketch_point_e", "E", 2, 2),
        makePoint("sketch_point_f", "F", 6, 2),
        makePoint("sketch_point_g", "G", 6, 6),
        makePoint("sketch_point_h", "H", 2, 6),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
        "sketch_entity_ef",
        "sketch_entity_fg",
        "sketch_entity_gh",
        "sketch_entity_he",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
        makeLine("sketch_entity_ef", "EF", "sketch_point_e", "sketch_point_f"),
        makeLine("sketch_entity_fg", "FG", "sketch_point_f", "sketch_point_g"),
        makeLine("sketch_entity_gh", "GH", "sketch_point_g", "sketch_point_h"),
        makeLine("sketch_entity_he", "HE", "sketch_point_h", "sketch_point_e"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const solvedSnapshot = makeSolvedSnapshot(definition);
    const found = findSketchRings(definition, solvedSnapshot);
    expect(
      found.rings.length,
      "Nested rectangles should produce two rings.",
    ).toBe(2);

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot,
    });

    expect(
      derived.diagnostics.length,
      "Region derivation should not emit diagnostics for solved nested rectangles.",
    ).toBe(0);
    expect(
      derived.regions.length,
      "Nested rectangles should derive the annular cell and inner cell.",
    ).toBe(2);
    expect(
      derived.regions[0]?.loops.length,
      "Derived region should contain outer and inner loops.",
    ).toBe(2);
    expect(
      derived.regions[0]?.loops[0]?.role,
      "First loop should be outer.",
    ).toBe("outer");
    expect(
      derived.regions[0]?.loops[1]?.role,
      "Second loop should be inner.",
    ).toBe("inner");
    expect(
      derived.regions[1]?.loops.length,
      "The nested boundary should also produce its own bounded cell.",
    ).toBe(1);
  }

  async function testThreeLevelNestingKeepsIslandSolid() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_e",
        "sketch_point_f",
        "sketch_point_g",
        "sketch_point_h",
        "sketch_point_i",
        "sketch_point_j",
        "sketch_point_k",
        "sketch_point_l",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 10, 0),
        makePoint("sketch_point_c", "C", 10, 10),
        makePoint("sketch_point_d", "D", 0, 10),
        makePoint("sketch_point_e", "E", 2, 2),
        makePoint("sketch_point_f", "F", 8, 2),
        makePoint("sketch_point_g", "G", 8, 8),
        makePoint("sketch_point_h", "H", 2, 8),
        makePoint("sketch_point_i", "I", 4, 4),
        makePoint("sketch_point_j", "J", 6, 4),
        makePoint("sketch_point_k", "K", 6, 6),
        makePoint("sketch_point_l", "L", 4, 6),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
        "sketch_entity_ef",
        "sketch_entity_fg",
        "sketch_entity_gh",
        "sketch_entity_he",
        "sketch_entity_ij",
        "sketch_entity_jk",
        "sketch_entity_kl",
        "sketch_entity_li",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
        makeLine("sketch_entity_ef", "EF", "sketch_point_e", "sketch_point_f"),
        makeLine("sketch_entity_fg", "FG", "sketch_point_f", "sketch_point_g"),
        makeLine("sketch_entity_gh", "GH", "sketch_point_g", "sketch_point_h"),
        makeLine("sketch_entity_he", "HE", "sketch_point_h", "sketch_point_e"),
        makeLine("sketch_entity_ij", "IJ", "sketch_point_i", "sketch_point_j"),
        makeLine("sketch_entity_jk", "JK", "sketch_point_j", "sketch_point_k"),
        makeLine("sketch_entity_kl", "KL", "sketch_point_k", "sketch_point_l"),
        makeLine("sketch_entity_li", "LI", "sketch_point_l", "sketch_point_i"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const solvedSnapshot = makeSolvedSnapshot(definition);
    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot,
    });

    expect(
      derived.regions.length,
      "Three nested loops should derive every bounded cell.",
    ).toBe(3);
    expect(
      derived.regions[0]?.loops.length,
      "Outer solid should use the middle loop as a hole.",
    ).toBe(2);
    expect(
      derived.regions[1]?.loops.length,
      "The middle cell should use the innermost loop as its hole.",
    ).toBe(2);
    expect(
      derived.regions[2]?.loops.length,
      "The innermost loop should derive its own cell.",
    ).toBe(1);
    expect(
      derived.regions[2]?.loops[0]?.segments.some(
        (segment) =>
          segment.source.kind === "entity" &&
          segment.source.entityId === "sketch_entity_ij",
      ),
      "Innermost region should be bounded by the innermost loop.",
    ).toBeTruthy();
  }

  async function testMixedLocalAndProjectedLoopPreservesProjectedIdentity() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: ["ref_projected_profile"],
      references: [makeAuthoredReference()],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
        makePoint("sketch_point_c", "C", 4, 3),
        makePoint("sketch_point_d", "D", 0, 3),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_bc", "sketch_entity_cd"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const projectedReferences = [
      makeProjectedReference([
        {
          geometryId: "projected_geometry_left",
          kind: "lineSegment",
          startPosition: [0, 3],
          endPosition: [0, 0],
        },
      ]),
    ];

    const solvedSnapshot = makeSolvedSnapshot(definition);
    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot,
      projectedReferences,
    });

    expect(
      derived.regions.length,
      "Mixed local/projected edges should close one region.",
    ).toBe(1);
    const loop = derived.regions[0]!.loops[0]!;
    const projectedSegment = loop.segments.find(
      (segment) => segment.source.kind === "projectedGeometry",
    );
    expect(
      projectedSegment?.source.kind,
      "Loop should include projected boundary identity.",
    ).toBe("projectedGeometry");
    expect(
      projectedSegment.source.reference.referenceId,
      "Projected segment must preserve authored reference ID.",
    ).toBe("ref_projected_profile");
    expect(
      projectedSegment.source.reference.geometryId,
      "Projected segment must preserve projected geometry ID.",
    ).toBe("projected_geometry_left");
    expect(
      definition.entityIds.length,
      "Projected boundaries must not be copied into sketch-owned entity IDs.",
    ).toBe(3);
  }

  async function testProjectedOnlyCircleLoopPreservesProjectedIdentity() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: ["ref_projected_profile"],
      references: [makeAuthoredReference()],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const projectedReferences = [
      makeProjectedReference([
        {
          geometryId: "projected_geometry_circle",
          kind: "circle",
          centerPosition: [2, 2],
          radius: 1,
        },
      ]),
    ];

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
      projectedReferences,
    });

    expect(
      derived.regions.length,
      "Projected-only circles should derive profile regions.",
    ).toBe(1);
    const segment = derived.regions[0]!.loops[0]!.segments[0];
    expect(
      segment?.source.kind,
      "Projected-only loop should stay projected-sourced.",
    ).toBe("projectedGeometry");
    expect(
      segment.source.reference.geometryId,
      "Projected circle identity should survive region derivation.",
    ).toBe("projected_geometry_circle");
    expect(
      definition.points.length === 0 && definition.entities.length === 0,
      "Projected-only regions must not author copied sketch geometry.",
    ).toBeTruthy();
  }

  async function testMissingProjectedReferencesReportDiagnosticsWithoutInventingGeometry() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: ["ref_projected_profile"],
      references: [makeAuthoredReference()],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
      projectedReferences: [],
    });

    expect(
      derived.regions.length,
      "Missing projected data must not invent profile regions.",
    ).toBe(0);
    expect(
      derived.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "projected-region-reference-unresolved",
      ),
      "Missing projected data should report a machine-readable diagnostic.",
    ).toBeTruthy();
  }

  async function testUnauthoredProjectedReferencesReportDiagnosticsWithoutInventingGeometry() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const projectedReferences = [
      makeProjectedReference(
        [
          {
            geometryId: "projected_geometry_stale_circle",
            kind: "circle",
            centerPosition: [2, 2],
            radius: 1,
          },
        ],
        "ref_stale_projection",
      ),
    ];

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
      projectedReferences,
    });

    expect(
      derived.regions.length,
      "Unauthored projected data must not create profile regions.",
    ).toBe(0);
    expect(
      derived.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "projected-region-reference-unauthored",
      ),
      "Unauthored projected data should report a machine-readable diagnostic.",
    ).toBeTruthy();
    expect(
      definition.points.length === 0 && definition.entities.length === 0,
      "Rejected projected regions must not copy geometry into the sketch.",
    ).toBeTruthy();
  }

  async function testProjectedReferenceMissingAuthoredRecordIsRejected() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: ["ref_projected_profile"],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const projectedReferences = [
      makeProjectedReference([
        {
          geometryId: "projected_geometry_recordless_circle",
          kind: "circle",
          centerPosition: [2, 2],
          radius: 1,
        },
      ]),
    ];

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
      projectedReferences,
    });

    expect(
      derived.regions.length,
      "Projection data without an authored reference record must not create profile regions.",
    ).toBe(0);
    expect(
      derived.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "projected-region-reference-unauthored",
      ),
      "Missing authored reference records should report a machine-readable diagnostic.",
    ).toBeTruthy();
  }

  async function testFindCircleRegion() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_center"],
      points: [makePoint("sketch_point_center", "Center", 1, 2)],
      entityIds: ["sketch_entity_circle"],
      entities: [
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 3),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const solvedSnapshot = makeSolvedSnapshot(definition);
    const found = findSketchRings(definition, solvedSnapshot);
    expect(
      found.rings.length,
      "A standalone circle should produce one ring.",
    ).toBe(1);

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot,
    });

    expect(
      derived.regions.length,
      "A standalone circle should derive one selectable region.",
    ).toBe(1);
    expect(
      derived.regions[0]?.loops[0]?.segments.length,
      "Circle regions should use the circle entity as one closed segment.",
    ).toBe(1);
    expect(
      derived.regions[0]?.loops[0]?.segments[0]?.startPointId,
      "Circle region segments should not invent boundary points.",
    ).toBe(null);
  }

  async function testSquareWithInnerCircleDerivesAllBoundedCells() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_center",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 8, 0),
        makePoint("sketch_point_c", "C", 8, 8),
        makePoint("sketch_point_d", "D", 0, 8),
        makePoint("sketch_point_center", "Center", 4, 4),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
        "sketch_entity_circle",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 2),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const solvedSnapshot = makeSolvedSnapshot(definition);
    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot,
    });

    expect(
      derived.regions.length,
      "A square with an inner circle should derive the annular and circular cells.",
    ).toBe(2);
    expect(
      derived.regions[0]?.loops.length,
      "Outer cell should include the circle as an inner loop.",
    ).toBe(2);
    expect(
      derived.regions[0]?.loops[1]?.segments[0]?.source.kind === "entity" &&
        derived.regions[0]?.loops[1]?.segments[0]?.source.entityId ===
          "sketch_entity_circle",
      "The inner loop should be bounded by the circle entity.",
    ).toBeTruthy();
  }

  async function testLineCircleIntersectionsDeriveBothBoundedCells() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_center",
        "sketch_point_left",
        "sketch_point_right",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_left", "Left", -2, 0),
        makePoint("sketch_point_right", "Right", 2, 0),
      ],
      entityIds: ["sketch_entity_circle", "sketch_entity_chord"],
      entities: [
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 2),
        makeLine(
          "sketch_entity_chord",
          "Chord",
          "sketch_point_left",
          "sketch_point_right",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
    };
    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    });

    expect(
      derived.regions.length,
      "A chord ending on a circle should derive both line-circle cells.",
    ).toBe(2);
    expect(
      derived.regions.every((region) =>
        region.loops[0]?.segments.some(
          (segment) =>
            segment.source.kind === "entity" &&
            segment.source.entityId === "sketch_entity_circle",
        ) &&
        region.loops[0]?.segments.some(
          (segment) =>
            segment.source.kind === "entity" &&
            segment.source.entityId === "sketch_entity_chord",
        ),
      ),
      "Every line-circle cell should retain both exact source boundaries.",
    ).toBeTruthy();
    expect(
      new Set(derived.regions.map((region) => region.regionId)).size,
      "Each line-circle cell should have a distinct stable region identity.",
    ).toBe(2);
  }

  async function testSplitCircleCellsKeepStableIdsAcrossTranslation() {
    const makeDefinition = (dx: number, dy: number): SketchDefinition => ({
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_center", "sketch_point_left", "sketch_point_right"],
      points: [
        makePoint("sketch_point_center", "Center", dx, dy),
        makePoint("sketch_point_left", "Left", dx - 2, dy),
        makePoint("sketch_point_right", "Right", dx + 2, dy),
      ],
      entityIds: ["sketch_entity_circle", "sketch_entity_chord"],
      entities: [
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 2),
        makeLine("sketch_entity_chord", "Chord", "sketch_point_left", "sketch_point_right"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    });
    const base = makeDefinition(0, 0);
    const translated = makeDefinition(100, -250);
    const extract = (definition: SketchDefinition) =>
      deriveSketchRegionsCore({
        documentId: "doc_workspace",
        revisionId: "rev_0001",
        sketchId: "sketch_primary",
        definition,
        solvedSnapshot: makeSolvedSnapshot(definition),
      }).regions.map((region) => region.regionId).sort();

    expect(
      extract(translated),
      "Split-circle cell identities must use source topology rather than solved coordinates.",
    ).toEqual(extract(base));
  }

  async function testLargeCircleKeepsDistinctNearbyIntersections() {
    const radius = 1_000_000_000;
    const chordX = Math.sqrt(radius * radius - 1_000 * 1_000);
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_center", "sketch_point_a0", "sketch_point_b0",
        "sketch_point_a1", "sketch_point_b1",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_a0", "A0", -radius, 0),
        makePoint("sketch_point_b0", "B0", radius, 0),
        makePoint("sketch_point_a1", "A1", -chordX, 1_000),
        makePoint("sketch_point_b1", "B1", chordX, 1_000),
      ],
      entityIds: ["sketch_entity_circle", "sketch_entity_chord_0", "sketch_entity_chord_1"],
      entities: [
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", radius),
        makeLine("sketch_entity_chord_0", "Chord 0", "sketch_point_a0", "sketch_point_b0"),
        makeLine("sketch_entity_chord_1", "Chord 1", "sketch_point_a1", "sketch_point_b1"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    });

    expect(
      derived.regions.length,
      "Large-circle intersections separated in world space must not collapse in normalized parameter space.",
    ).toBe(3);
  }

  async function testArcLineIntersectionsSplitBoundedCells() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_center", "sketch_point_left", "sketch_point_right",
        "sketch_point_divider_start", "sketch_point_divider_end",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_left", "Left", -2, 0),
        makePoint("sketch_point_right", "Right", 2, 0),
        makePoint("sketch_point_divider_start", "Divider start", 0, 0),
        makePoint("sketch_point_divider_end", "Divider end", 0, 2),
      ],
      entityIds: ["sketch_entity_arc", "sketch_entity_chord_left", "sketch_entity_chord_right", "sketch_entity_divider"],
      entities: [
        makeArc("sketch_entity_arc", "Arc", "sketch_point_center", "sketch_point_right", "sketch_point_left"),
        makeLine("sketch_entity_chord_left", "Chord left", "sketch_point_left", "sketch_point_divider_start"),
        makeLine("sketch_entity_chord_right", "Chord right", "sketch_point_divider_start", "sketch_point_right"),
        makeLine("sketch_entity_divider", "Divider", "sketch_point_divider_start", "sketch_point_divider_end"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    });

    expect(
      derived.regions.length,
      "An interior arc-line intersection must split a bounded arc-and-chord cell.",
    ).toBe(2);
  }

  async function testConstructionGeometryDoesNotSplitNormalProfile() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_cross_start",
        "sketch_point_cross_end",
        "sketch_point_arc_center",
        "sketch_point_arc_start",
        "sketch_point_arc_end",
        "sketch_point_circle_center",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 8, 0),
        makePoint("sketch_point_c", "C", 8, 8),
        makePoint("sketch_point_d", "D", 0, 8),
        makePoint("sketch_point_cross_start", "Cross start", 4, -1),
        makePoint("sketch_point_cross_end", "Cross end", 4, 9),
        makePoint("sketch_point_arc_center", "Arc center", 4, 4),
        makePoint("sketch_point_arc_start", "Arc start", 5, 4),
        makePoint("sketch_point_arc_end", "Arc end", 4, 5),
        makePoint("sketch_point_circle_center", "Circle center", 2, 2),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
        "sketch_entity_cross",
        "sketch_entity_arc",
        "sketch_entity_circle",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
        makeLine(
          "sketch_entity_cross",
          "Cross",
          "sketch_point_cross_start",
          "sketch_point_cross_end",
          true,
        ),
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_arc_center",
          "sketch_point_arc_start",
          "sketch_point_arc_end",
          true,
        ),
        {
          ...makeCircle(
            "sketch_entity_circle",
            "Circle",
            "sketch_point_circle_center",
            1,
          ),
          isConstruction: true,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    });

    expect(
      derived.regions.length,
      "Construction line, arc, and circle geometry must not split or remove a normal profile.",
    ).toBe(1);
    expect(
      derived.regions[0]?.loops[0]?.segments.every(
        (segment) =>
          segment.source.kind === "entity" &&
          segment.source.entityId !== "sketch_entity_cross" &&
          segment.source.entityId !== "sketch_entity_arc" &&
          segment.source.entityId !== "sketch_entity_circle",
      ),
      "Construction line, arc, and circle entities must be excluded from profile boundaries.",
    ).toBeTruthy();
  }

  async function testClosedConstructionCircleDoesNotCreateRegion() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_center"],
      points: [makePoint("sketch_point_center", "Center", 0, 0)],
      entityIds: ["sketch_entity_circle"],
      entities: [
        {
          ...makeCircle(
            "sketch_entity_circle",
            "Circle",
            "sketch_point_center",
            2,
          ),
          isConstruction: true,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const found = findSketchRings(definition, makeSolvedSnapshot(definition));
    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    });

    expect(
      found.rings.length,
      "Closed construction circles should not produce sketch rings.",
    ).toBe(0);
    expect(
      derived.regions.length,
      "Closed construction circles should not create selectable profile regions.",
    ).toBe(0);
  }

  async function testSelfIntersectingProfileIsRejectedWithDiagnostic() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 2, 2),
        makePoint("sketch_point_c", "C", 0, 2),
        makePoint("sketch_point_d", "D", 2, 0),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const solvedSnapshot = makeSolvedSnapshot(definition);
    const found = findSketchRings(definition, solvedSnapshot);
    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot,
    });

    expect(
      found.rings.length,
      "Self-intersecting profile loops should not produce valid rings.",
    ).toBe(0);
    expect(
      derived.regions.length,
      "Self-intersecting profile loops should not become selectable regions.",
    ).toBe(0);
    expect(
      derived.diagnostics.some(
        (diagnostic) => diagnostic.code === "profile-invalid-ring",
      ),
      "Rejected self-intersections should emit a diagnostic before reaching OCC.",
    ).toBeTruthy();
  }

  async function testOpenAndDegenerateSegmentsAreSurfacedAsDiagnostics() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_c"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 2, 0),
        makePoint("sketch_point_c", "C", 2, 0),
      ],
      entityIds: ["sketch_entity_open", "sketch_entity_zero"],
      entities: [
        makeLine(
          "sketch_entity_open",
          "Open",
          "sketch_point_a",
          "sketch_point_b",
        ),
        makeLine(
          "sketch_entity_zero",
          "Zero",
          "sketch_point_b",
          "sketch_point_c",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    });

    expect(
      derived.regions.length,
      "Open and degenerate profile segments should not create regions.",
    ).toBe(0);
    expect(
      derived.diagnostics.some(
        (diagnostic) => diagnostic.code === "profile-open-segment",
      ),
      "Open profile segments should be reported as diagnostics.",
    ).toBeTruthy();
    expect(
      derived.diagnostics.some(
        (diagnostic) => diagnostic.code === "profile-degenerate-segment",
      ),
      "Degenerate profile segments should be reported as diagnostics.",
    ).toBeTruthy();
  }

  async function testArcAndChordDeriveSingleClosedRegion() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_center",
        "sketch_point_start",
        "sketch_point_end",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_start", "Start", 1, 0),
        makePoint("sketch_point_end", "End", -1, 0),
      ],
      entityIds: ["sketch_entity_arc", "sketch_entity_chord"],
      entities: [
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_center",
          "sketch_point_start",
          "sketch_point_end",
        ),
        makeLine(
          "sketch_entity_chord",
          "Chord",
          "sketch_point_end",
          "sketch_point_start",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const derived = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: makeSolvedSnapshot(definition),
    });

    expect(
      derived.regions.length,
      "An arc and its chord should derive one closed D-shaped region.",
    ).toBe(1);
    const outerLoop = derived.regions[0]?.loops[0];
    expect(
      !outerLoop,
      "Derived arc-chord region should include an outer loop.",
    ).toBeFalsy();
    expect(
      outerLoop?.segments.length,
      "Derived arc-chord loop should preserve the two authored boundary segments.",
    ).toBe(2);
    expect(
      outerLoop?.segments[0]?.source.kind === "entity" &&
        outerLoop.segments[0].source.entityId === "sketch_entity_arc",
      "Derived arc-chord loop should keep the arc as the first boundary segment.",
    ).toBeTruthy();
    expect(
      outerLoop?.segments[1]?.source.kind === "entity" &&
        outerLoop.segments[1].source.entityId === "sketch_entity_chord",
      "Derived arc-chord loop should keep the chord as the second boundary segment.",
    ).toBeTruthy();
  }

  async function run() {
    await testFindRingsNone();
    await testFindRingsOne();
    await testJiggledRectangleRegionsStayStableAndPositioned();
    await testEndpointSelectionResidualsDeriveAdjacentProfiles();
    await testRegionIdsSurviveSortOrderChanges();
    await testRegionIdsUseCanonicalBoundarySource();
    await testFindRingsMultipleAndDeriveRegions();
    await testThreeLevelNestingKeepsIslandSolid();
    await testMixedLocalAndProjectedLoopPreservesProjectedIdentity();
    await testProjectedOnlyCircleLoopPreservesProjectedIdentity();
    await testMissingProjectedReferencesReportDiagnosticsWithoutInventingGeometry();
    await testUnauthoredProjectedReferencesReportDiagnosticsWithoutInventingGeometry();
    await testProjectedReferenceMissingAuthoredRecordIsRejected();
    await testFindCircleRegion();
    await testSquareWithInnerCircleDerivesAllBoundedCells();
    await testLineCircleIntersectionsDeriveBothBoundedCells();
    await testSplitCircleCellsKeepStableIdsAcrossTranslation();
    await testLargeCircleKeepsDistinctNearbyIntersections();
    await testArcLineIntersectionsSplitBoundedCells();
    await testConstructionGeometryDoesNotSplitNormalProfile();
    await testClosedConstructionCircleDoesNotCreateRegion();
    await testSelfIntersectingProfileIsRejectedWithDiagnostic();
    await testOpenAndDegenerateSegmentsAreSurfacedAsDiagnostics();
    await testArcAndChordDeriveSingleClosedRegion();
  }

  await run();
});
