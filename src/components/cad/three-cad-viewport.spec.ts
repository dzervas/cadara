import { test, expect } from "vitest";

import {
  cancelCoalescedSketchGeometryDragMove,
  getViewportPickTuning,
  isSketchDragHoverTarget,
  isSketchFitPointDraftActive,
  isViewportNavigationPointerMove,
  resolveSketchDragGesture,
  shouldCaptureZeroTangentHandle,
  SKETCH_DRAG_THRESHOLD_PX,
  TANGENT_HANDLE_ZERO_CAPTURE_PX,
  WORKSPACE_SCAFFOLD_RENDER_ORDER,
  configureWorkspaceScaffoldWireObject,
  createRenderIdleTracker,
  createViewportBvhSceneKey,
  createViewportInvalidationKey,
  projectWorldPointToViewport,
  projectSceneTargetCentroidToViewport,
  resolveSectionScreenDragOffset,
  resolveSketchFitPointRelease,
  resizeViewCubeRenderer,
  scheduleCoalescedSketchGeometryDragMove,
  type SketchDragGesturePhase,
} from "@/components/cad/three-cad-viewport-helpers";
import { resolveSketchDragTarget } from "@/domain/editor/workbench-interactions";
import { resolveHandleFromTarget } from "@/domain/editor/sketch-session/drag-intent";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import {
  requestViewCubeCameraTransition,
  resolveSketchCameraTransition,
} from "@/components/cad/three-cad-viewport-camera-transitions";
import { createDimensionAnnotationPlacementPatch } from "@/components/cad/three-cad-viewport-annotation-drag";
import { bindRenderableObject } from "@/infrastructure/viewport/render-picking";
import { measureSelectionFilter } from "@/core/editor/schema";
import type { ViewportCameraControls } from "@/infrastructure/viewport/viewport-camera-controls";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import * as THREE from "three";

