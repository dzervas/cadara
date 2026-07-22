import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import type {
  ConstructionSnapshotRecord,
  FeatureDefinition,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type {
  ConstructionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import { PLANE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDefinition as AuthoredSketchDefinition,
  type SketchRecord,
} from "@/contracts/sketch/schema";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import type {
  OccNativeShimPayload,
  OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";
import {
  advanceTopologyToken,
  applySemanticStageTopologyIds,
  createBodySnapshotRecord,
  createInitialTopologyToken,
  createOccReferenceState,
  resolveOccReference,
  rewriteNativeTopologyPayloadIds,
  OCC_REFERENCE_INVALIDATION_REASONS,
  trackNewSolidBody,
  trackReplacementSolidBody,
} from "@/domain/modeling/occ/topology";
import {
  OCC_KERNEL_DOCUMENT_ID,
  OCC_KERNEL_INITIAL_REVISION_ID,
  createStandardPlaneDefinition,
} from "@/domain/modeling/opencascade-kernel-seed";
import { toGpPnt } from "@/domain/modeling/occ/planes";

test("src/domain/modeling/occ/topology.spec.ts", async () => {
  function pointId(name: string) {
    return `sketch_point_${name}` as SketchPointId;
  }

  function entityId(name: string) {
    return `sketch_entity_${name}` as SketchEntityId;
  }

  function createConstruction(
    constructionId: ConstructionId,
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

  function createSketchDefinition(
    sketchId: SketchId,
  ): AuthoredSketchDefinition {
    const bottomLeft = pointId(`${sketchId}_bottom_left`);
    const bottomRight = pointId(`${sketchId}_bottom_right`);
    const topRight = pointId(`${sketchId}_top_right`);
    const topLeft = pointId(`${sketchId}_top_left`);
    const bottom = entityId(`${sketchId}_bottom`);

    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: [bottomLeft, bottomRight, topRight, topLeft],
      points: [
        {
          pointId: bottomLeft,
          label: bottomLeft,
          target: { kind: "sketchPoint", sketchId, pointId: bottomLeft },
          position: [0, 0],
          isConstruction: false,
        },
        {
          pointId: bottomRight,
          label: bottomRight,
          target: { kind: "sketchPoint", sketchId, pointId: bottomRight },
          position: [4, 0],
          isConstruction: false,
        },
        {
          pointId: topRight,
          label: topRight,
          target: { kind: "sketchPoint", sketchId, pointId: topRight },
          position: [4, 2],
          isConstruction: false,
        },
        {
          pointId: topLeft,
          label: topLeft,
          target: { kind: "sketchPoint", sketchId, pointId: topLeft },
          position: [0, 2],
          isConstruction: false,
        },
      ],
      entityIds: [bottom],
      entities: [
        {
          kind: "lineSegment",
          entityId: bottom,
          label: bottom,
          target: { kind: "sketchEntity", sketchId, entityId: bottom },
          isConstruction: false,
          startPointId: bottomLeft,
          endPointId: bottomRight,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
  }

  function createSketchSnapshot(
    sketchId: SketchId,
    plane: SketchPlaneDefinition,
  ): SketchSnapshotRecord {
    const definition = createSketchDefinition(sketchId);
    const regionId = `region_${sketchId}_profile` as const;
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
      loops: [],
      isClosed: true,
    };
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
          constraintState: "underConstrained",
        },
        solvedEntities: [],
        solvedPoints: [],
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      regions: [region],
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
      planeTarget: plane.support,
      planeKey: plane.key,
      sketch,
    };
  }

  async function makeBoxBody(
    token: string,
    dimensions: readonly [number, number, number] = [10, 8, 6],
  ) {
    const oc = await loadCustomOpenCascadeForTopologyTest();
    const builder = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      dimensions[0],
      dimensions[1],
      dimensions[2],
    );
    builder.Build(new oc.Message_ProgressRange_1());
    expect(
      builder.IsDone(),
      "Expected OCC box builder to succeed in topology test.",
    ).toBeTruthy();

    let body = trackNewSolidBody(oc, {
      bodyId: "body_seed",
      label: "Seed Body",
      ownerFeatureId: "feature_seed",
      shape: builder.Shape(),
    });

    while (body.topologyToken !== token) {
      body = trackReplacementSolidBody(oc, {
        previous: body,
        ownerFeatureId: body.ownerFeatureId,
        shape: builder.Shape(),
      });
    }

    return body;
  }

  async function loadCustomOpenCascadeForTopologyTest() {
    const module = (await import("../../../../public/cadara-occ.js")) as {
      default: new (
        module: Record<string, unknown>,
      ) => Promise<OpenCascadeInstance & OpenCascadeNativeTopologyKernelHost>;
    };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );

    return new module.default({ wasmBinary });
  }

  async function testNewBodiesUseKernelOwnedNativeTopologyIds() {
    const oc = await loadCustomOpenCascadeForTopologyTest();
    const nativeBuildJson = (
      oc as {
        CadaraBuildNativeTopologyPayload?: {
          BuildJson?: unknown;
        };
      }
    ).CadaraBuildNativeTopologyPayload?.BuildJson;
    expect(
      typeof nativeBuildJson,
      "Default OCC build must expose native topology payloads for tracked solid identity.",
    ).toBe("function");

    const builder = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      10,
      8,
      6,
    );
    builder.Build(new oc.Message_ProgressRange_1());
    expect(
      builder.IsDone(),
      "Expected OCC box builder to succeed in native identity topology test.",
    ).toBeTruthy();

    const body = trackNewSolidBody(oc, {
      bodyId: "body_native_identity",
      label: "Native Identity Body",
      ownerFeatureId: "feature_native_identity",
      shape: builder.Shape(),
    });
    const tokenSegment = `_${body.topologyToken}_`;

    expect(
      body.topology.faceIds.every((faceId) => !faceId.includes(tokenSegment)),
      "New tracked bodies must not expose traversal-token face ids when native topology payloads are available.",
    ).toBeTruthy();
    expect(
      body.topology.edgeIds.every((edgeId) => !edgeId.includes(tokenSegment)),
      "New tracked bodies must not expose traversal-token edge ids when native topology payloads are available.",
    ).toBeTruthy();
    expect(
      body.topology.vertexIds.every(
        (vertexId) => !vertexId.includes(tokenSegment),
      ),
      "New tracked bodies must not expose traversal-token vertex ids when native topology payloads are available.",
    ).toBeTruthy();

    builder.delete?.();
  }

  async function testBodyCommitRequiresNativeTopologyPayloads() {
    const oc = await loadCustomOpenCascadeForTopologyTest();
    const nativeHost = oc as OpenCascadeNativeTopologyKernelHost;
    const originalBuildJson =
      nativeHost.CadaraBuildNativeTopologyPayload?.BuildJson;
    expect(
      typeof originalBuildJson,
      "Native topology fallback test requires the native build entrypoint.",
    ).toBe("function");
    const builder = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      10,
      8,
      6,
    );
    builder.Build(new oc.Message_ProgressRange_1());
    expect(
      builder.IsDone(),
      "Expected OCC box builder to succeed in native fallback topology test.",
    ).toBeTruthy();
    nativeHost.CadaraBuildNativeTopologyPayload!.BuildJson = undefined;

    try {
      trackNewSolidBody(oc, {
        bodyId: "body_native_required",
        label: "Native Required Body",
        ownerFeatureId: "feature_native_required",
        shape: builder.Shape(),
      });
      expect(
        false,
        "Committed body tracking must fail when the native topology payload entrypoint is missing.",
      ).toBeTruthy();
    } catch (error) {
      expect(
        error instanceof Error &&
          error.message.includes("required native topology payload support"),
        "Missing native topology support should fail at body commit time instead of falling back to TS enumeration.",
      ).toBeTruthy();
    } finally {
      nativeHost.CadaraBuildNativeTopologyPayload!.BuildJson =
        originalBuildJson;
      builder.delete?.();
    }
  }

  async function testBodyCommitRejectsNativePayloadErrorsAndDisambiguatesDuplicateIdentity() {
    const oc = await loadCustomOpenCascadeForTopologyTest();
    const nativeHost = oc as OpenCascadeNativeTopologyKernelHost;
    const originalBuildJson =
      nativeHost.CadaraBuildNativeTopologyPayload?.BuildJson;
    expect(
      typeof originalBuildJson,
      "Native payload release gate test requires the native build entrypoint.",
    ).toBe("function");
    const builder = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      10,
      8,
      6,
    );
    builder.Build(new oc.Message_ProgressRange_1());
    expect(
      builder.IsDone(),
      "Expected OCC box builder to succeed in native payload release gate test.",
    ).toBeTruthy();

    nativeHost.CadaraBuildNativeTopologyPayload!.BuildJson = (...args) => {
      const payload = JSON.parse(originalBuildJson(...args)) as {
        diagnostics: unknown[];
      };
      payload.diagnostics.push({
        code: "occ-native-topology-invalid-shape",
        severity: "error",
        message: "Injected native topology validation error.",
        target: { kind: "body", bodyId: "body_native_payload_error" },
        detail: { kind: "shapeValidation" },
      });

      return JSON.stringify(payload);
    };

    try {
      trackNewSolidBody(oc, {
        bodyId: "body_native_payload_error",
        label: "Native Payload Error Body",
        ownerFeatureId: "feature_native_payload_error",
        shape: builder.Shape(),
      });
      expect(
        false,
        "Committed body tracking must reject native topology payload error diagnostics.",
      ).toBeTruthy();
    } catch (error) {
      expect(
        error instanceof Error &&
          error.message.includes("Injected native topology validation error."),
        "Native topology payload error diagnostics should gate committed body state.",
      ).toBeTruthy();
    }

    nativeHost.CadaraBuildNativeTopologyPayload!.BuildJson = (...args) => {
      const payload = JSON.parse(originalBuildJson(...args)) as {
        topology: {
          kind: string;
          id: string;
          bodyId: string;
          kernelUid?: string;
        }[];
      };
      const firstFace = payload.topology.find(
        (record) => record.kind === "face",
      );
      const secondFace = payload.topology.find(
        (record) => record.kind === "face" && record.id !== firstFace?.id,
      );

      if (firstFace && secondFace) {
        secondFace.id = firstFace.id;
        secondFace.kernelUid = firstFace.kernelUid ?? firstFace.id;
      }

      return JSON.stringify(payload);
    };

    try {
      let rejectedIncompleteMesh = false;
      try {
        trackNewSolidBody(oc, {
          bodyId: "body_native_payload_duplicate",
          label: "Native Payload Duplicate Body",
          ownerFeatureId: "feature_native_payload_duplicate",
          shape: builder.Shape(),
        });
      } catch (error) {
        rejectedIncompleteMesh =
          error instanceof Error &&
          error.message.includes("omitted render triangles for non-degenerate face");
      }
      expect(
        rejectedIncompleteMesh,
        "Ambiguous native topology that cannot bind every face to render triangles must be rejected.",
      ).toBe(true);
    } finally {
      nativeHost.CadaraBuildNativeTopologyPayload!.BuildJson =
        originalBuildJson;
      builder.delete?.();
    }
  }

  function testTopologyTokensAdvanceForReplacementBodies() {
    const initial = createInitialTopologyToken();
    const next = advanceTopologyToken(initial);

    expect(
      initial,
      "Initial topology token must start at t0001 for the first body state.",
    ).toBe("t0001");
    expect(
      next,
      "Topology token advancement must produce a stable incremented token.",
    ).toBe("t0002");
  }

  async function testBodySnapshotsAndReferenceStateExposeLiveTopology() {
    const body = await makeBoxBody(createInitialTopologyToken());
    const xyPlane = createStandardPlaneDefinition("xy");
    const sketch = createSketchSnapshot("sketch_topology", xyPlane);
    const feature: {
      featureId: `feature_${string}`;
      definition: FeatureDefinition;
    } = {
      featureId: "feature_probe",
      definition: {
        kind: "plane",
        featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
        parameters: {
          mode: "coplanar",
          reference: {
            target: {
              kind: "construction",
              constructionId: (xyPlane.support.kind === "construction"
                ? xyPlane.support.constructionId
                : "construction_plane-xy") as ConstructionId,
            },
          },
        },
      },
    };
    const referenceState = createOccReferenceState({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      bodies: [body],
      constructions: [createConstruction("construction_plane-xy")],
      sketches: [sketch],
      features: [feature],
    });
    const snapshot = createBodySnapshotRecord(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      },
      body,
    );
    const faceId = body.topology.faceIds[0];
    const edgeId = body.topology.edgeIds[0];
    const point = sketch.sketch.definition.points[0];
    const entity = sketch.sketch.definition.entities[0];
    const region = sketch.sketch.regions[0];

    expect(
      snapshot.topology.faceIds[0],
      "Body snapshot must preserve committed native face ids.",
    ).toBe(faceId);
    expect(
      snapshot.topology.edgeIds[0],
      "Body snapshot must preserve committed native edge ids.",
    ).toBe(edgeId);
    expect(
      faceId.includes("_t0001_"),
      "Face ids must not fall back to topology-token traversal ids.",
    ).toBeFalsy();
    expect(
      edgeId.includes("_t0001_"),
      "Edge ids must not fall back to topology-token traversal ids.",
    ).toBeFalsy();

    const liveFaceResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
        referenceState,
      },
      { kind: "face", bodyId: body.bodyId, faceId },
    );

    expect(
      liveFaceResolution.resolution.invalidation,
      "Live topology references must resolve without invalidation.",
    ).toBe(null);
    expect(
      liveFaceResolution.resolution.ownerBodyId,
      "Live topology references must retain owning body metadata.",
    ).toBe(body.bodyId);

    const liveSketchPointResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
        referenceState,
      },
      {
        kind: "sketchPoint",
        sketchId: sketch.sketchId,
        pointId: point.pointId,
      },
    );

    expect(
      liveSketchPointResolution.resolution.invalidation,
      "Live sketch points must resolve without invalidation.",
    ).toBe(null);
    expect(
      liveSketchPointResolution.resolution.ownerSketchId,
      "Live sketch-point references must retain owning sketch metadata.",
    ).toBe(sketch.sketchId);

    const liveSketchEntityResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
        referenceState,
      },
      {
        kind: "sketchEntity",
        sketchId: sketch.sketchId,
        entityId: entity.entityId,
      },
    );

    expect(
      liveSketchEntityResolution.resolution.invalidation,
      "Live sketch entities must resolve without invalidation.",
    ).toBe(null);

    const liveRegionResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
        referenceState,
      },
      { kind: "region", sketchId: sketch.sketchId, regionId: region.regionId },
    );

    expect(
      liveRegionResolution.resolution.invalidation,
      "Live region references must resolve without invalidation.",
    ).toBe(null);

    const liveFeatureResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
        referenceState,
      },
      { kind: "feature", featureId: feature.featureId },
    );

    expect(
      liveFeatureResolution.resolution.invalidation,
      "Live feature references must resolve without invalidation.",
    ).toBe(null);
  }

  async function testMissingTopologyReferencesInvalidateAgainstPriorState() {
    const original = await makeBoxBody(createInitialTopologyToken());
    const replaced = await makeBoxBody(
      advanceTopologyToken(original.topologyToken),
      [12, 8, 6],
    );
    const staleFaceId =
      original.topology.faceIds.find(
        (faceId) => !replaced.topology.faceIds.includes(faceId),
      ) ?? original.topology.faceIds[0];
    const staleEdgeId =
      original.topology.edgeIds.find(
        (edgeId) => !replaced.topology.edgeIds.includes(edgeId),
      ) ?? original.topology.edgeIds[0];
    const staleVertexId =
      original.topology.vertexIds.find(
        (vertexId) => !replaced.topology.vertexIds.includes(vertexId),
      ) ?? original.topology.vertexIds[0];
    const previous = createOccReferenceState({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: OCC_KERNEL_INITIAL_REVISION_ID,
      bodies: [original],
      constructions: [createConstruction("construction_plane-xy")],
      sketches: [],
      features: [],
    });
    const nextRevisionId = "rev_0002" as const;
    const current = createOccReferenceState({
      documentId: OCC_KERNEL_DOCUMENT_ID,
      revisionId: nextRevisionId,
      bodies: [replaced],
      constructions: [createConstruction("construction_plane-xy")],
      sketches: [],
      features: [],
      previous,
      historyInvalidations: new Map([
        [
          `face:${original.bodyId}:${staleFaceId}`,
          {
            target: {
              kind: "face",
              bodyId: original.bodyId,
              faceId: staleFaceId,
            },
            reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyModified,
            sourceTarget: { kind: "body", bodyId: original.bodyId },
          },
        ],
        [
          `edge:${original.bodyId}:${staleEdgeId}`,
          {
            target: {
              kind: "edge",
              bodyId: original.bodyId,
              edgeId: staleEdgeId,
            },
            reason: OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted,
            sourceTarget: { kind: "body", bodyId: original.bodyId },
          },
        ],
      ]),
    });

    const missingFaceResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: nextRevisionId,
        referenceState: current,
      },
      { kind: "face", bodyId: original.bodyId, faceId: staleFaceId },
    );

    expect(
      missingFaceResolution.resolution.invalidation?.reason,
      "Modified topology references must preserve the history-driven invalidation reason.",
    ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyModified);
    expect(
      missingFaceResolution.resolution.invalidation?.sourceTarget?.kind,
      "Missing topology references must point back to the owning body as the invalidation source.",
    ).toBe("body");
    expect(
      missingFaceResolution.resolution.ownerRevisionId,
      "Invalidated references must be restamped to the revision that observed the invalidation.",
    ).toBe(nextRevisionId);
    expect(
      missingFaceResolution.diagnostics[0]?.detail?.kind,
      "Missing topology references must surface a structured invalidReference diagnostic.",
    ).toBe("invalidReference");

    const missingEdgeResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: nextRevisionId,
        referenceState: current,
      },
      { kind: "edge", bodyId: original.bodyId, edgeId: staleEdgeId },
    );

    expect(
      missingEdgeResolution.resolution.invalidation?.reason,
      "Deleted edge references must preserve the history-driven invalidation reason.",
    ).toBe(OCC_REFERENCE_INVALIDATION_REASONS.topologyDeleted);

    const missingVertexResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: nextRevisionId,
        referenceState: current,
      },
      { kind: "vertex", bodyId: original.bodyId, vertexId: staleVertexId },
    );

    expect(
      missingVertexResolution.resolution.invalidation?.sourceTarget?.kind,
      "Missing vertex references must point back to the owning body as the invalidation source.",
    ).toBe("body");

    const neverExistedResolution = resolveOccReference(
      {
        documentId: OCC_KERNEL_DOCUMENT_ID,
        revisionId: nextRevisionId,
        referenceState: current,
      },
      {
        kind: "face",
        bodyId: original.bodyId,
        faceId: "face_body_seed_t9999_1",
      },
    );

    expect(
      neverExistedResolution.resolution.invalidation?.sourceTarget,
      "Never-seen references must not fabricate an owning source target.",
    ).toBe(null);
  }

  async function testSemanticReconciliationPreservesNativeAliasesAndPayload() {
    const body = await makeBoxBody("t0001");
    const faceId = body.topology.faceIds[0]!;
    const edgeId = body.topology.edgeIds[0]!;
    const vertexId = body.topology.vertexIds[0]!;
    const preservedFaceId = "face_preserved_semantic" as typeof faceId;
    const preservedEdgeId = "edge_preserved_semantic" as typeof edgeId;
    const preservedVertexId = "vertex_preserved_semantic" as typeof vertexId;
    const current = {
      ...body,
      nativeTopologyIdAliases: {
        faceIdsByNativeId: new Map([["face_native_raw" as typeof faceId, faceId]]),
        edgeIdsByNativeId: new Map([
          ["edge_native_raw" as typeof edgeId, edgeId],
          [
            "edge_native_stale" as typeof edgeId,
            "edge_deleted_public" as typeof edgeId,
          ],
        ]),
        vertexIdsByNativeId: new Map([
          ["vertex_native_raw" as typeof vertexId, vertexId],
        ]),
      },
    };
    const preservedTargetsByCurrentKey = new Map([
      [
        `face:${body.bodyId}:${faceId}`,
        { kind: "face" as const, bodyId: body.bodyId, faceId: preservedFaceId },
      ],
      [
        `edge:${body.bodyId}:${edgeId}`,
        { kind: "edge" as const, bodyId: body.bodyId, edgeId: preservedEdgeId },
      ],
      [
        `vertex:${body.bodyId}:${vertexId}`,
        {
          kind: "vertex" as const,
          bodyId: body.bodyId,
          vertexId: preservedVertexId,
        },
      ],
    ]);

    const reconciled = applySemanticStageTopologyIds({
      previous: body,
      current,
      preservedTargetsByCurrentKey,
    }).body;

    expect(reconciled.nativeTopologyPayload).toBeTruthy();
    expect(reconciled.nativeTopologyIdAliases?.faceIdsByNativeId.get(
      "face_native_raw" as typeof faceId,
    )).toBe(preservedFaceId);
    expect(reconciled.nativeTopologyIdAliases?.edgeIdsByNativeId?.get(
      "edge_native_raw" as typeof edgeId,
    )).toBe(preservedEdgeId);
    expect(reconciled.nativeTopologyIdAliases?.vertexIdsByNativeId?.get(
      "vertex_native_raw" as typeof vertexId,
    )).toBe(preservedVertexId);
    expect(
      reconciled.nativeTopologyIdAliases?.edgeIdsByNativeId?.has(
        "edge_native_stale" as typeof edgeId,
      ),
      "Deleted public topology must not remain selectable through a stale native alias.",
    ).toBe(false);
    expect(
      reconciled.nativeTopologyPayload!.topology.some(
        (record) => record.kind === "face" && record.id === preservedFaceId,
      ),
    ).toBeTruthy();

    const referenceInput = {
      documentId: "doc_workspace" as never,
      constructions: [],
      sketches: [],
      features: [],
    };
    const liveState = createOccReferenceState({
      ...referenceInput,
      revisionId: "rev_0001" as never,
      bodies: [reconciled],
    });
    const missingState = createOccReferenceState({
      ...referenceInput,
      revisionId: "rev_0002" as never,
      bodies: [],
      previous: liveState,
    });
    const restoredState = createOccReferenceState({
      ...referenceInput,
      revisionId: "rev_0003" as never,
      bodies: [reconciled],
      previous: missingState,
    });
    expect(
      resolveOccReference(
        {
          documentId: referenceInput.documentId,
          revisionId: "rev_0003" as never,
          referenceState: restoredState,
        },
        {
          kind: "edge",
          bodyId: body.bodyId,
          edgeId: preservedEdgeId,
        },
      ).resolution.invalidation,
      "An exact native alias to a tracked edge proves that the public reference is live again.",
    ).toBe(null);

    const colliding = {
      ...current,
      nativeTopologyIdAliases: {
        faceIdsByNativeId: new Map([
          ["face_native_raw_a" as typeof faceId, faceId],
          ["face_native_raw_b" as typeof faceId, faceId],
        ]),
      },
    };
    expect(() =>
      applySemanticStageTopologyIds({
        previous: body,
        current: colliding,
        preservedTargetsByCurrentKey,
      }),
    ).toThrow(/Native topology alias collision/);
  }

  await testTopologyTokensAdvanceForReplacementBodies();
  await testNewBodiesUseKernelOwnedNativeTopologyIds();
  await testBodyCommitRequiresNativeTopologyPayloads();
  await testBodyCommitRejectsNativePayloadErrorsAndDisambiguatesDuplicateIdentity();
  await testBodySnapshotsAndReferenceStateExposeLiveTopology();
  await testMissingTopologyReferencesInvalidateAgainstPriorState();
  await testSemanticReconciliationPreservesNativeAliasesAndPayload();

  console.log("OCC phase 5 topology/reference tests passed.");
});

