import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import type {
  BodyId,
  FaceId,
  FeatureId,
  RevisionId,
} from "@/contracts/shared/ids";
import { buildOccWorkspaceSnapshot } from "@/domain/modeling/occ/snapshot";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import {
  releaseBuiltSketchProfileFace,
  type BuiltSketchProfileFace,
} from "@/domain/modeling/occ/sketch-profile";
import {
  collectOccCleanupErrors,
  OccCleanupError,
} from "@/domain/modeling/occ/memory";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import { trackNewSolidBody } from "@/domain/modeling/occ/topology";
import {
  createOccNativeTopologyPayloadFromShimPayloads,
  parseNativeShimPayloadJson,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/domain/modeling/occ/native-topology-payload";

type CustomOpenCascadeForTest = OpenCascadeInstance &
  OpenCascadeNativeTopologyKernelHost;

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<CustomOpenCascadeForTest>;

type SnapshotTemporaryWrapper = {
  delete(): void;
  isDeleted?(): boolean;
};

/**
 * Records snapshot-local OCC temporaries by resource class at their real
 * constructor/value-return points, plus every borrowed `Handle.get()` alias.
 * Production deletion stays active; deletes are counted and can fail once.
 */
function makeSnapshotTemporaryTracker(oc: CustomOpenCascadeForTest) {
  type AnyFunction = (...args: unknown[]) => unknown;
  type Patchable = Record<string, unknown>;
  const module = oc as unknown as Patchable;
  const created = new Map<string, Set<SnapshotTemporaryWrapper>>();
  const deleteAttempts = new Map<SnapshotTemporaryWrapper, number>();
  const armedFailures = new Map<string, Error>();
  const failingWrappers = new Map<SnapshotTemporaryWrapper, Error>();
  const borrowedOwners = new Map<object, SnapshotTemporaryWrapper>();
  let borrowedDeletes = 0;
  let borrowedReadsAfterOwnerDelete = 0;
  let recording = false;
  const restorers: Array<() => void> = [];

  const record = (kind: string, value: unknown) => {
    if (!recording || typeof value !== "object" || value === null) {
      return value;
    }
    const wrapper = value as SnapshotTemporaryWrapper;
    const wrappers = created.get(kind) ?? new Set();
    created.set(kind, wrappers);
    wrappers.add(wrapper);
    const armed = armedFailures.get(kind);
    if (armed) {
      armedFailures.delete(kind);
      failingWrappers.set(wrapper, armed);
    }
    const nativeDelete = wrapper.delete.bind(wrapper);
    deleteAttempts.set(wrapper, 0);
    wrapper.delete = () => {
      const attempts = (deleteAttempts.get(wrapper) ?? 0) + 1;
      deleteAttempts.set(wrapper, attempts);
      const failure = failingWrappers.get(wrapper);
      if (failure && attempts === 1) throw failure;
      nativeDelete();
    };
    return wrapper;
  };
  const patch = (
    owner: Patchable,
    name: string,
    wrap: (original: AnyFunction) => AnyFunction,
  ) => {
    const original = owner[name];
    if (typeof original !== "function") {
      throw new Error(`Expected OCC binding ${name}.`);
    }
    owner[name] = wrap(original as AnyFunction);
    restorers.push(() => {
      owner[name] = original;
    });
  };
  const prototypeOf = (className: string) =>
    (module[className] as { prototype: Patchable }).prototype;
  const trackResult = (owner: Patchable, name: string, kind: string) =>
    patch(
      owner,
      name,
      (original) =>
        function (this: unknown, ...args: unknown[]) {
          return record(kind, original.apply(this, args));
        },
    );
  const trackConstructor = (name: string, kind: string) => {
    const original = module[name] as new (...args: unknown[]) => object;
    module[name] = new Proxy(original, {
      construct: (target, args) =>
        record(kind, Reflect.construct(target, args)) as object,
    });
    restorers.push(() => {
      module[name] = original;
    });
  };

  trackConstructor("TopLoc_Location_1", "TopLoc_Location");
  trackConstructor("BRepAdaptor_Surface_2", "BRepAdaptor_Surface");
  trackConstructor("BRepAdaptor_Curve_2", "BRepAdaptor_Curve");
  trackConstructor(
    "TopTools_IndexedMapOfShape_1",
    "TopTools_IndexedMapOfShape",
  );
  const brepTool = module.BRep_Tool as Patchable;
  trackResult(brepTool, "Triangulation", "Handle_Poly_Triangulation");
  trackResult(
    brepTool,
    "PolygonOnTriangulation_1",
    "Handle_Poly_PolygonOnTriangulation",
  );
  trackResult(brepTool, "Polygon3D", "Handle_Poly_Polygon3D");
  trackResult(brepTool, "Pnt", "gp_Pnt(vertex)");
  trackResult(module.TopoDS as Patchable, "Face_1", "TopoDS_Face(Face_1)");
  trackResult(
    prototypeOf("TopTools_IndexedMapOfShape"),
    "FindKey",
    "TopoDS_Shape(FindKey)",
  );
  trackResult(prototypeOf("TopLoc_Location"), "Transformation", "gp_Trsf");
  trackResult(prototypeOf("Poly_Triangulation"), "Node", "gp_Pnt(node)");
  trackResult(prototypeOf("Poly_Triangulation"), "Normal_1", "gp_Dir(normal)");
  trackResult(prototypeOf("Poly_Triangulation"), "Triangle", "Poly_Triangle");
  trackResult(prototypeOf("gp_Pnt"), "Transformed", "gp_Pnt(transformed)");
  trackResult(prototypeOf("gp_Dir"), "Transformed", "gp_Dir(transformed)");
  trackResult(prototypeOf("BRepAdaptor_Surface"), "Plane", "gp_Pln");
  trackResult(prototypeOf("gp_Pln"), "Position", "gp_Ax3");
  for (const name of ["Location", "XDirection", "YDirection", "Direction"]) {
    trackResult(prototypeOf("gp_Ax3"), name, "gp_Ax3 component");
  }
  trackResult(prototypeOf("BRepAdaptor_Curve"), "Value", "gp_Pnt(curve)");
  trackResult(prototypeOf("Poly_Polygon3D"), "Nodes", "TColgp_Array1OfPnt");
  trackResult(prototypeOf("TColgp_Array1OfPnt"), "Value", "gp_Pnt(polygon)");

  for (const handleClass of [
    "Handle_Poly_Triangulation",
    "Handle_Poly_PolygonOnTriangulation",
    "Handle_Poly_Polygon3D",
  ]) {
    patch(
      prototypeOf(handleClass),
      "get",
      (original) =>
        function (this: SnapshotTemporaryWrapper, ...args: unknown[]) {
          const alias = original.apply(this, args) as SnapshotTemporaryWrapper;
          if (recording) {
            borrowedOwners.set(alias, this);
            const nativeDelete = alias.delete.bind(alias);
            alias.delete = () => {
              borrowedDeletes += 1;
              nativeDelete();
            };
          }
          return alias;
        },
    );
  }
  const guardBorrowedReads = (className: string, names: readonly string[]) => {
    for (const name of names) {
      patch(
        prototypeOf(className),
        name,
        (original) =>
          function (this: object, ...args: unknown[]) {
            if (borrowedOwners.get(this)?.isDeleted?.()) {
              borrowedReadsAfterOwnerDelete += 1;
            }
            return original.apply(this, args);
          },
      );
    }
  };
  guardBorrowedReads("Poly_Triangulation", [
    "NbNodes",
    "NbTriangles",
    "HasNormals",
    "Node",
    "Normal_1",
    "Triangle",
  ]);
  guardBorrowedReads("Poly_PolygonOnTriangulation", ["NbNodes", "Node"]);
  guardBorrowedReads("Poly_Polygon3D", ["NbNodes", "Nodes"]);

  const isLive = (wrapper: SnapshotTemporaryWrapper) => !wrapper.isDeleted?.();
  return {
    async record<T>(read: () => T | Promise<T>): Promise<T> {
      recording = true;
      try {
        return await read();
      } finally {
        recording = false;
      }
    },
    /** Makes the first delete of the next recorded wrapper of `kind` throw. */
    failFirstDeleteOfNext(kind: string, error: Error) {
      armedFailures.set(kind, error);
    },
    wrappers: (kind: string) => [...(created.get(kind) ?? [])],
    deleteAttempts: (wrapper: SnapshotTemporaryWrapper) =>
      deleteAttempts.get(wrapper) ?? 0,
    failingWrappers: () => [...failingWrappers.keys()],
    /** Per resource class: created and still-live wrapper counts. */
    classes() {
      return Object.fromEntries(
        [...created]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([kind, wrappers]) => [
            kind,
            {
              created: wrappers.size,
              live: [...wrappers].filter(isLive).length,
            },
          ]),
      );
    },
    borrowed: () => ({
      aliases: borrowedOwners.size,
      deletes: borrowedDeletes,
      readsAfterOwnerDelete: borrowedReadsAfterOwnerDelete,
    }),
    clear() {
      created.clear();
      deleteAttempts.clear();
      armedFailures.clear();
      failingWrappers.clear();
      borrowedOwners.clear();
      borrowedDeletes = 0;
      borrowedReadsAfterOwnerDelete = 0;
    },
    releaseLeftovers() {
      failingWrappers.clear();
      for (const wrappers of created.values()) {
        for (const wrapper of wrappers) {
          if (isLive(wrapper)) wrapper.delete();
        }
      }
    },
    restore() {
      for (const restore of restorers.reverse()) restore();
      restorers.length = 0;
    },
  };
}

