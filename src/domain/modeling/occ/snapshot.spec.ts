import { test, expect } from "vitest";
import type { ModelingKernelAdapter } from "@/contracts/modeling/adapter";
import {
  createModelingService,
  type ModelingService,
} from "@/domain/modeling/modeling-service";
import type {
  ConstructionSnapshotRecord,
  FeatureDefinition,
  GetDocumentSnapshotResponse,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type {
  BodyId,
  FeatureId,
  ProjectedGeometryId,
  ReferenceId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  FILLET_FEATURE_SCHEMA_VERSION,
  PLANE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from "@/contracts/sketch/schema";
import { deriveSketchRegionsCore } from "@/contracts/sketch/region-extraction";
import { buildOccWorkspaceSnapshot } from "@/domain/modeling/occ/snapshot";
import { getAutoHiddenSketchTargetKeys } from "@/domain/editor/visibility";
import {
  createOccAuthoringState,
  rebuildOccAuthoringState,
} from "@/domain/modeling/occ/authoring-state";
import { getDefaultOpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { extractPlanarFaceData, toGpPnt } from "@/domain/modeling/occ/planes";
import { trackNewSolidBody } from "@/domain/modeling/occ/topology";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  OCC_KERNEL_SETTINGS,
  createStandardPlaneDefinition,
} from "@/domain/modeling/opencascade-kernel-seed";

test("src/domain/modeling/occ/snapshot.spec.ts", async () => {
  function pointId(name: string) {
    return `sketch_point_${name}` as SketchPointId;
  }

  function entityId(name: string) {
    return `sketch_entity_${name}` as SketchEntityId;
  }

  function createSketchDefinition(
    sketchId: SketchId,
    points: Array<{ id: SketchPointId; position: readonly [number, number] }>,
    entities: SketchDefinition["entities"],
  ): SketchDefinition {
    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.id),
      points: points.map((point) => ({
        pointId: point.id,
        label: point.id,
        target: { kind: "sketchPoint", sketchId, pointId: point.id },
        position: point.position,
        isConstruction: false,
      })),
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
  }

  function createSketchRecord(
    sketchId: SketchId,
    plane: SketchPlaneDefinition,
    definition: SketchDefinition,
    solvedEntities: SketchRecord["solvedSnapshot"]["solvedEntities"],
    regions: RegionRecord[],
  ): SketchSnapshotRecord {
    const sketch: SketchRecord = {
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      sketchId,
      label: sketchId,
      planeSupport: plane.support,
      definition,
      solvedSnapshot: {
        schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
        status: {
          solveState: "solved",
          constraintState: "wellConstrained",
        },
        solvedEntities,
        solvedPoints: [],
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      regions,
    };

    return {
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      sketchId,
      label: sketchId,
      plane,
      sketch,
    };
  }

  function createRectangleSketch(
    sketchId: SketchId,
    plane: SketchPlaneDefinition,
    options: {
      origin?: readonly [number, number];
      width?: number;
      height?: number;
    } = {},
  ) {
    const origin = options.origin ?? [0, 0];
    const width = options.width ?? 4;
    const height = options.height ?? 3;
    const points = [
      {
        id: pointId(`${sketchId}_bottom_left`),
        position: [origin[0], origin[1]] as const,
      },
      {
        id: pointId(`${sketchId}_bottom_right`),
        position: [origin[0] + width, origin[1]] as const,
      },
      {
        id: pointId(`${sketchId}_top_right`),
        position: [origin[0] + width, origin[1] + height] as const,
      },
      {
        id: pointId(`${sketchId}_top_left`),
        position: [origin[0], origin[1] + height] as const,
      },
    ];
    const entities = [
      {
        kind: "lineSegment" as const,
        entityId: entityId(`${sketchId}_bottom`),
        label: "bottom",
        target: {
          kind: "sketchEntity" as const,
          sketchId,
          entityId: entityId(`${sketchId}_bottom`),
        },
        isConstruction: false,
        startPointId: points[0]!.id,
        endPointId: points[1]!.id,
      },
      {
        kind: "lineSegment" as const,
        entityId: entityId(`${sketchId}_right`),
        label: "right",
        target: {
          kind: "sketchEntity" as const,
          sketchId,
          entityId: entityId(`${sketchId}_right`),
        },
        isConstruction: false,
        startPointId: points[1]!.id,
        endPointId: points[2]!.id,
      },
      {
        kind: "lineSegment" as const,
        entityId: entityId(`${sketchId}_top`),
        label: "top",
        target: {
          kind: "sketchEntity" as const,
          sketchId,
          entityId: entityId(`${sketchId}_top`),
        },
        isConstruction: false,
        startPointId: points[2]!.id,
        endPointId: points[3]!.id,
      },
      {
        kind: "lineSegment" as const,
        entityId: entityId(`${sketchId}_left`),
        label: "left",
        target: {
          kind: "sketchEntity" as const,
          sketchId,
          entityId: entityId(`${sketchId}_left`),
        },
        isConstruction: false,
        startPointId: points[3]!.id,
        endPointId: points[0]!.id,
      },
    ];
    const definition = createSketchDefinition(sketchId, points, entities);
    const regionId = `region_${sketchId}_outer` as const;
    const region: RegionRecord = {
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      regionId,
      label: regionId,
      target: { kind: "region", sketchId, regionId },
      sourceSketch: { kind: "sketch", sketchId },
      loops: [
        {
          loopId: `region_loop_${sketchId}_outer` as const,
          role: "outer",
          orientation: "counterClockwise",
          segments: entities.map((entity, index) => ({
            source: { kind: "entity" as const, entityId: entity.entityId },
            startPointId: points[index]!.id,
            endPointId: points[(index + 1) % points.length]!.id,
          })),
          boundaryPointIds: points.map((point) => point.id),
          isClosed: true,
        },
      ],
      isClosed: true,
    };

    return {
      sketch: createSketchRecord(
        sketchId,
        plane,
        definition,
        [
          {
            kind: "lineSegment",
            entityId: entities[0]!.entityId,
            startPosition: points[0]!.position,
            endPosition: points[1]!.position,
          },
          {
            kind: "lineSegment",
            entityId: entities[1]!.entityId,
            startPosition: points[1]!.position,
            endPosition: points[2]!.position,
          },
          {
            kind: "lineSegment",
            entityId: entities[2]!.entityId,
            startPosition: points[2]!.position,
            endPosition: points[3]!.position,
          },
          {
            kind: "lineSegment",
            entityId: entities[3]!.entityId,
            startPosition: points[3]!.position,
            endPosition: points[0]!.position,
          },
        ],
        [region],
      ),
      region,
    };
  }

  function createConstructionSnapshot(
    constructionId: ConstructionSnapshotRecord["constructionId"],
  ): ConstructionSnapshotRecord {
    const standardKey =
      constructionId === "construction_plane-xy"
        ? "xy"
        : constructionId === "construction_plane-yz"
          ? "yz"
          : "xz";

    return {
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      ownerFeatureId: null,
      ownerSketchId: null,
      ownerBodyId: null,
      constructionId,
      label: constructionId,
      constructionType: "plane",
      plane: createStandardPlaneDefinition(standardKey),
      target: { kind: "construction", constructionId },
    };
  }

  async function createBoxBody(
    options: {
      bodyId?: BodyId;
      width?: number;
      depth?: number;
      height?: number;
    } = {},
  ) {
    const oc = await getDefaultOpenCascadeInstance();
    const box = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      options.width ?? 10,
      options.depth ?? 8,
      options.height ?? 6,
    );
    box.Build(new oc.Message_ProgressRange_1());
    expect(
      box.IsDone(),
      "Expected OCC box builder to succeed for phase 6 snapshot tests.",
    ).toBeTruthy();

    return trackNewSolidBody(oc, {
      bodyId: options.bodyId ?? "body_phase6_seed",
      label: "Seed Body",
      ownerFeatureId: "feature_seed",
      shape: box.Shape(),
    });
  }

  function findPlanarFaceByAxis(
    oc: Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>,
    body: NonNullable<
      ReturnType<typeof rebuildOccAuthoringState>["bodies"][number]
    >,
    axis: "x" | "y" | "z",
    coordinate: number,
  ) {
    const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const faceId = body.topology.faceIds.find((candidate) => {
      const face = body.facesById.get(candidate);
      if (!face) {
        return false;
      }

      const plane = extractPlanarFaceData(oc, face);
      return (
        Math.abs(Math.abs(plane.frame.normal[axisIndex] ?? 0) - 1) < 0.001 &&
        Math.abs(plane.frame.origin[axisIndex] - coordinate) < 0.001
      );
    });

    expect(
      faceId,
      `Expected body ${body.bodyId} to expose a planar face at ${axis}=${coordinate}.`,
    ).toBeTruthy();
    return faceId;
  }

  function createSnapshotAdapter(
    snapshot: GetDocumentSnapshotResponse["snapshot"],
  ): ModelingKernelAdapter {
    return {
      async getDocumentSnapshot() {
        return {
          contractVersion: snapshot.document.contractVersion,
          snapshot,
        };
      },
      async commitSketch() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async createFeature() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async updateFeature() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async deleteFeature() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async deleteTarget() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async renameBody() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async reorderFeature() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async setFeatureCursor() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async addDocumentVariable() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async updateDocumentVariable() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async evaluatePreview() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
      async resolveReference() {
        throw new Error("Not implemented in phase 6 snapshot test adapter.");
      },
    };
  }

  function createModelingSnapshotValidator(
    snapshot: GetDocumentSnapshotResponse["snapshot"],
  ): ModelingService {
    return createModelingService(createSnapshotAdapter(snapshot), {
      currentDocumentId: OCC_KERNEL_DOCUMENT_ID,
    });
  }

  async function testWorkspaceSnapshotBuildsContractValidRenderExport() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const { sketch, region } = createRectangleSketch(
      "sketch_phase6_snapshot" as SketchId,
      plane,
    );
    const initialState = createOccAuthoringState(oc, {
      sketches: [sketch],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    const features: readonly {
      featureId: FeatureId;
      suppressed: boolean;
      definition: FeatureDefinition;
    }[] = [
      {
        featureId: "feature_phase6_plane" as FeatureId,
        suppressed: false,
        definition: {
          kind: "plane",
          featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
          parameters: {
            mode: "coplanar",
            reference: {
              target: {
                kind: "construction",
                constructionId: "construction_plane-xy",
              },
            },
          },
        },
      },
      {
        featureId: "feature_phase6_extrude" as FeatureId,
        suppressed: false,
        definition: {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
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
              end: {
                kind: "blind",
                direction: "positive",
                distance: { source: "literal", value: 6 },
              },
            },
            operation: { source: "literal", value: "newBody" },
            booleanScope: { kind: "standalone" },
          },
        },
      },
    ];
    const rebuilt = rebuildOccAuthoringState(initialState, features);
    const snapshot = buildOccWorkspaceSnapshot(rebuilt);
    const validator = createModelingSnapshotValidator(snapshot);
    const normalized = await validator.getCurrentDocumentSnapshot();

    expect(
      normalized.document.documentId,
      "Phase 6 workspace snapshot must preserve the document ID.",
    ).toBe(OCC_KERNEL_DOCUMENT_ID);
    expect(
      normalized.document.render.records.length > 0,
      "Phase 6 workspace snapshot must export render records.",
    ).toBeTruthy();
    expect(
      normalized.document.featureTree.length >= 5,
      "Phase 6 workspace snapshot must populate the feature tree.",
    ).toBeTruthy();
    expect(
      normalized.document.objects.length >= 4,
      "Phase 6 workspace snapshot must populate the object tree.",
    ).toBeTruthy();
    expect(
      normalized.document.features.length,
      "Phase 6 workspace snapshot must include every rebuilt feature.",
    ).toBe(2);
    expect(
      normalized.document.bodies.length,
      "Phase 6 workspace snapshot must include rebuilt body snapshots.",
    ).toBe(1);

    const planarFaceEntity = normalized.document.entities.find(
      (entry) =>
        entry.target.kind === "face" &&
        entry.selectionSemantics.includes("planarFace"),
    );
    expect(
      planarFaceEntity,
      "Phase 6 snapshot entities must expose planar-face selection semantics.",
    ).toBeTruthy();
    expect(
      planarFaceEntity.selectionSemantics.includes("planarReference"),
      "Planar face entities must also advertise planar-reference semantics.",
    ).toBeTruthy();

    const constructionEntity = normalized.document.entities.find(
      (entry) =>
        entry.target.kind === "construction" &&
        entry.selectionSemantics.includes("constructionPlane"),
    );
    expect(
      constructionEntity,
      "Phase 6 snapshot entities must expose construction-plane semantics.",
    ).toBeTruthy();
    expect(
      constructionEntity.selectionSemantics.includes("planarReference"),
      "Construction entities must also advertise planar-reference semantics.",
    ).toBeTruthy();

    expect(
      normalized.document.render.records.some(
        (record) =>
          record.binding.topology === "face" &&
          record.binding.semanticClass === "planarFace",
      ),
      "Phase 6 render export must include planar-face mesh bindings.",
    ).toBeTruthy();
    expect(
      normalized.document.render.records.some(
        (record) =>
          record.binding.topology === "edge" &&
          record.binding.semanticClass === "featureEdge",
      ),
      "Phase 6 render export must include edge polyline bindings.",
    ).toBeTruthy();
    expect(
      normalized.document.render.records.some(
        (record) =>
          record.binding.topology === "vertex" &&
          record.binding.semanticClass === "featureVertex",
      ),
      "Phase 6 render export must include vertex marker bindings.",
    ).toBeTruthy();
    expect(
      normalized.document.render.records.some(
        (record) =>
          record.binding.topology === null &&
          record.binding.semanticClass === "construction",
      ),
      "Phase 6 render export must include construction render bindings.",
    ).toBeTruthy();
    expect(
      normalized.document.render.records.some(
        (record) =>
          record.binding.topology === null &&
          record.binding.semanticClass === "construction" &&
          record.geometry.kind === "mesh",
      ),
      "Phase 6 render export must expose filled construction-plane surfaces for viewport picking.",
    ).toBeTruthy();
    expect(
      normalized.document.render.records.some(
        (record) =>
          record.binding.topology === null &&
          record.binding.semanticClass === "region" &&
          record.binding.target.kind === "region" &&
          record.geometry.kind === "mesh",
      ),
      "Phase 6 render export must expose filled sketch-region surfaces for viewport profile picking.",
    ).toBeTruthy();
    const yzConstruction = normalized.document.constructions.find(
      (construction) => construction.constructionId === "construction_plane-yz",
    );
    expect(
      yzConstruction,
      "Phase 6 snapshot must include the standard YZ construction plane.",
    ).toBeTruthy();
    expect(
      yzConstruction.plane.key === "yz" &&
        yzConstruction.plane.frame.normal[0] === 1,
      "Construction snapshots must carry explicit plane definitions for non-XY sketch entry.",
    ).toBeTruthy();
    expect(
      normalized.document.render.records.some(
        (record) =>
          record.binding.topology === null &&
          record.binding.semanticClass === "sketchCurve",
      ),
      "Phase 6 render export must include sketch-curve render bindings.",
    ).toBeTruthy();
    expect(
      normalized.document.render.records.some(
        (record) =>
          record.binding.topology === null &&
          record.binding.semanticClass === "sketchPoint",
      ),
      "Phase 6 render export must include sketch-point render bindings.",
    ).toBeTruthy();
  }

  async function testSketchOwnedProfilesMarkConsumedSketchOwnership() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const { sketch, region } = createRectangleSketch(
      "sketch_phase6_consumed_region" as SketchId,
      plane,
    );
    const rebuilt = rebuildOccAuthoringState(
      createOccAuthoringState(oc, {
        sketches: [sketch],
        modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
      }),
      [
        {
          featureId: "feature_phase6_region_consumer" as FeatureId,
          suppressed: false,
          definition: {
            kind: "extrude",
            featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
            parameters: {
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
                end: {
                  kind: "blind",
                  direction: "positive",
                  distance: { source: "literal", value: 5 },
                },
              },
              operation: { source: "literal", value: "newBody" },
              booleanScope: { kind: "standalone" },
            },
          },
        },
      ],
    );
    const snapshot = buildOccWorkspaceSnapshot(rebuilt);
    const sketchKey = `sketch:${sketch.sketchId}`;
    const sketchEntity = snapshot.presentation.entities.find(
      (entity) =>
        entity.target.kind === "sketch" &&
        entity.target.sketchId === sketch.sketchId,
    );
    const autoHiddenSketchTargetKeys = getAutoHiddenSketchTargetKeys(snapshot);

    expect(
      sketchEntity,
      "Region-consumer coverage must expose the committed sketch entity row.",
    ).toBeTruthy();
    expect(
      sketchEntity.consumedByFeatureIds.includes(
        "feature_phase6_region_consumer" as FeatureId,
      ),
      "Sketch-owned region profiles should mark the owning sketch as consumed.",
    ).toBeTruthy();
    expect(
      autoHiddenSketchTargetKeys[sketchKey],
      "Derived auto-hide should treat sketch-owned consumed profiles as consumed sketch rows.",
    ).toBeTruthy();
  }

  async function testPlanarFaceProfilesDoNotInventConsumedSketchOwnership() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const { sketch } = createRectangleSketch(
      "sketch_phase6_face_profile" as SketchId,
      plane,
    );
    const body = await createBoxBody({
      bodyId: "body_phase6_face_profile" as BodyId,
    });
    const faceId = body.topology.faceIds[0];

    expect(
      faceId,
      "Planar-face profile coverage requires at least one body face.",
    ).toBeTruthy();

    const rebuilt = rebuildOccAuthoringState(
      createOccAuthoringState(oc, {
        sketches: [sketch],
        bodies: [body],
        modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
      }),
      [
        {
          featureId: "feature_phase6_face_consumer" as FeatureId,
          suppressed: false,
          definition: {
            kind: "extrude",
            featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
            parameters: {
              profiles: [{ kind: "face", bodyId: body.bodyId, faceId }],
              startExtent: { kind: "profilePlane" },
              extent: {
                mode: "oneSide",
                end: {
                  kind: "blind",
                  direction: "positive",
                  distance: { source: "literal", value: 4 },
                },
              },
              operation: { source: "literal", value: "newBody" },
              booleanScope: { kind: "standalone" },
            },
          },
        },
      ],
    );
    const snapshot = buildOccWorkspaceSnapshot(rebuilt);
    const sketchEntity = snapshot.presentation.entities.find(
      (entity) =>
        entity.target.kind === "sketch" &&
        entity.target.sketchId === sketch.sketchId,
    );
    const autoHiddenSketchTargetKeys = getAutoHiddenSketchTargetKeys(snapshot);

    expect(
      sketchEntity,
      "Planar-face profile coverage must keep the unrelated sketch entity available.",
    ).toBeTruthy();
    expect(
      sketchEntity.consumedByFeatureIds.length,
      "Planar-face-only profiles should not mark unrelated committed sketches as consumed.",
    ).toBe(0);
    expect(
      autoHiddenSketchTargetKeys[`sketch:${sketch.sketchId}`],
      "Planar-face-only profiles should not derive auto-hidden sketch rows.",
    ).not.toBeTruthy();
  }

  async function testShellSnapshotEntitiesExposeContributorAncestry() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const { sketch, region } = createRectangleSketch(
      "sketch_phase6_shell_contributors" as SketchId,
      plane,
      {
        width: 10,
        height: 8,
      },
    );
    const extrudeFeatureId = "feature_phase6_shell_extrude" as FeatureId;
    const shellFeatureId = "feature_phase6_shell" as FeatureId;
    const extrudeDefinition: FeatureDefinition = {
      kind: "extrude",
      featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
      parameters: {
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
          end: {
            kind: "blind",
            direction: "positive",
            distance: { source: "literal", value: 6 },
          },
        },
        operation: { source: "literal", value: "newBody" },
        booleanScope: { kind: "standalone" },
      },
    };
    const initialState = createOccAuthoringState(oc, {
      sketches: [sketch],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    const extrudeState = rebuildOccAuthoringState(initialState, [
      {
        featureId: extrudeFeatureId,
        suppressed: false,
        definition: extrudeDefinition,
      },
    ]);
    const extrudeBody = extrudeState.bodies[0];

    expect(
      extrudeBody,
      "Shell contributor coverage requires the extrude body to exist.",
    ).toBeTruthy();

    const removableFaceId = findPlanarFaceByAxis(oc, extrudeBody, "z", 6);
    const shellDefinition: FeatureDefinition = {
      kind: "shell",
      featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
      parameters: {
        bodyTarget: { kind: "body", bodyId: extrudeBody.bodyId },
        faceTargets: [
          { kind: "face", bodyId: extrudeBody.bodyId, faceId: removableFaceId },
        ],
        thickness: { source: "literal", value: 1 },
        operation: { source: "literal", value: "newBody" },
        booleanScope: { kind: "standalone" },
      },
    };
    const authoredFeatures = [
      {
        featureId: extrudeFeatureId,
        suppressed: false,
        definition: extrudeDefinition,
      },
      {
        featureId: shellFeatureId,
        suppressed: false,
        definition: shellDefinition,
      },
    ] as const;
    const shelledState = rebuildOccAuthoringState(
      initialState,
      authoredFeatures,
    );
    const shelledBody = shelledState.bodies.find(
      (body) => body.ownerFeatureId === shellFeatureId,
    );

    expect(
      shelledBody,
      "Shelled contributor coverage requires the replacement body to exist.",
    ).toBeTruthy();

    const preservedBackFaceId = findPlanarFaceByAxis(oc, shelledBody, "y", 8);
    const innerBackFaceId = findPlanarFaceByAxis(oc, shelledBody, "y", 7);
    const snapshot = buildOccWorkspaceSnapshot(shelledState);
    const reloadedSnapshot = buildOccWorkspaceSnapshot(
      rebuildOccAuthoringState(
        createOccAuthoringState(oc, {
          sketches: [sketch],
          modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
        }),
        authoredFeatures,
      ),
    );
    const findFaceEntity = (currentSnapshot: typeof snapshot, faceId: string) =>
      currentSnapshot.presentation.entities.find(
        (entity) =>
          entity.target.kind === "face" &&
          entity.target.bodyId === shelledBody.bodyId &&
          entity.target.faceId === faceId,
      );
    const preservedBackFace = findFaceEntity(snapshot, preservedBackFaceId);
    const innerBackFace = findFaceEntity(snapshot, innerBackFaceId);
    const reloadedPreservedBackFace = findFaceEntity(
      reloadedSnapshot,
      preservedBackFaceId,
    );
    const reloadedInnerBackFace = findFaceEntity(
      reloadedSnapshot,
      innerBackFaceId,
    );

    expect(
      preservedBackFace,
      "Shelled snapshots must expose the preserved back face entity.",
    ).toBeTruthy();
    expect(
      innerBackFace,
      "Shelled snapshots must expose the inner shell face entity.",
    ).toBeTruthy();
    expect(
      preservedBackFace.contributingFeatureIds.join("|"),
      "Preserved back faces should keep only the original extrude contributor ancestry.",
    ).toBe(extrudeFeatureId);
    expect(
      innerBackFace.contributingFeatureIds.join("|"),
      "Inner shell faces should expose authored-order extrude and shell contributor ancestry.",
    ).toBe(`${extrudeFeatureId}|${shellFeatureId}`);
    expect(
      reloadedPreservedBackFace?.contributingFeatureIds.join("|"),
      "Reloaded snapshots should preserve contributor ancestry for preserved shell topology.",
    ).toBe(preservedBackFace.contributingFeatureIds.join("|"));
    expect(
      reloadedInnerBackFace?.contributingFeatureIds.join("|"),
      "Reloaded snapshots should preserve contributor ancestry for inner shell topology.",
    ).toBe(innerBackFace.contributingFeatureIds.join("|"));
  }

  async function testConstructionSketchGeometryIsOmittedFromDocumentRenderExport() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const sketchId = "sketch_phase6_construction_render" as SketchId;
    const { sketch } = createRectangleSketch(sketchId, plane);
    const constructionEntityId = sketch.sketch.definition.entities[0]!.entityId;
    const constructionPointId = sketch.sketch.definition.points[0]!.pointId;
    const definition: SketchDefinition = {
      ...sketch.sketch.definition,
      points: sketch.sketch.definition.points.map((point) =>
        point.pointId === constructionPointId
          ? { ...point, isConstruction: true }
          : point,
      ),
      entities: sketch.sketch.definition.entities.map((entity) =>
        entity.entityId === constructionEntityId
          ? { ...entity, isConstruction: true }
          : entity,
      ),
    };
    const constructionSketch: SketchSnapshotRecord = {
      ...sketch,
      sketch: {
        ...sketch.sketch,
        definition,
      },
    };
    const initialState = createOccAuthoringState(oc, {
      sketches: [constructionSketch],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    const originalWarn = console.warn;
    console.warn = () => {};
    let snapshot: ReturnType<typeof buildOccWorkspaceSnapshot>;
    try {
      snapshot = buildOccWorkspaceSnapshot(initialState);
    } finally {
      console.warn = originalWarn;
    }

    expect(
      snapshot.document.render.records.some(
        (record) =>
          record.binding.target.kind === "sketchEntity" &&
          record.binding.target.entityId === constructionEntityId,
      ),
      "Document render export should omit construction sketch curves outside active sketch editing.",
    ).toBeFalsy();
    expect(
      snapshot.document.render.records.some(
        (record) =>
          record.binding.target.kind === "sketchPoint" &&
          record.binding.target.pointId === constructionPointId,
      ),
      "Document render export should omit construction sketch points outside active sketch editing.",
    ).toBeFalsy();
    expect(
      snapshot.document.render.records.some(
        (record) =>
          record.binding.target.kind === "sketchEntity" &&
          record.binding.target.entityId ===
            sketch.sketch.definition.entities[1]!.entityId,
      ),
      "Normal sketch curves should remain visible in the document render export.",
    ).toBeTruthy();
  }

  async function testNestedSketchRegionsExportSeparateMeshes() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const sketchId = "sketch_phase6_nested_regions" as SketchId;
    const points = [
      { id: pointId(`${sketchId}_bottom_left`), position: [0, 0] as const },
      { id: pointId(`${sketchId}_bottom_right`), position: [6, 0] as const },
      { id: pointId(`${sketchId}_top_right`), position: [6, 6] as const },
      { id: pointId(`${sketchId}_top_left`), position: [0, 6] as const },
      { id: pointId(`${sketchId}_circle_center`), position: [3, 3] as const },
    ];
    const entities: SketchDefinition["entities"] = [
      {
        kind: "lineSegment",
        entityId: entityId(`${sketchId}_bottom`),
        label: "bottom",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(`${sketchId}_bottom`),
        },
        isConstruction: false,
        startPointId: points[0]!.id,
        endPointId: points[1]!.id,
      },
      {
        kind: "lineSegment",
        entityId: entityId(`${sketchId}_right`),
        label: "right",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(`${sketchId}_right`),
        },
        isConstruction: false,
        startPointId: points[1]!.id,
        endPointId: points[2]!.id,
      },
      {
        kind: "lineSegment",
        entityId: entityId(`${sketchId}_top`),
        label: "top",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(`${sketchId}_top`),
        },
        isConstruction: false,
        startPointId: points[2]!.id,
        endPointId: points[3]!.id,
      },
      {
        kind: "lineSegment",
        entityId: entityId(`${sketchId}_left`),
        label: "left",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(`${sketchId}_left`),
        },
        isConstruction: false,
        startPointId: points[3]!.id,
        endPointId: points[0]!.id,
      },
      {
        kind: "circle",
        entityId: entityId(`${sketchId}_circle`),
        label: "circle",
        target: {
          kind: "sketchEntity",
          sketchId,
          entityId: entityId(`${sketchId}_circle`),
        },
        isConstruction: false,
        centerPointId: points[4]!.id,
        radius: 1,
      },
    ];
    const definition = createSketchDefinition(sketchId, points, entities);
    const solvedEntities: SketchRecord["solvedSnapshot"]["solvedEntities"] = [
      {
        kind: "lineSegment",
        entityId: entities[0]!.entityId,
        startPosition: [0, 0],
        endPosition: [6, 0],
      },
      {
        kind: "lineSegment",
        entityId: entities[1]!.entityId,
        startPosition: [6, 0],
        endPosition: [6, 6],
      },
      {
        kind: "lineSegment",
        entityId: entities[2]!.entityId,
        startPosition: [6, 6],
        endPosition: [0, 6],
      },
      {
        kind: "lineSegment",
        entityId: entities[3]!.entityId,
        startPosition: [0, 6],
        endPosition: [0, 0],
      },
      {
        kind: "circle",
        entityId: entities[4]!.entityId,
        centerPosition: [3, 3],
        solvedRadius: 1,
      },
    ];
    const derived = deriveSketchRegionsCore({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      sketchId,
      definition,
      solvedSnapshot: {
        schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
        status: { solveState: "solved", constraintState: "wellConstrained" },
        solvedEntities,
        solvedPoints: [],
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
    });

    const state = createOccAuthoringState(oc, {
      sketches: [
        createSketchRecord(
          sketchId,
          plane,
          definition,
          solvedEntities,
          derived.regions,
        ),
      ],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    const snapshot = buildOccWorkspaceSnapshot(state);
    const regionMeshes = snapshot.document.render.records.filter(
      (record) =>
        record.binding.semanticClass === "region" &&
        record.binding.target.kind === "region" &&
        record.geometry.kind === "mesh",
    );

    expect(
      derived.regions.length,
      "Nested square/circle sketch should derive both bounded profile cells.",
    ).toBe(2);
    expect(
      regionMeshes.length,
      "Render export must include one pickable mesh per bounded sketch region.",
    ).toBe(2);
    expect(
      derived.regions.every((region) =>
        regionMeshes.some(
          (record) =>
            record.binding.target.kind === "region" &&
            record.binding.target.regionId === region.regionId,
        ),
      ),
      "Every derived bounded region should have a matching render mesh.",
    ).toBeTruthy();
  }

  async function testJoinedExtrudeSnapshotDoesNotRenderInteriorBooleanTopology() {
    const oc = await getDefaultOpenCascadeInstance();
    const baseBody = await createBoxBody({
      bodyId: "body_phase6_join_refine_seed" as BodyId,
      width: 4,
      depth: 3,
      height: 5,
    });
    const plane = createStandardPlaneDefinition("xy");
    const { sketch, region } = createRectangleSketch(
      "sketch_phase6_join_refine" as SketchId,
      plane,
    );
    const initialState = createOccAuthoringState(oc, {
      bodies: [baseBody],
      sketches: [sketch],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    const rebuilt = rebuildOccAuthoringState(initialState, [
      {
        featureId: "feature_phase6_join_refine" as FeatureId,
        suppressed: false,
        definition: {
          kind: "extrude",
          featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
          parameters: {
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
              end: {
                kind: "blind",
                direction: "positive",
                distance: { source: "literal", value: 8 },
              },
            },
            operation: { source: "literal", value: "join" },
            booleanScope: { kind: "targetBody", bodyId: baseBody.bodyId },
          },
        },
      },
    ]);
    const snapshot = buildOccWorkspaceSnapshot(rebuilt);
    const bodyRecords = snapshot.document.render.records.filter(
      (record) => record.ownerBodyId === baseBody.bodyId,
    );
    const faceRecords = bodyRecords.filter(
      (record) =>
        record.binding.topology === "face" &&
        record.binding.semanticClass === "planarFace",
    );
    const edgeRecords = bodyRecords.filter(
      (record) =>
        record.binding.topology === "edge" &&
        record.binding.semanticClass === "featureEdge",
    );
    const vertexRecords = bodyRecords.filter(
      (record) =>
        record.binding.topology === "vertex" &&
        record.binding.semanticClass === "featureVertex",
    );

    expect(
      faceRecords.length,
      `Joined extrude snapshot should render six prism faces, got ${faceRecords.length}.`,
    ).toBe(6);
    expect(
      edgeRecords.length,
      `Joined extrude snapshot should not render middle seam edges, got ${edgeRecords.length}.`,
    ).toBe(12);
    expect(
      vertexRecords.length,
      `Joined extrude snapshot should not render middle seam vertices, got ${vertexRecords.length}.`,
    ).toBe(8);
  }

  async function testWorkspaceSnapshotPreservesInvalidatedReferencesWithoutPromotingDiagnostics() {
    const oc = await getDefaultOpenCascadeInstance();
    const baseBody = await createBoxBody();
    const initialState = createOccAuthoringState(oc, {
      bodies: [baseBody],
      constructions: [createConstructionSnapshot("construction_plane-xy")],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    const targetEdgeId = baseBody.topology.edgeIds[0];
    expect(
      targetEdgeId,
      "Expected the seeded box body to expose at least one durable edge.",
    ).toBeTruthy();

    const rebuilt = rebuildOccAuthoringState(initialState, [
      {
        featureId: "feature_phase6_fillet" as FeatureId,
        suppressed: false,
        definition: {
          kind: "fillet",
          featureTypeVersion: FILLET_FEATURE_SCHEMA_VERSION,
          parameters: {
            radius: { source: "literal", value: 0.5 },
            edgeTargets: [
              {
                kind: "edge",
                bodyId: baseBody.bodyId,
                edgeId: targetEdgeId,
              },
            ],
          },
        },
      },
    ]);
    const snapshot = buildOccWorkspaceSnapshot(rebuilt);
    const invalidatedEdge = snapshot.document.references.find(
      (reference) =>
        reference.target.kind === "edge" &&
        reference.target.bodyId === baseBody.bodyId &&
        reference.target.edgeId === targetEdgeId &&
        reference.invalidation !== null,
    );

    expect(
      invalidatedEdge,
      "Phase 6 snapshot references must preserve invalidated durable topology targets.",
    ).toBeTruthy();
    expect(
      snapshot.document.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "occ-invalid-reference" &&
          diagnostic.detail?.kind === "invalidReference",
      ),
      "Phase 6 snapshot diagnostics must not surface historical invalidated references after a successful rebuild.",
    ).toBeFalsy();
  }

  async function testOccSnapshotSurfacesSketchNavigationAndHistory() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const { sketch } = createRectangleSketch(
      "sketch_phase6_history" as SketchId,
      plane,
    );
    const state = createOccAuthoringState(oc, {
      sketches: [sketch],
    });
    const snapshot = buildOccWorkspaceSnapshot(state);

    expect(
      snapshot.presentation.objects.some(
        (item) =>
          item.kind === "sketch" &&
          item.target.kind === "sketch" &&
          item.target.sketchId === sketch.sketchId,
      ),
      "OCC snapshot object navigation must include committed sketch rows.",
    ).toBeTruthy();
    expect(
      snapshot.presentation.documentHistory.some(
        (item) =>
          item.kind === "sketch" &&
          item.target.kind === "sketch" &&
          item.target.sketchId === sketch.sketchId,
      ),
      "OCC snapshot document history must include committed sketch items.",
    ).toBeTruthy();
  }

  async function testRegionRenderFailuresWarnAndSkipOnlyBadRegion() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const { sketch, region } = createRectangleSketch(
      "sketch_phase6_bad_region" as SketchId,
      plane,
    );
    sketch.sketch.solvedSnapshot = {
      ...sketch.sketch.solvedSnapshot,
      solvedEntities: [],
    };
    const state = createOccAuthoringState(oc, {
      sketches: [sketch],
    });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      const snapshot = buildOccWorkspaceSnapshot(state);
      expect(
        snapshot.document.render.records.some(
          (record) =>
            record.binding.semanticClass === "region" &&
            record.binding.target.kind === "region" &&
            record.binding.target.regionId === region.regionId,
        ),
        "Bad region profiles should be skipped from render export.",
      ).toBeFalsy();
    } finally {
      console.warn = originalWarn;
    }

    expect(
      warnings.some(
        (warning) =>
          warning.includes(String(region.regionId)) &&
          warning.includes("failed to build profile face"),
      ),
      "Skipped region profile render failures should be surfaced as console warnings.",
    ).toBeTruthy();
  }

  async function testProjectedRegionContractGapSkipsRegionRenderWithoutWarning() {
    const oc = await getDefaultOpenCascadeInstance();
    const plane = createStandardPlaneDefinition("xy");
    const sketchId = "sketch_phase6_projected_region_gap" as SketchId;
    const referenceId = "ref_phase6_projected_region_gap" as ReferenceId;
    const geometryId =
      "projected_geometry_phase6_projected_region_gap" as ProjectedGeometryId;
    const definition: SketchDefinition = {
      ...createSketchDefinition(sketchId, [], []),
      referenceIds: [referenceId],
      references: [
        {
          referenceId,
          kind: "constructionPlane",
          label: "Projected region source",
          source: {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
          projectionMode: "coplanar",
        },
      ],
    };
    const regionId = "region_phase6_projected_region_gap" as const;
    const region: RegionRecord = {
      ownerDocumentId: OCC_KERNEL_DOCUMENT_ID,
      ownerRevisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      regionId,
      label: regionId,
      target: { kind: "region", sketchId, regionId },
      sourceSketch: { kind: "sketch", sketchId },
      loops: [
        {
          loopId: "region_loop_phase6_projected_region_gap" as const,
          role: "outer",
          orientation: "counterClockwise",
          segments: [
            {
              source: {
                kind: "projectedGeometry",
                reference: {
                  kind: "projectedLineSegment",
                  referenceId,
                  geometryId,
                },
              },
              startPointId: null,
              endPointId: null,
            },
          ],
          boundaryPointIds: [],
          isClosed: true,
        },
      ],
      isClosed: true,
    };
    const state = createOccAuthoringState(oc, {
      sketches: [createSketchRecord(sketchId, plane, definition, [], [region])],
    });
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };
    try {
      const snapshot = buildOccWorkspaceSnapshot(state);
      expect(
        snapshot.document.render.records.some(
          (record) =>
            record.binding.semanticClass === "region" &&
            record.binding.target.kind === "region" &&
            record.binding.target.regionId === region.regionId,
        ),
        "Projected-region contract gaps should skip unsupported region render records.",
      ).toBeFalsy();
    } finally {
      console.warn = originalWarn;
    }

    expect(
      warnings.length,
      "Projected-region contract gaps should not be logged as snapshot render warnings.",
    ).toBe(0);
  }

  await testWorkspaceSnapshotBuildsContractValidRenderExport();
  await testSketchOwnedProfilesMarkConsumedSketchOwnership();
  await testPlanarFaceProfilesDoNotInventConsumedSketchOwnership();
  await testShellSnapshotEntitiesExposeContributorAncestry();
  await testConstructionSketchGeometryIsOmittedFromDocumentRenderExport();
  await testNestedSketchRegionsExportSeparateMeshes();
  await testJoinedExtrudeSnapshotDoesNotRenderInteriorBooleanTopology();
  await testWorkspaceSnapshotPreservesInvalidatedReferencesWithoutPromotingDiagnostics();
  await testOccSnapshotSurfacesSketchNavigationAndHistory();
  await testRegionRenderFailuresWarnAndSkipOnlyBadRegion();
  await testProjectedRegionContractGapSkipsRegionRenderWithoutWarning();

  console.log("OCC phase 6 snapshot/export tests passed.");
});