test("exact B-rep topology keys use reconciled public aliases", () => {
  const bodyId = "body_alias" as never;
  const payload = {
    schemaVersion: "occ-native-topology-payload/v1alpha1",
    source: "occt7-shim",
    bodyId,
    topology: [
      { id: "face_native", kind: "face", bodyId, index: 1 },
      { id: "edge_native", kind: "edge", bodyId, index: 1 },
      { id: "vertex_native", kind: "vertex", bodyId, index: 1 },
    ],
    edgeVertices: [{ edgeId: "edge_native", start: [0, 0, 0], end: [1, 0, 0] }],
    vertexPoints: [{ vertexId: "vertex_native", point: [0, 0, 0] }],
    faceEdges: [{ faceId: "face_native", edgeIds: ["edge_native"] }],
    cadaraBrep: {
      kind: "cadaraBrep",
      schemaVersion: "cadara-brep/v1alpha1",
      source: { importedFormat: "step", sourceStored: false },
      bodies: [{
        bodyKey: bodyId,
        label: "Alias body",
        topology: {
          vertices: [{ vertexKey: "vertex_native", point: [0, 0, 0] }],
          edges: [{
            edgeKey: "edge_native",
            vertices: [0, 0],
            curve: {
              kind: "line",
              origin: [0, 0, 0],
              direction: [1, 0, 0],
              parameterRange: [0, 1],
            },
          }],
          coedges: [],
          loops: [],
          faces: [{
            faceKey: "face_native",
            loopIndices: [],
            surface: { kind: "unsupported", typeName: "fixture" },
            meshVertices: [],
            triangles: [],
          }],
          shells: [],
          solids: [],
        },
      }],
    },
    diagnostics: [],
  } as unknown as OccNativeShimPayload;

  const rewritten = rewriteNativeTopologyPayloadIds(bodyId, payload, {
    faceIdsByNativeId: new Map([["face_native" as never, "face_public" as never]]),
    edgeIdsByNativeId: new Map([["edge_native" as never, "edge_public" as never]]),
    vertexIdsByNativeId: new Map([["vertex_native" as never, "vertex_public" as never]]),
  });

  expect(rewritten.topology.map((record) => record.id)).toEqual([
    "face_public",
    "edge_public",
    "vertex_public",
  ]);
  expect(rewritten.cadaraBrep?.bodies[0]?.topology.faces[0]?.faceKey).toBe("face_public");
  expect(rewritten.cadaraBrep?.bodies[0]?.topology.edges[0]?.edgeKey).toBe("edge_public");
  expect(rewritten.cadaraBrep?.bodies[0]?.topology.vertices[0]?.vertexKey).toBe("vertex_public");
});