test("src/components/cad/three-cad-viewport.spec.ts", () => {
  function createControls(target: THREE.Vector3): ViewportCameraControls {
    return {
      target,
      update: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  }

  function testDragMovesCoalesceToLatestPoint() {
    const pendingPointRef = {
      current: null as readonly [number, number] | null,
    };
    const pendingExactZeroRef = { current: false };
    const pendingFrameIdRef = { current: null as number | null };
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    const movedPoints: readonly [number, number][] = [];
    let nextFrameId = 1;

    const schedule = (point: readonly [number, number]) =>
      scheduleCoalescedSketchGeometryDragMove({
        point,
        pendingPointRef,
        pendingExactZeroRef,
        pendingFrameIdRef,
        requestFrame: (callback) => {
          const frameId = nextFrameId;
          nextFrameId += 1;
          frameCallbacks.set(frameId, callback);
          return frameId;
        },
        isDragActive: () => true,
        onMove: (latestPoint) => movedPoints.push(latestPoint),
      });

    schedule([1, 1]);
    schedule([2, 2]);
    schedule([3, 3]);

    expect(
      frameCallbacks.size,
      "Drag scheduler should request one frame for multiple pending moves.",
    ).toBe(1);
    frameCallbacks.get(1)?.(0);

    expect(
      movedPoints.length,
      "Drag scheduler should dispatch once per frame.",
    ).toBe(1);
    expect(
      movedPoints[0]?.[0] === 3 && movedPoints[0]?.[1] === 3,
      "Drag scheduler should dispatch the latest point.",
    ).toBeTruthy();
  }

  function testDragMoveCancellationDropsPendingFrame() {
    const pendingPointRef = {
      current: null as readonly [number, number] | null,
    };
    const pendingExactZeroRef = { current: false };
    const pendingFrameIdRef = { current: null as number | null };
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    const cancelledFrames: number[] = [];
    const movedPoints: readonly [number, number][] = [];

    scheduleCoalescedSketchGeometryDragMove({
      point: [4, 5],
      pendingPointRef,
      pendingExactZeroRef,
      pendingFrameIdRef,
      requestFrame: (callback) => {
        frameCallbacks.set(7, callback);
        return 7;
      },
      isDragActive: () => true,
      onMove: (latestPoint) => movedPoints.push(latestPoint),
    });
    cancelCoalescedSketchGeometryDragMove({
      pendingPointRef,
      pendingFrameIdRef,
      cancelFrame: (frameId) => cancelledFrames.push(frameId),
    });
    frameCallbacks.get(7)?.(0);

    expect(
      cancelledFrames[0],
      "Drag cancellation should cancel the pending frame.",
    ).toBe(7);
    expect(
      pendingFrameIdRef.current,
      "Drag cancellation should clear the pending frame id.",
    ).toBe(null);
    expect(
      pendingPointRef.current,
      "Drag cancellation should clear the pending point.",
    ).toBe(null);
    expect(
      movedPoints.length,
      "Cancelled drag frame should not dispatch a stale move.",
    ).toBe(0);
  }

  function testSketchBvhKeyIgnoresPositionalPolylineUpdates() {
    const renderable = {
      id: "renderable_sketch_line_0",
      label: "Line",
      geometry: {
        kind: "polyline",
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        isClosed: false,
      },
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: "sketch_entity_ab",
      },
      linePattern: "solid",
      role: "local",
    } as const;
    const movedRenderable = {
      ...renderable,
      geometry: {
        ...renderable.geometry,
        points: [
          [3, 4, 0],
          [5, 4, 0],
        ],
      },
    } as const;
    const dashedRenderable = {
      ...movedRenderable,
      linePattern: "dashed",
    } as const;

    expect(
      createViewportBvhSceneKey([], [renderable]),
      "Sketch BVH key should stay stable for positional-only polyline updates.",
    ).toBe(createViewportBvhSceneKey([], [movedRenderable]));
    expect(
      createViewportBvhSceneKey([], [movedRenderable]),
      "Sketch BVH key should change when structural line styling changes.",
    ).not.toBe(createViewportBvhSceneKey([], [dashedRenderable]));
  }

  function testSketchBvhKeyDoesNotEmbedInlineImagePayloads() {
    const renderable = {
      id: "renderable_sketch_reference_image_0",
      label: "Reference image",
      geometry: {
        kind: "mesh",
        vertexPositions: [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        vertexNormals: [
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
          [0, 0, 1],
        ],
        triangleIndices: [
          [0, 1, 2],
          [0, 2, 3],
        ],
      },
      target: {
        kind: "sketchOperation",
        sketchId: "sketch_primary",
        operationId: "sketch_operation_1_reference-image",
      },
      linePattern: "solid",
      role: "local",
      semanticClass: "sketchImage",
      textureFill: {
        kind: "inlineImage",
        sourceKey:
          "sketch_operation_1_reference-image:image/png:reference.png:640x480",
        mediaType: "image/png",
        base64Data: "cG5n",
        uvCoordinates: [
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
        opacity: 0.55,
      },
    } as const;
    const changedPayloadRenderable = {
      ...renderable,
      textureFill: {
        ...renderable.textureFill,
        base64Data: "dXBkYXRlZA==",
      },
    } as const;

    expect(
      createViewportBvhSceneKey([], [renderable]),
      "Sketch BVH keys should stay independent from inline image payload bytes.",
    ).toBe(createViewportBvhSceneKey([], [changedPayloadRenderable]));
  }

  function testProjectionBridgeResolvesKnownTarget() {
    const root = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial(),
    );

    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    bindRenderableObject(
      mesh,
      null,
      { kind: "body", bodyId: "body_feature_extrude-1" },
      "bodyFace",
      "document",
    );
    root.add(mesh);

    const point = projectSceneTargetCentroidToViewport({
      root,
      camera,
      objectId: "body_feature_extrude-1",
      viewport: { width: 200, height: 100 },
    });
    const missingPoint = projectSceneTargetCentroidToViewport({
      root,
      camera,
      objectId: "missing-target",
      viewport: { width: 200, height: 100 },
    });

    expect(
      point,
      "Projection bridge should return coordinates for a known target.",
    ).not.toBe(null);
    expect(
      Math.abs(point.x - 100) < 0.001,
      "Projected target should be centered horizontally.",
    ).toBeTruthy();
    expect(
      Math.abs(point.y - 50) < 0.001,
      "Projected target should be centered vertically.",
    ).toBeTruthy();
    expect(
      missingPoint,
      "Projection bridge should return null for unknown targets.",
    ).toBe(null);

    mesh.geometry.dispose();
    if (mesh.material instanceof THREE.Material) {
      mesh.material.dispose();
    }
  }

  function testWorldPointProjectionMapsViewportCoordinates() {
    const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const centeredPoint = projectWorldPointToViewport({
      camera,
      point: [0, 0, 0],
      viewport: { width: 240, height: 120 },
    });
    const offsetPoint = projectWorldPointToViewport({
      camera,
      point: [1, 0, 0],
      viewport: { width: 240, height: 120 },
    });
    const hiddenPoint = projectWorldPointToViewport({
      camera,
      point: [0, 0, 20],
      viewport: { width: 240, height: 120 },
    });

    expect(
      centeredPoint,
      "World-point projection should resolve visible points.",
    ).not.toBe(null);
    expect(
      Math.abs(centeredPoint.x - 120) < 0.001,
      "Projection should center the world origin horizontally.",
    ).toBeTruthy();
    expect(
      Math.abs(centeredPoint.y - 60) < 0.001,
      "Projection should center the world origin vertically.",
    ).toBeTruthy();
    expect(
      offsetPoint !== null && offsetPoint.x > centeredPoint.x,
      "Projection should preserve horizontal ordering for visible points.",
    ).toBeTruthy();
    expect(
      hiddenPoint,
      "Projection should reject points that fall behind the active camera.",
    ).toBe(null);
  }

  function testSectionScreenDragOffsetTracksProjectedNormalMotion() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(8, -10, 6);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const section = {
      seed: { kind: "construction", constructionId: "construction_plane-xy" },
      plane: createStandardPlaneDefinition("xy"),
      offset: 0,
      retainedSide: "positive",
    } as const;

    const center = projectWorldPointToViewport({
      camera,
      point: [0, 0, 0],
      viewport: { width: 200, height: 200 },
    });
    const normalPoint = projectWorldPointToViewport({
      camera,
      point: [0, 0, 1],
      viewport: { width: 200, height: 200 },
    });

    expect(
      center !== null && normalPoint !== null,
      "Section drag projection should be testable with visible handle points.",
    ).toBeTruthy();

    const axisDelta = {
      x: normalPoint.x - center.x,
      y: normalPoint.y - center.y,
    };
    const axisLength = Math.hypot(axisDelta.x, axisDelta.y);
    const axisUnit = {
      x: axisDelta.x / axisLength,
      y: axisDelta.y / axisLength,
    };
    const offset = resolveSectionScreenDragOffset({
      camera,
      viewport: { width: 200, height: 200 },
      sectionAtDragStart: section,
      dragStartClientPoint: center,
      currentClientPoint: {
        x: center.x + axisUnit.x * axisLength * 2,
        y: center.y + axisUnit.y * axisLength * 2,
      },
    });

    expect(
      offset,
      "Section drag projection should resolve a numeric offset for visible axis motion.",
    ).not.toBe(null);
    expect(
      Math.abs(offset - 2) < 0.05,
      "Section drag projection should convert two projected world units into offset motion along the section normal.",
    ).toBeTruthy();
  }

  function testSectionScreenDragOffsetFallsBackWhenNormalProjectsToPoint() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const offset = resolveSectionScreenDragOffset({
      camera,
      viewport: { width: 200, height: 200 },
      sectionAtDragStart: {
        seed: { kind: "construction", constructionId: "construction_plane-xy" },
        plane: createStandardPlaneDefinition("xy"),
        offset: 0,
        retainedSide: "positive",
      },
      dragStartClientPoint: { x: 100, y: 100 },
      currentClientPoint: { x: 100, y: 80 },
    });

    expect(
      offset,
      "Section drag projection should still resolve an offset when the section normal is view-aligned.",
    ).not.toBe(null);
    expect(
      Math.abs(offset) > 0.001,
      "Section drag projection fallback should produce visible motion for aligned views.",
    ).toBeTruthy();
  }

  function testRenderIdleTrackerRequiresStableIdleFrames() {
    const tracker = createRenderIdleTracker({
      requiredStableFrames: 2,
      maxStableDelta: 0.05,
    });
    const active = tracker.update({
      delta: 0.016,
      isEditorIdle: false,
      sceneKey: "scene-a",
    });
    const firstIdle = tracker.update({
      delta: 0.016,
      isEditorIdle: true,
      sceneKey: "scene-a",
    });
    const secondIdle = tracker.update({
      delta: 0.016,
      isEditorIdle: true,
      sceneKey: "scene-a",
    });
    const sceneChanged = tracker.update({
      delta: 0.016,
      isEditorIdle: true,
      sceneKey: "scene-b",
    });

    expect(
      active,
      "Render idle should stay false while the editor is active.",
    ).toBeFalsy();
    expect(
      firstIdle,
      "Render idle should require consecutive stable frames.",
    ).toBeFalsy();
    expect(
      secondIdle,
      "Render idle should become true after enough stable idle frames.",
    ).toBeTruthy();
    expect(
      sceneChanged,
      "Render idle should clear when the scene changes.",
    ).toBeFalsy();
  }

  function testViewportInvalidationKeyTracksVisibleAuthoringInputs() {
    const base = {
      sceneKey: "scene-a",
      hoverTargetKey: "none",
      selectionKeys: [],
      sketchFeedbackKey: "tool-a",
      measurementWitnessCount: 0,
      sectionViewKey: "none",
      clippingKey: "none",
      lodKey: "lod-a",
      projectionMode: "orthographic",
      themeKey: "default",
      fitViewRequestId: 1,
      transitionVersion: 1,
    };

    const initial = createViewportInvalidationKey(base);

    expect(
      createViewportInvalidationKey({ ...base, sceneKey: "scene-b" }),
      "Renderable changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
    expect(
      createViewportInvalidationKey({
        ...base,
        hoverTargetKey: "sketch:point-a",
      }),
      "Hover changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
    expect(
      createViewportInvalidationKey({ ...base, selectionKeys: ["body:a"] }),
      "Selection changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
    expect(
      createViewportInvalidationKey({
        ...base,
        sketchFeedbackKey: "tool-b",
      }),
      "Sketch preview feedback changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
    expect(
      createViewportInvalidationKey({ ...base, transitionVersion: 2 }),
      "Camera transition requests should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
  }

  function testViewportInvalidationKeyTracksPresentationInputs() {
    const base = {
      sceneKey: "scene-a",
      hoverTargetKey: "none",
      selectionKeys: [],
      sketchFeedbackKey: "tool-a",
      measurementWitnessCount: 0,
      sectionViewKey: "none",
      clippingKey: "none",
      lodKey: "lod-a",
      projectionMode: "orthographic",
      themeKey: "default",
      fitViewRequestId: 1,
      transitionVersion: 1,
    };

    const initial = createViewportInvalidationKey(base);

    expect(
      createViewportInvalidationKey({
        ...base,
        sectionViewKey: "section-a",
      }),
      "Section view changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
    expect(
      createViewportInvalidationKey({ ...base, clippingKey: "0,0,1:4" }),
      "Clipping changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
    expect(
      createViewportInvalidationKey({ ...base, lodKey: "lod-b" }),
      "LOD changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
    expect(
      createViewportInvalidationKey({
        ...base,
        projectionMode: "perspective",
      }),
      "Projection changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
    expect(
      createViewportInvalidationKey({ ...base, themeKey: "styled" }),
      "Theme and material changes should invalidate the demand-rendered viewport.",
    ).not.toBe(initial);
  }

  function testViewCubeResizeUpdatesCanvasCssSize() {
    const setSizeCalls: Array<{
      width: number;
      height: number;
      updateStyle?: boolean;
    }> = [];
    const cubeSize = resizeViewCubeRenderer({
      cubeElement: { clientWidth: 120, clientHeight: 96 },
      renderer: {
        setSize: (width, height, updateStyle) => {
          setSizeCalls.push({ width, height, updateStyle });
        },
      },
    });

    expect(
      cubeSize,
      "View cube renderer should fit within the smaller cube container dimension.",
    ).toBe(96);
    expect(
      setSizeCalls.length,
      "View cube resize should issue one renderer size update.",
    ).toBe(1);
    expect(
      setSizeCalls[0]?.width,
      "View cube renderer width should match the computed CSS size.",
    ).toBe(96);
    expect(
      setSizeCalls[0]?.height,
      "View cube renderer height should match the computed CSS size.",
    ).toBe(96);
    expect(
      setSizeCalls[0]?.updateStyle,
      "View cube renderer should update canvas CSS size so devicePixelRatio does not enlarge the visible overlay.",
    ).toBeTruthy();
  }

  function testWorkspaceScaffoldWiresDoNotWriteDepth() {
    const grid = configureWorkspaceScaffoldWireObject(
      new THREE.GridHelper(10, 10),
    );
    const axes = configureWorkspaceScaffoldWireObject(new THREE.AxesHelper(4));
    const materials = [
      ...(Array.isArray(grid.material) ? grid.material : [grid.material]),
      ...(Array.isArray(axes.material) ? axes.material : [axes.material]),
    ];

    expect(
      grid.renderOrder,
      "Grid should render before model and sketch wires.",
    ).toBe(WORKSPACE_SCAFFOLD_RENDER_ORDER);
    expect(
      axes.renderOrder,
      "Axes should render before model and sketch wires.",
    ).toBe(WORKSPACE_SCAFFOLD_RENDER_ORDER);
    expect(
      materials.every((material) => material.depthTest && !material.depthWrite),
      "Scaffold wire materials should depth-test without writing depth.",
    ).toBeTruthy();

    grid.geometry.dispose();
    axes.geometry.dispose();
    materials.forEach((material) => material.dispose());
  }

  function testMeasurePickTuningTightensWirePassThroughTolerance() {
    const defaultTuning = getViewportPickTuning(null);
    const measureTuning = getViewportPickTuning(measureSelectionFilter);

    expect(
      defaultTuning.linePickThreshold > measureTuning.linePickThreshold,
      "Measure picking should reduce the line threshold to avoid selecting hidden wires through faces.",
    ).toBeTruthy();
    expect(
      (measureTuning.resolutionOptions.wireOcclusionTolerance ??
        Number.POSITIVE_INFINITY) < Number.POSITIVE_INFINITY,
      "Measure picking should install an explicit wire occlusion tolerance override.",
    ).toBeTruthy();
    expect(
      (measureTuning.resolutionOptions.wireOcclusionTolerance ?? 0) <
        (defaultTuning.resolutionOptions.wireOcclusionTolerance ??
          Number.POSITIVE_INFINITY),
      "Measure picking should use a tighter face-over-wire occlusion tolerance than the default picker.",
    ).toBeTruthy();
  }

  function testNavigationPointerMoveDetectionIgnoresPrimaryDrawingGestures() {
    expect(
      isViewportNavigationPointerMove(0),
      "Hover moves without pressed buttons should stay available to sketch preview interactions.",
    ).toBeFalsy();
    expect(
      isViewportNavigationPointerMove(1),
      "Primary-button moves should stay available so sketch drawing and dragging can continue.",
    ).toBeFalsy();
    expect(
      isViewportNavigationPointerMove(2),
      "Secondary-button moves should be treated as viewport navigation so sketch projection does not reframe the camera mid-rotate.",
    ).toBeTruthy();
    expect(
      isViewportNavigationPointerMove(4),
      "Auxiliary-button moves should be treated as viewport navigation so panning bypasses sketch hover work.",
    ).toBeTruthy();
  }

  function testDimensionAnnotationDragPatchTargetsDurablePlacement() {
    const patch = createDimensionAnnotationPlacementPatch(
      { id: "dimension_1-annotation-drag", dimensionId: "dimension_1" },
      [8, 3],
    );

    expect(
      patch.intent === "setDimensionAnnotationPlacement" &&
        patch.handleId === "dimension_1-annotation-drag" &&
        patch.dimensionId === "dimension_1" &&
        patch.point[0] === 8 &&
        patch.point[1] === 3,
      "Dimension annotation drags should route through the committed dimension placement patch path.",
    ).toBeTruthy();
  }

  function testViewCubeRequestsAnimatedTransition() {
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    camera.position.set(12, -12, 12);
    const controls = createControls(new THREE.Vector3(1, 2, 3));
    const requests: Array<{
      fromFrameProjectionMode: string;
      targetFrameProjectionMode: string;
    }> = [];

    const result = requestViewCubeCameraTransition({
      presetId: "front",
      camera,
      controls,
      requestTransition: (targetFrame, fromFrame) => {
        requests.push({
          fromFrameProjectionMode: fromFrame?.projectionMode ?? "unknown",
          targetFrameProjectionMode: targetFrame.projectionMode,
        });
      },
    });

    expect(
      result,
      "View cube clicks should produce a camera transition request when the viewport is ready.",
    ).not.toBe(null);
    expect(
      requests.length,
      "View cube navigation should request one shared animated transition.",
    ).toBe(1);
    expect(
      requests[0]?.fromFrameProjectionMode === "orthographic" &&
        requests[0]?.targetFrameProjectionMode === "orthographic",
      "View cube navigation should preserve the active projection when requesting the transition.",
    ).toBeTruthy();
  }

  function testSketchEntryRequestsAnimatedFraming() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(14, -16, 28);
    const controls = createControls(new THREE.Vector3(0, 0, 4));
    const sketchSession = {
      sketchId: "sketch_1",
      plane: {
        support: {
          kind: "construction",
          constructionId: "construction_plane-xy",
        },
        key: "xy",
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: "documentLength",
          handedness: "rightHanded",
        },
      },
    } as Parameters<typeof resolveSketchCameraTransition>[0]["sketchSession"];

    const resolution = resolveSketchCameraTransition({
      camera,
      controls,
      sketchSession,
      sketchDisplayRenderables: [],
      state: {
        activeSessionToken: null,
        preSketchFrame: null,
      },
    });

    expect(
      resolution.targetFrame,
      "Entering sketch mode should request a transition into the sketch frame.",
    ).not.toBe(null);
    expect(
      resolution.fromFrame?.projectionMode,
      "Sketch entry should capture the pre-entry camera pose.",
    ).toBe("perspective");
    expect(
      resolution.state.activeSessionToken,
      "Sketch entry should scope the saved camera pose to the active session token.",
    ).not.toBe(null);
  }

  function testSketchExitRequestsRestoreTransition() {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(8, 8, 8);
    const controls = createControls(new THREE.Vector3(0, 0, 0));

    const resolution = resolveSketchCameraTransition({
      camera,
      controls,
      sketchSession: null,
      sketchDisplayRenderables: [],
      state: {
        activeSessionToken: "sketch_1:construction:construction_plane-xy:0,0,0",
        preSketchFrame: {
          projectionMode: "orthographic",
          position: new THREE.Vector3(20, -20, 20),
          target: new THREE.Vector3(0, 0, 4),
          up: new THREE.Vector3(0, 0, 1),
          cameraDistance: Math.sqrt(20 ** 2 * 3),
          perspectiveDistance: 18,
          orthographicZoom: 1.4,
        },
      },
    });

    expect(
      resolution.targetFrame?.projectionMode,
      "Sketch exit should restore the captured pre-entry projection.",
    ).toBe("orthographic");
    expect(
      resolution.fromFrame?.projectionMode,
      "Sketch exit should animate back from the current sketch camera pose.",
    ).toBe("perspective");
    expect(
      resolution.state.activeSessionToken === null &&
        resolution.state.preSketchFrame === null,
      "Sketch exit should clear the active session-scoped camera snapshot after requesting restoration.",
    ).toBeTruthy();
  }

  testDragMovesCoalesceToLatestPoint();
  testDragMoveCancellationDropsPendingFrame();
  testSketchBvhKeyIgnoresPositionalPolylineUpdates();
  testSketchBvhKeyDoesNotEmbedInlineImagePayloads();
  testProjectionBridgeResolvesKnownTarget();
  testWorldPointProjectionMapsViewportCoordinates();
  testSectionScreenDragOffsetTracksProjectedNormalMotion();
  testSectionScreenDragOffsetFallsBackWhenNormalProjectsToPoint();
  testRenderIdleTrackerRequiresStableIdleFrames();
  testViewportInvalidationKeyTracksVisibleAuthoringInputs();
  testViewportInvalidationKeyTracksPresentationInputs();
  testViewCubeResizeUpdatesCanvasCssSize();
  testWorkspaceScaffoldWiresDoNotWriteDepth();
  testMeasurePickTuningTightensWirePassThroughTolerance();
  testNavigationPointerMoveDetectionIgnoresPrimaryDrawingGestures();
  testDimensionAnnotationDragPatchTargetsDurablePlacement();
  testViewCubeRequestsAnimatedTransition();
  testSketchEntryRequestsAnimatedFraming();
  testSketchExitRequestsRestoreTransition();
});

// T11-D13: the viewport's spline double-click wiring. The pointer-up path
// dispatches a release only when `dispatch` is true and keeps `record` for
// the next release; `dblclick` finalizes when a fit-point draft is active.
test("a spline double-click's second release is not dispatched; dblclick finalizes only a spline draft (T11-D13)", () => {
  const drawing = { activeTool: "spline", status: "drawing" } as const;
  const armedIdle = { activeTool: "spline", status: "idle" } as const;
  const lineChain = { activeTool: "line", status: "drawing" } as const;

  // Double-click: the first release places a fit point, the second (same
  // spot, the draft now drawing) is swallowed.
  const first = resolveSketchFitPointRelease({
    session: armedIdle,
    previous: null,
    release: { x: 100, y: 100 },
  });
  expect(first).toEqual({ dispatch: true, record: { x: 100, y: 100 } });
  for (const release of [
    { x: 100, y: 100 },
    { x: 103, y: 102 },
    { x: 104, y: 100 },
  ]) {
    expect(
      resolveSketchFitPointRelease({
        session: drawing,
        previous: first.record,
        release,
      }),
      `A release within 4 px (${JSON.stringify(release)}) is the double-click's second release.`,
    ).toEqual({ dispatch: false, record: { x: 100, y: 100 } });
  }
  expect(
    resolveSketchFitPointRelease({
      session: drawing,
      previous: first.record,
      release: { x: 104, y: 101 },
    }),
    "Beyond 4 px a release adds the next fit point.",
  ).toEqual({ dispatch: true, record: { x: 104, y: 101 } });

  // After a finalize (Spline armed, idle) the same spot starts a new spline.
  expect(
    resolveSketchFitPointRelease({
      session: armedIdle,
      previous: { x: 100, y: 100 },
      release: { x: 100, y: 100 },
    }).dispatch,
  ).toBe(true);
  // Other tools are never de-duplicated and leave no record.
  expect(
    resolveSketchFitPointRelease({
      session: lineChain,
      previous: { x: 100, y: 100 },
      release: { x: 100, y: 100 },
    }),
  ).toEqual({ dispatch: true, record: null });
  expect(
    resolveSketchFitPointRelease({
      session: null,
      previous: null,
      release: { x: 1, y: 1 },
    }),
  ).toEqual({ dispatch: true, record: null });

  expect(
    isSketchFitPointDraftActive(drawing),
    "dblclick with a spline draft finalizes (and is not a connected selection).",
  ).toBe(true);
  for (const session of [armedIdle, lineChain, null]) {
    expect(
      isSketchFitPointDraftActive(session),
      `dblclick keeps its other behaviour for ${JSON.stringify(session)}.`,
    ).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// T12c R-4: sketch drag gesture helpers (viewport seam)
// ---------------------------------------------------------------------------

/** Minimal sketch definition for drag resolution tests. */
function makeDefinition(
  points: SketchDefinition["points"],
  entities: SketchDefinition["entities"],
): SketchDefinition {
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: points.map((p) => p.pointId),
    points,
    entityIds: entities.map((e) => e.entityId),
    entities,
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };
}

function lineEntity(
  entityId: string,
  startPointId: string,
  endPointId: string,
): SketchDefinition["entities"][number] {
  return {
    kind: "lineSegment",
    entityId,
    startPointId,
    endPointId,
    construction: false,
  };
}

function circleEntity(
  entityId: string,
  centerPointId: string,
): SketchDefinition["entities"][number] {
  return {
    kind: "circle",
    entityId,
    centerPointId,
    construction: false,
  };
}

function arcEntity(
  entityId: string,
  centerPointId: string,
  startPointId: string,
  endPointId: string,
): SketchDefinition["entities"][number] {
  return {
    kind: "arc",
    entityId,
    centerPointId,
    startPointId,
    endPointId,
    construction: false,
  };
}

function splineEntity(
  entityId: string,
  pointIds: string[],
): SketchDefinition["entities"][number] {
  return {
    kind: "spline",
    entityId,
    startPointId: pointIds[0]!,
    endPointId: pointIds[pointIds.length - 1]!,
    pointOccurrences: pointIds.map((pointId, i) => ({
      occurrenceId: `occ_${i}`,
      pointId,
      tangent: null,
    })),
    periodic: false,
    construction: false,
  };
}

function point(pointId: string): SketchDefinition["points"][number] {
  return { pointId, x: 0, y: 0 };
}

function makePending(
  target: PrimitiveRef,
  startPoint: readonly [number, number] = [5, 5],
  pointerDown: { x: number; y: number } = { x: 100, y: 100 },
): SketchDragGesturePhase & { kind: "pending" } {
  return { kind: "pending", target, startPoint, pointerDown };
}

function makeActive(
  target: PrimitiveRef,
  pointerId = 1,
): SketchDragGesturePhase & { kind: "active" } {
  return { kind: "active", target, pointerId };
}

const sketchPointRef = (pointId: string): PrimitiveRef => ({
  kind: "sketchPoint",
  sketchId: "sketch_1",
  pointId,
});
const sketchEntityRef = (entityId: string): PrimitiveRef => ({
  kind: "sketchEntity",
  sketchId: "sketch_1",
  entityId,
});

// -- Press kind → handle (through the same path the component uses) ---------

test("T12c R-4: each press kind produces the expected handle through the viewport path", () => {
  const def = makeDefinition(
    [
      point("p1"),
      point("p2"),
      point("p3"),
      point("p4"),
      point("p5"),
      point("p6"),
      point("p7"),
    ],
    [
      lineEntity("line_1", "p1", "p2"),
      circleEntity("circle_1", "p3"),
      arcEntity("arc_1", "p4", "p5", "p6"),
      splineEntity("spline_1", ["p1", "p7", "p2"]),
    ],
  );

  // Line body → entityBody
  const lineTarget = resolveSketchDragTarget(
    [{ target: sketchEntityRef("line_1") }],
    [],
    def,
  );
  expect(lineTarget, "Line body should resolve a drag target.").not.toBe(null);
  expect(
    resolveHandleFromTarget(def, lineTarget!),
    "Line body press should produce entityBody handle.",
  ).toEqual({ kind: "entityBody", entityId: "line_1" });

  // Circle rim → rim
  const circleRimTarget = resolveSketchDragTarget(
    [{ target: sketchEntityRef("circle_1") }],
    [],
    def,
  );
  expect(
    resolveHandleFromTarget(def, circleRimTarget!),
    "Circle rim press should produce rim handle.",
  ).toEqual({ kind: "rim", entityId: "circle_1" });

  // Circle centre → center (exclusive centre of one circle)
  const circleCentreTarget = resolveSketchDragTarget(
    [{ target: sketchPointRef("p3") }],
    [],
    def,
  );
  expect(
    resolveHandleFromTarget(def, circleCentreTarget!),
    "Circle centre press should produce center handle.",
  ).toEqual({ kind: "center", entityId: "circle_1" });

  // Arc centre → center (exclusive centre of one arc)
  const arcCentreTarget = resolveSketchDragTarget(
    [{ target: sketchPointRef("p4") }],
    [],
    def,
  );
  expect(
    resolveHandleFromTarget(def, arcCentreTarget!),
    "Arc centre press should produce center handle.",
  ).toEqual({ kind: "center", entityId: "arc_1" });

  // Spline body → entityBody
  const splineTarget = resolveSketchDragTarget(
    [{ target: sketchEntityRef("spline_1") }],
    [],
    def,
  );
  expect(
    resolveHandleFromTarget(def, splineTarget!),
    "Spline body press should produce entityBody handle.",
  ).toEqual({ kind: "entityBody", entityId: "spline_1" });

  // Fit point (spline point) → point
  const fitPointTarget = resolveSketchDragTarget(
    [{ target: sketchPointRef("p7") }],
    [],
    def,
  );
  expect(
    resolveHandleFromTarget(def, fitPointTarget!),
    "Spline fit point press should produce point handle.",
  ).toEqual({ kind: "point", pointId: "p7" });

  // Plain sketch point → point
  const plainPointTarget = resolveSketchDragTarget(
    [{ target: sketchPointRef("p1") }],
    [],
    def,
  );
  expect(
    resolveHandleFromTarget(def, plainPointTarget!),
    "Plain sketch point press should produce point handle.",
  ).toEqual({ kind: "point", pointId: "p1" });
});

// -- D9 presses start nothing -----------------------------------------------

test("T12c R-4: D9 presses produce no drag target", () => {
  const def = makeDefinition([], []);
  const d9Targets: PrimitiveRef[] = [
    { kind: "feature", featureId: "f1" },
    { kind: "body", bodyId: "b1" },
    { kind: "face", bodyId: "b1", faceId: "f1" },
    { kind: "edge", bodyId: "b1", edgeId: "e1" },
    { kind: "vertex", bodyId: "b1", vertexId: "v1" },
  ];
  for (const target of d9Targets) {
    expect(
      resolveSketchDragTarget([{ target }], [], def),
      `D9 target ${target.kind} should not produce a drag target.`,
    ).toBe(null);
  }
});

// -- Hover cursor (grab / no grab) ------------------------------------------

test("T12c R-4: grab cursor on draggable hover, cleared otherwise", () => {
  const def = makeDefinition(
    [point("p1"), point("p2")],
    [lineEntity("line_1", "p1", "p2")],
  );
  const idleSession = { activeTool: null, status: "idle" as const };
  const drawingSession = {
    activeTool: "line" as const,
    status: "drawing" as const,
  };
  const specialSession = {
    activeTool: null,
    status: "idle" as const,
    activeSpecialMode: { kind: "reference-picker" },
  };

  expect(
    isSketchDragHoverTarget(idleSession, sketchEntityRef("line_1"), def),
    "Hovering a draggable entity in idle mode should produce grab cursor.",
  ).toBe(true);

  expect(
    isSketchDragHoverTarget(idleSession, sketchPointRef("p1"), def),
    "Hovering a draggable point in idle mode should produce grab cursor.",
  ).toBe(true);

  expect(
    isSketchDragHoverTarget(
      idleSession,
      { kind: "feature", featureId: "f" },
      def,
    ),
    "Hovering a non-sketch target should not produce grab cursor.",
  ).toBe(false);

  expect(
    isSketchDragHoverTarget(drawingSession, sketchEntityRef("line_1"), def),
    "Hovering while drawing should not produce grab cursor.",
  ).toBe(false);

  expect(
    isSketchDragHoverTarget(specialSession, sketchEntityRef("line_1"), def),
    "Hovering in a special mode should not produce grab cursor.",
  ).toBe(false);

  expect(
    isSketchDragHoverTarget(null, sketchEntityRef("line_1"), def),
    "Hovering with no session should not produce grab cursor.",
  ).toBe(false);

  expect(
    isSketchDragHoverTarget(idleSession, null, def),
    "Hovering with no target should not produce grab cursor.",
  ).toBe(false);
});

// -- Gesture reducer: threshold → drag start, capture, grabbing cursor ------

test("T12c R-4: pointer move crosses threshold → drag start with capture and grabbing cursor", () => {
  const target = sketchPointRef("p1");
  const pending = makePending(target, [5, 5], { x: 100, y: 100 });

  // Under threshold: not consumed, no actions.
  const underResult = resolveSketchDragGesture(pending, {
    kind: "pointerMove",
    clientX: 103,
    clientY: 103,
    pointerId: 1,
    sketchPoint: [5.1, 5.1],
  });
  expect(
    underResult.consumed,
    "Under-threshold move should not be consumed.",
  ).toBe(false);
  expect(
    underResult.startDrag,
    "Under-threshold move should not start a drag.",
  ).toBe(null);
  expect(
    underResult.phase.kind,
    "Under-threshold move should keep the pending phase.",
  ).toBe("pending");

  // Over threshold: start drag.
  const dx = SKETCH_DRAG_THRESHOLD_PX + 1;
  const overResult = resolveSketchDragGesture(pending, {
    kind: "pointerMove",
    clientX: 100 + dx,
    clientY: 100,
    pointerId: 1,
    sketchPoint: [8, 5],
  });
  expect(overResult.consumed, "Over-threshold move should be consumed.").toBe(
    true,
  );
  expect(
    overResult.phase.kind,
    "Over-threshold move should transition to active.",
  ).toBe("active");
  expect(
    overResult.startDrag,
    "Drag start should carry the pending target and startPoint.",
  ).toEqual({ target, startPoint: [5, 5] });
  expect(
    overResult.requestCapture,
    "Capture should be requested at drag start.",
  ).toBe(1);
  expect(overResult.cursor, "Cursor should be grabbing at drag start.").toBe(
    "grabbing",
  );
  expect(
    overResult.preventDefault,
    "Drag start should call preventDefault.",
  ).toBe(true);
  expect(
    overResult.scheduleDragMove,
    "Drag start should schedule the initial move.",
  ).toEqual([8, 5]);
});

// -- Gesture reducer: active drag move → grabbing cursor --------------------

test("T12c R-4: active drag move sets grabbing cursor and schedules move", () => {
  const active = makeActive(sketchPointRef("p1"));
  const result = resolveSketchDragGesture(active, {
    kind: "pointerMove",
    clientX: 200,
    clientY: 200,
    pointerId: 1,
    sketchPoint: [10, 10],
  });
  expect(result.consumed, "Active drag move should be consumed.").toBe(true);
  expect(result.cursor, "Active drag should keep grabbing cursor.").toBe(
    "grabbing",
  );
  expect(
    result.scheduleDragMove,
    "Active drag should schedule the move point.",
  ).toEqual([10, 10]);
  expect(result.phase.kind, "Active drag should stay in active phase.").toBe(
    "active",
  );
});

// -- Gesture reducer: active drag pointer-up → end, release, reset cursor ---

test("T12c R-4: active drag pointer-up ends drag, releases capture, resets cursor", () => {
  const active = makeActive(sketchPointRef("p1"), 42);
  const result = resolveSketchDragGesture(active, {
    kind: "pointerUp",
    clientX: 200,
    clientY: 200,
    sketchPoint: [10, 10],
  });
  expect(result.phase.kind, "Drag end should transition to idle.").toBe("idle");
  expect(result.endDrag, "Drag end should dispatch end point.").toEqual([
    10, 10,
  ]);
  expect(result.releaseCapture, "Drag end should release capture.").toBe(42);
  expect(result.cursor, "Drag end should reset cursor.").toBe("");
  expect(result.consumed, "Drag end is consumed (no click dispatch).").toBe(
    true,
  );
  expect(
    result.cancelDragMove,
    "Drag end should cancel pending coalesced moves.",
  ).toBe(true);
});

// -- Gesture reducer: sub-threshold pointer-up → click ----------------------

test("T12c R-4: sub-threshold press-release is a click (not consumed)", () => {
  const target = sketchEntityRef("line_1");
  const pending = makePending(target, [5, 5], { x: 100, y: 100 });
  const result = resolveSketchDragGesture(pending, {
    kind: "pointerUp",
    clientX: 102,
    clientY: 102,
    sketchPoint: [5.1, 5.1],
  });
  expect(
    result.consumed,
    "Sub-threshold release should not be consumed (it is a click).",
  ).toBe(false);
  expect(
    result.phase.kind,
    "Sub-threshold release should transition to idle.",
  ).toBe("idle");
  expect(
    result.startDrag,
    "Sub-threshold release should not start a drag.",
  ).toBe(null);
  expect(result.endDrag, "Sub-threshold release should not end a drag.").toBe(
    null,
  );
});

// -- Gesture reducer: pointercancel and lostpointercapture cancel -----------

test("T12c R-4: pointercancel cancels active drag with capture release", () => {
  const active = makeActive(sketchPointRef("p1"), 7);
  const result = resolveSketchDragGesture(active, { kind: "pointerCancel" });
  expect(result.phase.kind, "pointercancel should transition to idle.").toBe(
    "idle",
  );
  expect(result.cancelDrag, "pointercancel should dispatch cancel.").toBe(true);
  expect(result.releaseCapture, "pointercancel should release capture.").toBe(
    7,
  );
  expect(result.cursor, "pointercancel should reset cursor.").toBe("");
});

test("T12c R-4: lostpointercapture cancels drag without re-releasing capture", () => {
  const active = makeActive(sketchPointRef("p1"), 7);
  const result = resolveSketchDragGesture(active, {
    kind: "lostPointerCapture",
  });
  expect(
    result.phase.kind,
    "lostpointercapture should transition to idle.",
  ).toBe("idle");
  expect(result.cancelDrag, "lostpointercapture should dispatch cancel.").toBe(
    true,
  );
  expect(
    result.releaseCapture,
    "lostpointercapture should NOT re-release capture.",
  ).toBe(null);
  expect(result.cursor, "lostpointercapture should reset cursor.").toBe("");
});

test("T12c R-4: own release does not double-cancel (idle phase at lostpointercapture)", () => {
  // After the component ends a drag, it clears phase to idle BEFORE calling
  // releasePointerCapture. The synchronous lostpointercapture sees idle.
  const idle: SketchDragGesturePhase = { kind: "idle" };
  const result = resolveSketchDragGesture(idle, {
    kind: "lostPointerCapture",
  });
  expect(
    result.cancelDrag,
    "Idle phase at lostpointercapture should not dispatch cancel.",
  ).toBe(false);
  expect(result.phase.kind, "Idle phase should remain idle.").toBe("idle");
});

// -- Gesture reducer: pointercancel clears stale pending --------------------

test("T12c R-4: pointercancel clears a stale pending gesture", () => {
  const pending = makePending(sketchPointRef("p1"));
  const result = resolveSketchDragGesture(pending, { kind: "pointerCancel" });
  expect(result.phase.kind, "pointercancel should clear pending to idle.").toBe(
    "idle",
  );
  expect(
    result.cancelDrag,
    "Pending pointercancel should not dispatch cancel (no drag was active).",
  ).toBe(false);
});

// -- Gesture reducer: right button cancels ----------------------------------

test("T12c R-4: right button during active drag cancels with release", () => {
  const active = makeActive(sketchEntityRef("line_1"), 3);
  const result = resolveSketchDragGesture(active, { kind: "rightButton" });
  expect(result.phase.kind).toBe("idle");
  expect(result.cancelDrag).toBe(true);
  expect(result.releaseCapture).toBe(3);
  expect(result.cursor).toBe("");
});

// -- Gesture reducer: drag release dispatches no click ----------------------

test("T12c R-4: drag release is consumed (no click dispatched)", () => {
  const active = makeActive(sketchPointRef("p1"), 1);
  const endResult = resolveSketchDragGesture(active, {
    kind: "pointerUp",
    clientX: 200,
    clientY: 200,
    sketchPoint: [10, 10],
  });
  expect(
    endResult.consumed,
    "A drag release must be consumed so no click is dispatched.",
  ).toBe(true);

  // Fast drag (pending + over threshold pointer-up) is also consumed.
  const pending = makePending(sketchPointRef("p1"), [5, 5], {
    x: 100,
    y: 100,
  });
  const fastResult = resolveSketchDragGesture(pending, {
    kind: "pointerUp",
    clientX: 200,
    clientY: 100,
    sketchPoint: [15, 5],
  });
  expect(
    fastResult.consumed,
    "A fast drag release must be consumed so no click is dispatched.",
  ).toBe(true);
  expect(fastResult.startDrag, "Fast drag should dispatch start.").not.toBe(
    null,
  );
  expect(fastResult.endDrag, "Fast drag should dispatch end.").toEqual([15, 5]);
});

// -- D3: cycle-then-drag drags the selected covered entry -------------------

test("T12c R-4: cycle-then-drag drags the selected covered entry (D3)", () => {
  const def = makeDefinition(
    [point("p1"), point("p2"), point("p3"), point("p4")],
    [lineEntity("line_1", "p1", "p2"), lineEntity("line_2", "p3", "p4")],
  );
  const stack = [
    { target: sketchEntityRef("line_1") },
    { target: sketchEntityRef("line_2") },
  ];
  // After cycling, line_2 is selected. D3 should drag line_2, not line_1.
  const selection: PrimitiveRef[] = [sketchEntityRef("line_2")];
  const dragTarget = resolveSketchDragTarget(stack, selection, def);
  expect(dragTarget, "D3 should pick the selected covered entry.").toEqual(
    sketchEntityRef("line_2"),
  );

  // Then the gesture proceeds through the reducer.
  const pending = makePending(dragTarget!, [5, 5], { x: 100, y: 100 });
  const dx = SKETCH_DRAG_THRESHOLD_PX + 1;
  const actions = resolveSketchDragGesture(pending, {
    kind: "pointerMove",
    clientX: 100 + dx,
    clientY: 100,
    pointerId: 1,
    sketchPoint: [8, 5],
  });
  expect(
    actions.startDrag?.target,
    "The drag should start on the selected covered entry.",
  ).toEqual(sketchEntityRef("line_2"));
});

// -- Grab offset: startPoint flows through the gesture ----------------------

test("T12c R-4: drag start preserves the pointer-down startPoint (grab offset)", () => {
  const target = sketchPointRef("p1");
  const pendingStartPoint: readonly [number, number] = [3.14, 2.72];
  const pending = makePending(target, pendingStartPoint, { x: 50, y: 50 });
  const dx = SKETCH_DRAG_THRESHOLD_PX + 1;
  const actions = resolveSketchDragGesture(pending, {
    kind: "pointerMove",
    clientX: 50 + dx,
    clientY: 50,
    pointerId: 1,
    sketchPoint: [10, 2.72],
  });
  expect(
    actions.startDrag?.startPoint,
    "The drag start must carry the pointer-down projected point, not the target position.",
  ).toEqual([3.14, 2.72]);
});

// ── T12d: zero-capture helper ──────────────────────────────────────────

test("T12d: zero capture inside threshold", () => {
  expect(
    shouldCaptureZeroTangentHandle({ x: 100, y: 200 }, { x: 100, y: 200 }),
    "Coincident tip and fit point → capture.",
  ).toBe(true);
  expect(
    shouldCaptureZeroTangentHandle(
      { x: 100 + TANGENT_HANDLE_ZERO_CAPTURE_PX - 1, y: 200 },
      { x: 100, y: 200 },
    ),
    "Within threshold → capture.",
  ).toBe(true);
});

test("T12d: zero capture outside threshold", () => {
  expect(
    shouldCaptureZeroTangentHandle(
      { x: 100 + TANGENT_HANDLE_ZERO_CAPTURE_PX + 1, y: 200 },
      { x: 100, y: 200 },
    ),
    "Outside threshold → no capture.",
  ).toBe(false);
});

test("T12d: same sketch distance, two zooms → different capture decisions", () => {
  // The capture helper operates on screen px, but the *same sketch-space*
  // distance maps to different screen-px distances at different zoom levels.
  // At low zoom (zoomed out), 0.5 sketch units → 4 screen px → inside 6 px.
  const lowZoomPxPerUnit = 8;
  const sketchDistance = 0.5;
  const lowZoomScreenPx = sketchDistance * lowZoomPxPerUnit; // 4 px
  expect(
    shouldCaptureZeroTangentHandle(
      { x: 100 + lowZoomScreenPx, y: 200 },
      { x: 100, y: 200 },
    ),
    "At low zoom, 0.5 sketch units → 4 screen px → captured.",
  ).toBe(true);
  // At high zoom (zoomed in), 0.5 sketch units → 40 screen px → outside 6 px.
  const highZoomPxPerUnit = 80;
  const highZoomScreenPx = sketchDistance * highZoomPxPerUnit; // 40 px
  expect(
    shouldCaptureZeroTangentHandle(
      { x: 100 + highZoomScreenPx, y: 200 },
      { x: 100, y: 200 },
    ),
    "At high zoom, 0.5 sketch units → 40 screen px → NOT captured.",
  ).toBe(false);
});