function allReleased(
  classes: Record<string, { created: number; live: number }>,
) {
  return Object.fromEntries(
    Object.entries(classes).map(([kind, { created }]) => [
      kind,
      { created, live: 0 },
    ]),
  );
}

test("src/domain/modeling/occ/snapshot-native-render.spec.ts", async () => {
  async function loadCustomOpenCascadeForTest() {
    const module = (await import("../../../../public/cadara-occ.js")) as {
      default: CustomOpenCascadeMainJSForTest;
    };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );

    return new module.default({ wasmBinary });
  }

  /** Real adapter whose document holds the mock seed sketch (one region). */
  async function createAdapterWithCommittedSketch(
    oc: CustomOpenCascadeForTest,
  ) {
    const createSolver = (revisionId: RevisionId | null) =>
      new SketchConstraintSolverAdapter({ revisionId });
    const adapter = new OpenCascadeKernelAdapter({
      solverAdapter: createSolver(null),
      solverAdapterFactory: createSolver,
      getOpenCascadeInstance: async () => oc,
    });
    const seed = await new MockKernelAdapter().getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const sourceSketch = seed.snapshot.document.sketches[0];
    if (!sourceSketch) throw new Error("Mock seed did not contain a sketch.");

    const empty = await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    });
    const committed = await adapter.commitSketch({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
      baseRevisionId: empty.snapshot.document.revisionId,
      solverCorrelation: {
        requestId: "request_snapshot_ownership",
        projectionRequestId: "request_snapshot_ownership:project",
        validationRequestId: "request_snapshot_ownership:validate",
        solveRequestId: "request_snapshot_ownership:solve",
        regionRequestId: "request_snapshot_ownership:regions",
      },
      sketchId: sourceSketch.sketchId,
      restoreRecordedSketchId: true,
      sketchLabel: sourceSketch.label,
      plane: sourceSketch.plane,
      definition: sourceSketch.sketch.definition,
    });
    expect(committed.revisionState.kind).toBe("accepted");
    return { adapter, committed };
  }

  async function testBodyRenderExportConsumesNativeMeshPayload() {
    const oc = await loadCustomOpenCascadeForTest();
    const builder = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      1,
      2,
      3,
    );
    builder.Build(new oc.Message_ProgressRange_1());
    expect(
      builder.IsDone(),
      "Expected OCC box builder to produce a native render test body.",
    ).toBeTruthy();

    const body = trackNewSolidBody(oc, {
      bodyId: "body_native_render_mesh" as BodyId,
      label: "Native render mesh body",
      ownerFeatureId: "feature_native_render_mesh" as FeatureId,
      shape: builder.Shape(),
    });
    const nativeJson = oc.CadaraBuildNativeTopologyPayload?.BuildJson?.(
      body.shape,
      body.bodyId,
      body.topologyToken,
      0.1,
      0.5,
    );

    expect(
      typeof nativeJson,
      "Custom OCC build should expose native topology payload JSON.",
    ).toBe("string");

    const state = createOccAuthoringState(oc, { bodies: [body] });
    const nativeTopologyPayload =
      createOccNativeTopologyPayloadFromShimPayloads({
        revisionId: state.revisionId,
        lodTierId: "fine",
        bodies: [
          {
            bodyId: body.bodyId,
            nativePayload: parseNativeShimPayloadJson(nativeJson),
          },
        ],
      });
    const originalTriangulation = oc.BRep_Tool.Triangulation;
    let triangulationCallCount = 0;

    oc.BRep_Tool.Triangulation = (() => {
      triangulationCallCount += 1;
      throw new Error(
        "Body render export must use the native mesh payload, not JS face triangulation.",
      );
    }) as typeof originalTriangulation;

    try {
      const snapshot = buildOccWorkspaceSnapshot(state, [], {
        nativeTopologyPayload,
      });
      const faceMeshRecords = snapshot.document.render.records.filter(
        (record) =>
          record.ownerBodyId === body.bodyId &&
          record.binding.topology === "face" &&
          record.geometry.kind === "mesh",
      );
      const triangleCount = faceMeshRecords.reduce(
        (total, record) =>
          total +
          (record.geometry.kind === "mesh"
            ? record.geometry.triangleIndices.length
            : 0),
        0,
      );

      expect(
        triangulationCallCount,
        "Native body render export must not call the JS BRep_Tool.Triangulation binding.",
      ).toBe(0);
      expect(
        faceMeshRecords.length,
        "Native body render export should produce one mesh record per box face.",
      ).toBe(6);
      expect(
        triangleCount,
        "Native body render export should preserve all twelve box render triangles.",
      ).toBe(12);
    } finally {
      oc.BRep_Tool.Triangulation = originalTriangulation;
      builder.delete?.();
    }
  }

  async function testNativeRenderMapsMeshBindingsThroughPreservedDurableFaceIds() {
    const oc = await loadCustomOpenCascadeForTest();
    const builder = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      1,
      2,
      3,
    );
    builder.Build(new oc.Message_ProgressRange_1());
    expect(
      builder.IsDone(),
      "Expected OCC box builder to produce a native render alias test body.",
    ).toBeTruthy();

    const body = trackNewSolidBody(oc, {
      bodyId: "body_native_render_alias" as BodyId,
      label: "Native render alias body",
      ownerFeatureId: "feature_native_render_alias" as FeatureId,
      shape: builder.Shape(),
    });
    const nativeTopologyToken = "t0002";
    const nativeJson = oc.CadaraBuildNativeTopologyPayload?.BuildJson?.(
      body.shape,
      body.bodyId,
      nativeTopologyToken,
      0.1,
      0.5,
    );

    expect(
      typeof nativeJson,
      "Custom OCC build should expose native topology payload JSON.",
    ).toBe("string");

    const nativePayload = parseNativeShimPayloadJson(nativeJson);
    const nativeFaceIds = nativePayload.topology
      .filter((record) => record.kind === "face")
      .map((record) => record.id as FaceId);
    const durableFaceIdsByNativeId = new Map<FaceId, FaceId>(
      nativeFaceIds.map((nativeFaceId, index) => [
        nativeFaceId,
        body.topology.faceIds[index] ?? nativeFaceId,
      ]),
    );
    const aliasedBody = {
      ...body,
      nativeTopologyIdAliases: {
        faceIdsByNativeId: durableFaceIdsByNativeId,
      },
    };
    const state = createOccAuthoringState(oc, { bodies: [aliasedBody] });
    const nativeTopologyPayload =
      createOccNativeTopologyPayloadFromShimPayloads({
        revisionId: state.revisionId,
        lodTierId: "fine",
        bodies: [
          {
            bodyId: body.bodyId,
            nativePayload,
          },
        ],
      });
    const snapshot = buildOccWorkspaceSnapshot(state, [], {
      nativeTopologyPayload,
    });
    const faceMeshRecords = snapshot.document.render.records.filter(
      (record) =>
        record.ownerBodyId === body.bodyId &&
        record.binding.topology === "face" &&
        record.geometry.kind === "mesh",
    );
    const triangleCount = faceMeshRecords.reduce(
      (total, record) =>
        total +
        (record.geometry.kind === "mesh"
          ? record.geometry.triangleIndices.length
          : 0),
      0,
    );

    expect(
      faceMeshRecords.length,
      "Native render export should keep preserved durable face ids visible when mesh bindings use fresh native ids.",
    ).toBe(6);
    expect(
      triangleCount,
      "Native render export should not drop triangles whose native face binding aliases to a preserved durable face id.",
    ).toBe(12);

    builder.delete?.();
  }

  function testProfileResultReleaseDeduplicatesAndRetriesFailedOwners() {
    let sharedDeleteCount = 0;
    let failedDeleteCount = 0;
    let failedDeleted = false;
    let borrowedDeleteCount = 0;
    const shared = {
      delete: () => {
        sharedDeleteCount += 1;
      },
      isDeleted: () => sharedDeleteCount > 0,
    };
    const failsOnce = {
      delete: () => {
        failedDeleteCount += 1;
        if (failedDeleteCount === 1)
          throw new Error("injected cleanup failure");
        failedDeleted = true;
      },
      isDeleted: () => failedDeleted,
    };
    const borrowed = {
      delete: () => {
        borrowedDeleteCount += 1;
      },
    };
    const result = {
      face: shared,
      provenance: {
        edges: new Map([
          ["edge-a", shared],
          ["edge-b", failsOnce],
        ]),
        vertices: new Map([
          ["vertex-a", shared],
          ["vertex-b", failsOnce],
        ]),
        unsupportedSources: [],
      },
    } as unknown as BuiltSketchProfileFace;

    let cleanupError: unknown;
    try {
      releaseBuiltSketchProfileFace(result);
    } catch (error) {
      cleanupError = error;
    }

    expect(cleanupError).toBeInstanceOf(OccCleanupError);
    expect(
      sharedDeleteCount,
      "Aliased owners must be deleted exactly once.",
    ).toBe(1);
    expect(failedDeleteCount, "Failed cleanup must be attempted once.").toBe(1);
    expect(
      borrowedDeleteCount,
      "Wrappers outside the successful result ownership graph must remain live.",
    ).toBe(0);

    (cleanupError as OccCleanupError).retry();
    (cleanupError as OccCleanupError).retry();
    expect(
      sharedDeleteCount,
      "Successful owners must not be deleted again during retry.",
    ).toBe(1);
    expect(
      failedDeleteCount,
      "Only the failed owner must be retried, then deleted exactly once.",
    ).toBe(2);
    expect(borrowedDeleteCount).toBe(0);
    void borrowed;
  }

  async function testRepeatedServiceSnapshotsReleaseRegionProfileOwnership() {
    type OccWrapper = {
      delete(): void;
      isDeleted?(): boolean;
    };
    type WrapperKind = "face" | "edge" | "vertex";

    const oc = await loadCustomOpenCascadeForTest();
    const wrappers: Record<WrapperKind, Set<OccWrapper>> = {
      face: new Set(),
      edge: new Set(),
      vertex: new Set(),
    };
    let recording = false;
    let failNextRecordedEdgeDelete = false;
    let failedEdge: OccWrapper | null = null;
    const deleteAttempts = new Map<OccWrapper, number>();
    const injectedCleanupError = new Error(
      "injected native edge cleanup failure",
    );
    const restorers: Array<() => void> = [];
    const patchFactoryResult = (
      prototype: Record<string, unknown>,
      methodName: string,
      kind: WrapperKind,
    ) => {
      const original = prototype[methodName];
      if (typeof original !== "function") {
        throw new Error(`Expected ${methodName} on OCC factory prototype.`);
      }
      prototype[methodName] = function (...args: unknown[]) {
        const wrapper = original.apply(this, args) as OccWrapper;
        if (recording) {
          wrappers[kind].add(wrapper);
          if (kind === "edge") {
            const originalDelete = wrapper.delete.bind(wrapper);
            deleteAttempts.set(wrapper, 0);
            wrapper.delete = () => {
              const attempts = (deleteAttempts.get(wrapper) ?? 0) + 1;
              deleteAttempts.set(wrapper, attempts);
              if (wrapper === failedEdge && attempts === 1) {
                throw injectedCleanupError;
              }
              originalDelete();
            };
            if (failNextRecordedEdgeDelete && failedEdge === null) {
              failedEdge = wrapper;
              failNextRecordedEdgeDelete = false;
            }
          }
        }
        return wrapper;
      };
      restorers.push(() => {
        prototype[methodName] = original;
      });
    };
    const releaseTrackedWrappers = () => {
      for (const tracked of Object.values(wrappers)) {
        for (const wrapper of tracked) {
          if (!wrapper.isDeleted?.()) wrapper.delete();
        }
      }
    };
    const liveCount = (kind: WrapperKind) =>
      [...wrappers[kind]].filter((wrapper) => !wrapper.isDeleted?.()).length;

    patchFactoryResult(
      oc.BRepBuilderAPI_MakeEdge.prototype as unknown as Record<
        string,
        unknown
      >,
      "Edge",
      "edge",
    );
    patchFactoryResult(
      oc.BRepBuilderAPI_MakeVertex.prototype as unknown as Record<
        string,
        unknown
      >,
      "Vertex",
      "vertex",
    );
    patchFactoryResult(
      oc.BRepBuilderAPI_MakeFace.prototype as unknown as Record<
        string,
        unknown
      >,
      "Face",
      "face",
    );

    const { adapter } = await createAdapterWithCommittedSketch(oc);

    const service = createModelingService(adapter, {
      currentDocumentId: "doc_workspace",
    });
    let serviceDisposed = false;
    try {
      const warmup = await service.getCurrentDocumentSnapshot();
      expect(warmup.document.sketches).toHaveLength(1);
      expect(warmup.document.sketches[0]?.sketch.regions).toHaveLength(1);

      const faceBuilderPrototype = oc.BRepBuilderAPI_MakeFace
        .prototype as unknown as Record<string, unknown>;
      const originalIsDone = faceBuilderPrototype.IsDone;
      const originalWarn = console.warn;
      try {
        faceBuilderPrototype.IsDone = () => false;
        console.warn = () => undefined;
        recording = true;
        await service.getCurrentDocumentSnapshot();
      } finally {
        recording = false;
        faceBuilderPrototype.IsDone = originalIsDone;
        console.warn = originalWarn;
      }
      expect(
        wrappers.face.size,
        "Failed profile construction owns no face.",
      ).toBe(0);
      expect(
        wrappers.edge.size,
        "Failed profile construction allocates four edges.",
      ).toBe(4);
      expect(
        wrappers.vertex.size,
        "Failed profile construction allocates four vertices.",
      ).toBe(4);
      expect(
        liveCount("edge"),
        "Builder failure must release profile edges.",
      ).toBe(0);
      expect(
        liveCount("vertex"),
        "Builder failure must release profile vertices.",
      ).toBe(0);
      for (const tracked of Object.values(wrappers)) tracked.clear();

      recording = true;
      for (let index = 0; index < 50; index += 1) {
        await service.getCurrentDocumentSnapshot();
      }
      recording = false;

      expect(wrappers.face.size, "Each snapshot owns one profile face.").toBe(
        50,
      );
      expect(wrappers.edge.size, "Each snapshot owns four profile edges.").toBe(
        200,
      );
      expect(
        wrappers.vertex.size,
        "Each snapshot owns four profile vertices.",
      ).toBe(200);
      expect(
        {
          face: liveCount("face"),
          edge: liveCount("edge"),
          vertex: liveCount("vertex"),
        },
        "Every snapshot-owned profile wrapper must be released before service disposal.",
      ).toEqual({ face: 0, edge: 0, vertex: 0 });

      for (const tracked of Object.values(wrappers)) tracked.clear();
      deleteAttempts.clear();
      failedEdge = null;
      failNextRecordedEdgeDelete = true;
      const primarySnapshotError = new Error(
        "injected native profile face build failure",
      );
      let snapshotError: unknown;
      try {
        faceBuilderPrototype.IsDone = () => {
          throw primarySnapshotError;
        };
        recording = true;
        await service.getCurrentDocumentSnapshot();
      } catch (error) {
        snapshotError = error;
      } finally {
        recording = false;
        faceBuilderPrototype.IsDone = originalIsDone;
      }

      const cleanupErrors = collectOccCleanupErrors(snapshotError);
      expect(snapshotError).toBeInstanceOf(AggregateError);
      expect(
        (snapshotError as AggregateError).errors,
        "Snapshot rejection must preserve the primary builder error identity.",
      ).toContain(primarySnapshotError);
      expect(
        cleanupErrors,
        "The nested cleanup aggregate must remain observable to the caller.",
      ).toHaveLength(1);
      expect(cleanupErrors[0]?.errors).toContain(injectedCleanupError);
      expect(failedEdge).not.toBeNull();
      expect(deleteAttempts.get(failedEdge as OccWrapper)).toBe(1);
      expect(failedEdge?.isDeleted?.()).toBe(false);

      const successfulSiblingAttempts = new Map(
        [...deleteAttempts].filter(([wrapper]) => wrapper !== failedEdge),
      );
      expect(successfulSiblingAttempts.size).toBeGreaterThan(0);
      expect([...successfulSiblingAttempts.values()]).toEqual(
        Array(successfulSiblingAttempts.size).fill(1),
      );
      expect(
        [...successfulSiblingAttempts.keys()].every(
          (wrapper) => wrapper.isDeleted?.() === true,
        ),
      ).toBe(true);

      expect(() => service.dispose()).not.toThrow();
      serviceDisposed = true;
      expect(deleteAttempts.get(failedEdge as OccWrapper)).toBe(2);
      expect(failedEdge?.isDeleted?.()).toBe(true);
      for (const [wrapper, attempts] of successfulSiblingAttempts) {
        expect(deleteAttempts.get(wrapper)).toBe(attempts);
      }

      expect(() => adapter.dispose()).not.toThrow();
      expect(deleteAttempts.get(failedEdge as OccWrapper)).toBe(2);
      for (const [wrapper, attempts] of successfulSiblingAttempts) {
        expect(deleteAttempts.get(wrapper)).toBe(attempts);
      }
      expect(
        {
          face: liveCount("face"),
          edge: liveCount("edge"),
          vertex: liveCount("vertex"),
        },
        "Service disposal must preserve zero live snapshot-owned profile wrappers.",
      ).toEqual({ face: 0, edge: 0, vertex: 0 });
    } finally {
      recording = false;
      if (!serviceDisposed) service.dispose();
      releaseTrackedWrappers();
      for (const restore of restorers.reverse()) restore();
    }
  }

  async function testServiceSnapshotReadsReleaseSnapshotTemporaries() {
    const oc = await loadCustomOpenCascadeForTest();
    const { adapter } = await createAdapterWithCommittedSketch(oc);
    const request = {
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    } as const;
    const afterSketch = await adapter.getDocumentSnapshot(request);
    const sketch = afterSketch.snapshot.document.sketches[0];
    const regionId = sketch?.sketch.regions[0]?.regionId;
    if (!sketch || !regionId) throw new Error("Expected a committed region.");
    const extruded = await adapter.createFeature({
      ...request,
      baseRevisionId: afterSketch.snapshot.document.revisionId,
      definition: {
        kind: "extrude",
        featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
        parameters: {
          resultBodyType: "solid",
          profiles: [{ kind: "region", sketchId: sketch.sketchId, regionId }],
          startExtent: { kind: "profilePlane" },
          extent: {
            mode: "oneSide",
            end: {
              kind: "blind",
              direction: "positive",
              distance: { source: "literal", value: 2 },
            },
          },
          operation: { source: "literal", value: "newBody" },
          booleanScope: { kind: "standalone" },
        },
      },
    });
    expect(extruded.revisionState.kind).toBe("accepted");

    const tracker = makeSnapshotTemporaryTracker(oc);
    const service = createModelingService(adapter, {
      currentDocumentId: "doc_workspace",
    });
    let serviceDisposed = false;
    try {
      const baseline = await service.getCurrentDocumentSnapshot();
      const recordCounts = (records: typeof baseline.document.render.records) =>
        records.reduce<Record<string, number>>((counts, record) => {
          const kind = record.binding.topology ?? record.binding.semanticClass;
          counts[kind] = (counts[kind] ?? 0) + 1;
          return counts;
        }, {});
      expect(
        recordCounts(baseline.document.render.records),
        "The extruded rectangle renders as 6 faces, 12 edges, 8 vertices plus its region.",
      ).toMatchObject({ face: 6, edge: 12, vertex: 8, region: 1 });

      for (let index = 0; index < 20; index += 1) {
        const snapshot = await tracker.record(() =>
          service.getCurrentDocumentSnapshot(),
        );
        expect(
          snapshot.document.render.records,
          "Snapshot temporary cleanup must not change rendered faces, edges, vertices or regions.",
        ).toEqual(baseline.document.render.records);
      }

      const classes = tracker.classes();
      expect(
        Object.keys(classes),
        "The service read must reach planar classification, region mesh, Polygon3D, curve and vertex temporaries.",
      ).toEqual(
        expect.arrayContaining([
          "BRepAdaptor_Surface",
          "gp_Pln",
          "gp_Ax3",
          "gp_Ax3 component",
          "TopLoc_Location",
          "Handle_Poly_Triangulation",
          "gp_Trsf",
          "gp_Pnt(node)",
          "gp_Pnt(transformed)",
          "Poly_Triangle",
          "Handle_Poly_Polygon3D",
          "BRepAdaptor_Curve",
          "gp_Pnt(curve)",
          "gp_Pnt(vertex)",
        ]),
      );
      expect(
        classes,
        "Every snapshot-owned temporary must be released by the read that created it.",
      ).toEqual(allReleased(classes));
      expect(
        tracker.borrowed(),
        "Borrowed Handle.get() aliases are read only while their owner is live and never deleted.",
      ).toEqual({
        aliases: 20,
        deletes: 0,
        readsAfterOwnerDelete: 0,
      });

      // Primary read failure plus one failed owner release in the region mesh.
      tracker.clear();
      const primaryMeshError = new Error("injected triangle read failure");
      const meshCleanupError = new Error(
        "injected triangulation release failure",
      );
      const triangulationPrototype = oc.Poly_Triangulation
        .prototype as unknown as Record<string, unknown>;
      const originalTriangle = triangulationPrototype.Triangle;
      tracker.failFirstDeleteOfNext(
        "Handle_Poly_Triangulation",
        meshCleanupError,
      );
      let meshSnapshotError: unknown;
      try {
        triangulationPrototype.Triangle = () => {
          throw primaryMeshError;
        };
        await tracker.record(() => service.getCurrentDocumentSnapshot());
      } catch (error) {
        meshSnapshotError = error;
      } finally {
        triangulationPrototype.Triangle = originalTriangle;
      }
      expect(meshSnapshotError).toBeInstanceOf(AggregateError);
      expect(
        (meshSnapshotError as AggregateError).errors,
        "The primary mesh read error must stay observable next to its cleanup failure.",
      ).toContain(primaryMeshError);
      const meshCleanupErrors = collectOccCleanupErrors(meshSnapshotError);
      expect(meshCleanupErrors).toHaveLength(1);
      expect(meshCleanupErrors[0]?.errors).toContain(meshCleanupError);

      // A failed release after a successful planar classification must not be
      // swallowed as a non-planar face.
      const classificationCleanupError = new Error(
        "injected surface adaptor release failure",
      );
      tracker.failFirstDeleteOfNext(
        "BRepAdaptor_Surface",
        classificationCleanupError,
      );
      let classificationSnapshotError: unknown;
      try {
        await tracker.record(() => service.getCurrentDocumentSnapshot());
      } catch (error) {
        classificationSnapshotError = error;
      }
      const classificationCleanupErrors = collectOccCleanupErrors(
        classificationSnapshotError,
      );
      expect(
        classificationCleanupErrors,
        "Classification cleanup failure must reject the snapshot read.",
      ).toHaveLength(1);
      expect(classificationCleanupErrors[0]?.errors).toContain(
        classificationCleanupError,
      );

      const failing = tracker.failingWrappers();
      expect(failing).toHaveLength(2);
      for (const wrapper of failing) {
        expect(tracker.deleteAttempts(wrapper)).toBe(1);
        expect(wrapper.isDeleted?.()).toBe(false);
      }
      const siblings = Object.keys(tracker.classes()).flatMap((kind) =>
        tracker.wrappers(kind).filter((wrapper) => !failing.includes(wrapper)),
      );
      expect(siblings.length).toBeGreaterThan(0);
      expect(
        siblings.filter(
          (wrapper) =>
            tracker.deleteAttempts(wrapper) !== 1 || !wrapper.isDeleted?.(),
        ),
        "Sibling temporaries of failed reads are released exactly once.",
      ).toEqual([]);
      expect(tracker.borrowed().deletes).toBe(0);
      expect(tracker.borrowed().readsAfterOwnerDelete).toBe(0);

      expect(() => service.dispose()).not.toThrow();
      serviceDisposed = true;
      for (const wrapper of failing) {
        expect(
          tracker.deleteAttempts(wrapper),
          "Adapter disposal retries each failed snapshot temporary once.",
        ).toBe(2);
        expect(wrapper.isDeleted?.()).toBe(true);
      }
      expect(
        siblings.filter((wrapper) => tracker.deleteAttempts(wrapper) !== 1),
        "Retry must not delete already released siblings again.",
      ).toEqual([]);
      expect(tracker.classes()).toEqual(allReleased(tracker.classes()));
    } finally {
      if (!serviceDisposed) service.dispose();
      tracker.releaseLeftovers();
      tracker.restore();
    }
  }

  async function testPreviewSnapshotReleasesMeshedFaceMapAndEdgeTemporaries() {
    const oc = await loadCustomOpenCascadeForTest();
    const builder = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      1,
      2,
      3,
    );
    builder.Build(new oc.Message_ProgressRange_1());
    const body = trackNewSolidBody(oc, {
      bodyId: "body_snapshot_temporaries" as BodyId,
      label: "Snapshot temporaries body",
      ownerFeatureId: "feature_snapshot_temporaries" as FeatureId,
      shape: builder.Shape(),
    });
    const state = createOccAuthoringState(oc, { bodies: [body] });

    // Fixture: pre-mesh with the snapshot's fine deflection and add normals so
    // the JS mesh reads the normal branch; mesh one edge alone so it carries a
    // Polygon3D for the native-payload edge fallback.
    const liveHelpers: SnapshotTemporaryWrapper[] = [
      new oc.BRepMesh_IncrementalMesh_2(body.shape, 0.1, false, 0.5, false),
    ];
    for (const face of body.facesById.values()) {
      const location = new oc.TopLoc_Location_1();
      const handle = oc.BRep_Tool.Triangulation(face, location, 0 as never);
      if (!handle.IsNull()) handle.get().ComputeNormals();
      liveHelpers.push(handle, location);
    }
    const polygonEdge = [...body.edgesById.values()][0];
    if (!polygonEdge) throw new Error("Expected a box edge.");
    liveHelpers.push(
      new oc.BRepMesh_IncrementalMesh_2(polygonEdge, 0.1, false, 0.5, false),
    );
    for (const helper of liveHelpers) helper.delete();

    const nativeJson = oc.CadaraBuildNativeTopologyPayload?.BuildJson?.(
      body.shape,
      body.bodyId,
      body.topologyToken,
      0.1,
      0.5,
    );
    if (typeof nativeJson !== "string") {
      throw new Error("Custom OCC build should expose native payload JSON.");
    }
    const nativeTopologyPayload =
      createOccNativeTopologyPayloadFromShimPayloads({
        revisionId: state.revisionId,
        lodTierId: "fine",
        bodies: [
          {
            bodyId: body.bodyId,
            nativePayload: parseNativeShimPayloadJson(nativeJson),
          },
        ],
      });
    const bodyOwnedTopology: SnapshotTemporaryWrapper[] = [
      body.shape,
      ...body.facesById.values(),
      ...body.edgesById.values(),
      ...body.verticesById.values(),
    ];
    const tracker = makeSnapshotTemporaryTracker(oc);
    try {
      const baseline = buildOccWorkspaceSnapshot(state).document.render.records;
      const nativeBaseline = buildOccWorkspaceSnapshot(state, [], {
        nativeTopologyPayload,
      }).document.render.records;
      expect(
        baseline.filter(
          (record) =>
            record.geometry.kind === "mesh" && record.geometry.vertexNormals,
        ).length,
        "The fixture must render JS mesh normals.",
      ).toBeGreaterThan(0);

      for (let index = 0; index < 5; index += 1) {
        const previewRecords = await tracker.record(
          () => buildOccWorkspaceSnapshot(state).document.render.records,
        );
        const nativeRecords = await tracker.record(
          () =>
            buildOccWorkspaceSnapshot(state, [], { nativeTopologyPayload })
              .document.render.records,
        );
        expect(previewRecords).toEqual(baseline);
        expect(nativeRecords).toEqual(nativeBaseline);
      }

      // Size-mismatch fallback renders from the body's own face map.
      const mismatchedState = createOccAuthoringState(oc, {
        bodies: [
          {
            ...body,
            topology: {
              ...body.topology,
              faceIds: body.topology.faceIds.slice(0, 5),
            },
          },
        ],
      });
      const fallbackFaceRecords = await tracker.record(
        () =>
          buildOccWorkspaceSnapshot(
            mismatchedState,
          ).document.render.records.filter(
            (record) => record.binding.topology === "face",
          ).length,
      );
      expect(fallbackFaceRecords).toBe(5);

      const classes = tracker.classes();
      expect(
        Object.keys(classes),
        "Preview/native-payload reads must reach face map, normals, triangulated-edge and Polygon3D temporaries.",
      ).toEqual(
        expect.arrayContaining([
          "TopoDS_Shape(FindKey)",
          "TopoDS_Face(Face_1)",
          "gp_Dir(normal)",
          "gp_Dir(transformed)",
          "Handle_Poly_PolygonOnTriangulation",
          "Handle_Poly_Polygon3D",
          "TColgp_Array1OfPnt",
          "gp_Pnt(polygon)",
        ]),
      );
      expect(
        classes["TopoDS_Face(Face_1)"]?.created,
        "Only matching reads copy meshed faces; the fallback reuses body faces.",
      ).toBe(5 * body.topology.faceIds.length);
      expect(
        classes,
        "Every preview/native-payload snapshot temporary must be released.",
      ).toEqual(allReleased(classes));
      expect(tracker.borrowed().deletes).toBe(0);
      expect(tracker.borrowed().readsAfterOwnerDelete).toBe(0);
      expect(
        bodyOwnedTopology.filter((wrapper) => wrapper.isDeleted?.()),
        "State-owned body shape, faces (including the fallback face map), edges and vertices stay live.",
      ).toEqual([]);
    } finally {
      tracker.releaseLeftovers();
      tracker.restore();
      builder.delete?.();
    }
  }

  testProfileResultReleaseDeduplicatesAndRetriesFailedOwners();
  await testBodyRenderExportConsumesNativeMeshPayload();
  await testNativeRenderMapsMeshBindingsThroughPreservedDurableFaceIds();
  await testRepeatedServiceSnapshotsReleaseRegionProfileOwnership();
  await testServiceSnapshotReadsReleaseSnapshotTemporaries();
  await testPreviewSnapshotReleasesMeshedFaceMapAndEdgeTemporaries();
});
