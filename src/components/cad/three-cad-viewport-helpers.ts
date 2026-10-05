import * as THREE from "three";

import type {
  SketchSessionDisplayRenderable,
  SketchSessionState,
  SketchAuthoringToolId,
  SketchSessionStatus,
} from "@/domain/editor/sketch-session";
import { shouldViewportStartSketchGeometryDrag } from "@/domain/editor/workbench-interactions";
import { resolveHandleFromTarget } from "@/domain/editor/sketch-session/drag-intent";
import {
  getSketchToolDefinition,
  isRegisteredSketchToolId,
} from "@/core/sketch-tools/registry";
import type { SectionViewSession } from "@/core/section-view/session";
import { getSectionPlaneOrigin } from "@/core/section-view/session";
import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel,
  type PrimitiveRef,
  type SelectionFilter,
} from "@/core/editor/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import {
  DEFAULT_LINE_PICK_THRESHOLD,
  applyWireMaterialDepthPolicy,
  getBoundTarget,
  type PickResolutionOptions,
} from "@/infrastructure/viewport/render-picking";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";

export const WORKSPACE_SCAFFOLD_RENDER_ORDER = 0;
const MEASURE_LINE_PICK_THRESHOLD = 0.12;
const MEASURE_WIRE_OCCLUSION_TOLERANCE = 0.001;
const POINTER_BUTTON_SECONDARY = 2;
const POINTER_BUTTON_AUXILIARY = 4;

interface MutableRef<T> {
  current: T;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface ViewportPoint {
  x: number;
  y: number;
}

interface DragPoint {
  x: number;
  y: number;
}

interface RenderIdleSample {
  delta: number;
  isEditorIdle: boolean;
  sceneKey: string;
}

interface ViewCubeRenderer {
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
}

export function scheduleCoalescedSketchGeometryDragMove(input: {
  point: readonly [number, number];
  pendingPointRef: MutableRef<readonly [number, number] | null>;
  pendingFrameIdRef: MutableRef<number | null>;
  requestFrame: (callback: FrameRequestCallback) => number;
  isDragActive: () => boolean;
  onMove: (point: readonly [number, number]) => void;
}) {
  input.pendingPointRef.current = input.point;

  if (input.pendingFrameIdRef.current !== null) {
    return;
  }

  input.pendingFrameIdRef.current = input.requestFrame(() => {
    input.pendingFrameIdRef.current = null;
    const point = input.pendingPointRef.current;
    input.pendingPointRef.current = null;

    if (point && input.isDragActive()) {
      input.onMove(point);
    }
  });
}

export function cancelCoalescedSketchGeometryDragMove(input: {
  pendingPointRef: MutableRef<readonly [number, number] | null>;
  pendingFrameIdRef: MutableRef<number | null>;
  cancelFrame: (frameId: number) => void;
}) {
  if (input.pendingFrameIdRef.current !== null) {
    input.cancelFrame(input.pendingFrameIdRef.current);
  }

  input.pendingFrameIdRef.current = null;
  input.pendingPointRef.current = null;
}

export function getViewCubeRenderSizePx(
  cubeElement: Pick<HTMLElement, "clientWidth" | "clientHeight">,
) {
  return Math.max(
    1,
    Math.floor(Math.min(cubeElement.clientWidth, cubeElement.clientHeight)),
  );
}

export function resizeViewCubeRenderer(input: {
  cubeElement: Pick<HTMLElement, "clientWidth" | "clientHeight">;
  renderer: ViewCubeRenderer;
}) {
  const cubeSize = getViewCubeRenderSizePx(input.cubeElement);
  input.renderer.setSize(cubeSize, cubeSize, true);

  return cubeSize;
}

export function configureWorkspaceScaffoldWireObject<
  TObject extends THREE.Object3D & {
    material: THREE.Material | THREE.Material[];
  },
>(object: TObject): TObject {
  object.renderOrder = WORKSPACE_SCAFFOLD_RENDER_ORDER;
  applyWireMaterialDepthPolicy(object.material);

  return object;
}

export function isViewportNavigationPointerMove(buttons: number) {
  return (
    (buttons & (POINTER_BUTTON_SECONDARY | POINTER_BUTTON_AUXILIARY)) !== 0
  );
}

/**
 * A fit-point release within this many client pixels of the previous one
 * is the second release of a double-click, not a new fit point (T11-D13).
 */
export const SKETCH_FIT_POINT_RELEASE_DEDUP_PX = 4;

type SketchFitPointSession = Pick<
  SketchSessionState,
  "activeTool" | "status"
> | null;

/** Whether the armed tool is a fit-point tool (Spline, `lifecycle.kind`). */
function isSketchFitPointToolArmed(session: SketchFitPointSession) {
  return (
    session?.activeTool != null &&
    isRegisteredSketchToolId(session.activeTool) &&
    typeof getSketchToolDefinition(session.activeTool).lifecycle === "object"
  );
}

/** Whether the armed fit-point tool has a draft (T11-D13). */
export function isSketchFitPointDraftActive(session: SketchFitPointSession) {
  return session?.status === "drawing" && isSketchFitPointToolArmed(session);
}

/**
 * The viewport's fit-point release de-duplication (T11-D13): a release
 * within `SKETCH_FIT_POINT_RELEASE_DEDUP_PX` of the previous fit-point
 * release, while that draft is still drawing, is not dispatched (the
 * double-click's `dblclick` finalizes instead). `record` is the release the
 * next one is compared with, kept only while a fit-point tool is armed.
 */
export function resolveSketchFitPointRelease(input: {
  session: SketchFitPointSession;
  previous: { x: number; y: number } | null;
  release: { x: number; y: number };
}): { dispatch: boolean; record: { x: number; y: number } | null } {
  const { session, previous, release } = input;

  if (
    previous &&
    isSketchFitPointDraftActive(session) &&
    Math.hypot(release.x - previous.x, release.y - previous.y) <=
      SKETCH_FIT_POINT_RELEASE_DEDUP_PX
  ) {
    return { dispatch: false, record: previous };
  }

  return {
    dispatch: true,
    record: isSketchFitPointToolArmed(session) ? release : null,
  };
}

export function getViewportPickTuning(
  selectionFilter: SelectionFilter | null,
): {
  linePickThreshold: number;
  resolutionOptions: PickResolutionOptions;
} {
  if (selectionFilter?.kind === "measureTargets") {
    return {
      linePickThreshold: MEASURE_LINE_PICK_THRESHOLD,
      resolutionOptions: {
        wireOcclusionTolerance: MEASURE_WIRE_OCCLUSION_TOLERANCE,
      },
    };
  }

  return {
    linePickThreshold: DEFAULT_LINE_PICK_THRESHOLD,
    resolutionOptions: {},
  };
}

export function createViewportBvhSceneKey(
  renderables: readonly ViewportRenderableRecord[],
  sketchDisplayRenderables: readonly SketchSessionDisplayRenderable[],
) {
  return [
    ...renderables.map(({ origin, renderable }) => {
      return `${origin}:${renderable.id}:${renderable.binding.pickId}:${getGeometryToken(renderable.geometry)}`;
    }),
    ...sketchDisplayRenderables.map((renderable) => {
      return [
        "sketch",
        renderable.id,
        renderable.linePattern,
        renderable.semanticClass ?? "default",
        renderable.target ? JSON.stringify(renderable.target) : "none",
        getSketchStructuralGeometryToken(renderable.geometry),
        renderable.textureFill?.sourceKey ?? "no-texture",
      ].join(":");
    }),
  ].join("|");
}

export function createViewportInvalidationKey(input: {
  sceneKey: string;
  hoverTargetKey: string;
  selectionKeys: readonly string[];
  sketchFeedbackKey: string;
  measurementWitnessCount: number;
  sectionViewKey: string;
  clippingKey: string;
  lodKey: string;
  projectionMode: string;
  themeKey: string;
  fitViewRequestId: number;
  transitionVersion: number;
}) {
  return [
    input.sceneKey,
    input.hoverTargetKey,
    input.selectionKeys.join(","),
    input.sketchFeedbackKey,
    input.measurementWitnessCount,
    input.sectionViewKey,
    input.clippingKey,
    input.lodKey,
    input.projectionMode,
    input.themeKey,
    input.fitViewRequestId,
    input.transitionVersion,
  ].join("|");
}

export function projectSceneTargetCentroidToViewport(input: {
  root: THREE.Object3D | null;
  camera: THREE.Camera | null;
  objectId: string;
  viewport: ViewportSize;
}) {
  if (
    !input.root ||
    !input.camera ||
    input.viewport.width <= 0 ||
    input.viewport.height <= 0
  ) {
    return null;
  }

  const targetBox = new THREE.Box3();
  let foundTarget = false;

  input.root.traverse((object) => {
    const target = getBoundTarget(object);

    if (!target) {
      return;
    }

    const matchesTarget =
      object.name === input.objectId ||
      getPrimitiveRefLabel(target) === input.objectId ||
      getPrimitiveRefKey(target) === input.objectId;

    if (!matchesTarget) {
      return;
    }

    const objectBox = new THREE.Box3().setFromObject(object);
    if (objectBox.isEmpty()) {
      return;
    }

    targetBox.union(objectBox);
    foundTarget = true;
  });

  if (!foundTarget || targetBox.isEmpty()) {
    return null;
  }

  input.camera.updateMatrixWorld();
  const centroid = targetBox.getCenter(new THREE.Vector3());

  return projectWorldPointToViewport({
    camera: input.camera,
    point: centroid,
    viewport: input.viewport,
  });
}

export function projectWorldPointToViewport(input: {
  camera: THREE.Camera | null;
  point: THREE.Vector3 | readonly [number, number, number];
  viewport: ViewportSize;
}): ViewportPoint | null {
  if (
    !input.camera ||
    input.viewport.width <= 0 ||
    input.viewport.height <= 0
  ) {
    return null;
  }

  input.camera.updateMatrixWorld();

  const worldPoint =
    input.point instanceof THREE.Vector3
      ? input.point.clone()
      : new THREE.Vector3(input.point[0], input.point[1], input.point[2]);
  const projected = worldPoint.project(input.camera);

  if (
    projected.x < -1 ||
    projected.x > 1 ||
    projected.y < -1 ||
    projected.y > 1 ||
    projected.z < -1 ||
    projected.z > 1
  ) {
    return null;
  }

  return {
    x: ((projected.x + 1) / 2) * input.viewport.width,
    y: ((1 - projected.y) / 2) * input.viewport.height,
  };
}

export function resolveSectionScreenDragOffset(input: {
  camera: THREE.Camera | null;
  viewport: ViewportSize;
  sectionAtDragStart: SectionViewSession;
  dragStartClientPoint: DragPoint;
  currentClientPoint: DragPoint;
}) {
  if (
    !input.camera ||
    input.viewport.width <= 0 ||
    input.viewport.height <= 0
  ) {
    return null;
  }

  const handlePosition = getSectionPlaneOrigin(input.sectionAtDragStart);
  const projectedHandleCenter = projectWorldPointToViewport({
    camera: input.camera,
    point: handlePosition,
    viewport: input.viewport,
  });

  if (!projectedHandleCenter) {
    return null;
  }

  const axisDirection = input.sectionAtDragStart.plane.frame.normal;
  const projectedAxisPoint = projectWorldPointToViewport({
    camera: input.camera,
    point: [
      handlePosition[0] + axisDirection[0],
      handlePosition[1] + axisDirection[1],
      handlePosition[2] + axisDirection[2],
    ],
    viewport: input.viewport,
  });

  const dragDelta = {
    x: input.currentClientPoint.x - input.dragStartClientPoint.x,
    y: input.currentClientPoint.y - input.dragStartClientPoint.y,
  };

  if (projectedAxisPoint) {
    const axisVector = {
      x: projectedAxisPoint.x - projectedHandleCenter.x,
      y: projectedAxisPoint.y - projectedHandleCenter.y,
    };
    const axisLength = Math.hypot(axisVector.x, axisVector.y);

    if (axisLength >= 1) {
      const axisUnit = {
        x: axisVector.x / axisLength,
        y: axisVector.y / axisLength,
      };
      const projectedPixels =
        dragDelta.x * axisUnit.x + dragDelta.y * axisUnit.y;

      return input.sectionAtDragStart.offset + projectedPixels / axisLength;
    }
  }

  const fallbackWorldPerPixel =
    getViewportWorldHeightAtPoint(input.camera, handlePosition) /
    input.viewport.height;
  const fallbackViewDirection = input.camera.getWorldDirection(
    new THREE.Vector3(),
  );
  const fallbackDirectionSign =
    fallbackViewDirection.dot(new THREE.Vector3(...axisDirection)) <= 0
      ? 1
      : -1;

  return (
    input.sectionAtDragStart.offset -
    dragDelta.y * fallbackWorldPerPixel * fallbackDirectionSign
  );
}

function getViewportWorldHeightAtPoint(
  camera: THREE.Camera,
  point: readonly [number, number, number],
) {
  if (camera instanceof THREE.OrthographicCamera) {
    return (camera.top - camera.bottom) / camera.zoom;
  }

  if (camera instanceof THREE.PerspectiveCamera) {
    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    const distance = cameraPosition.distanceTo(
      new THREE.Vector3(point[0], point[1], point[2]),
    );

    return 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  }

  return 1;
}

export function createRenderIdleTracker(
  options: {
    maxStableDelta?: number;
    requiredStableFrames?: number;
  } = {},
) {
  const maxStableDelta = options.maxStableDelta ?? 0.5;
  const requiredStableFrames = options.requiredStableFrames ?? 3;
  let stableFrameCount = 0;
  let lastSceneKey: string | null = null;

  return {
    update(sample: RenderIdleSample) {
      const sceneChanged =
        lastSceneKey !== null && lastSceneKey !== sample.sceneKey;
      const visuallyStable = sample.delta <= maxStableDelta && !sceneChanged;

      lastSceneKey = sample.sceneKey;

      if (!sample.isEditorIdle || !visuallyStable) {
        stableFrameCount = 0;
        return false;
      }

      stableFrameCount += 1;
      return stableFrameCount >= requiredStableFrames;
    },
  };
}

export function getSketchStructuralGeometryToken(
  geometry: SketchSessionDisplayRenderable["geometry"],
) {
  switch (geometry.kind) {
    case "mesh":
      return `mesh:${geometry.vertexPositions.length}:${geometry.triangleIndices.length}`;
    case "polyline":
      return `polyline:${geometry.isClosed ? "closed" : "open"}:${geometry.points.length}`;
    case "marker":
      return `marker:${geometry.displayRadius}`;
  }
}

function getGeometryToken(
  geometry:
    | ViewportRenderableRecord["renderable"]["geometry"]
    | SketchSessionDisplayRenderable["geometry"],
) {
  switch (geometry.kind) {
    case "mesh":
      return [
        "mesh",
        geometry.vertexPositions.flat().join(","),
        geometry.triangleIndices.flat().join(","),
        geometry.vertexNormals
          ? geometry.vertexNormals.flat().join(",")
          : "auto-normals",
      ].join(":");
    case "polyline":
      return [
        "polyline",
        geometry.points.flat().join(","),
        geometry.isClosed ? "closed" : "open",
      ].join(":");
    case "marker":
      return [
        "marker",
        geometry.position.join(","),
        geometry.displayRadius,
      ].join(":");
  }
}

// ---------------------------------------------------------------------------
// Sketch drag gesture helpers (R-4)
// ---------------------------------------------------------------------------

/** 6 screen-px click-vs-drag threshold. */
export const SKETCH_DRAG_THRESHOLD_PX = 6;

/** The phase of the viewport's sketch drag gesture. */
export type SketchDragGesturePhase =
  | { kind: "idle" }
  | {
      kind: "pending";
      target: PrimitiveRef;
      startPoint: readonly [number, number];
      pointerDown: { x: number; y: number };
    }
  | { kind: "active"; target: PrimitiveRef; pointerId: number };

/** Events the sketch drag gesture reducer processes. */
export type SketchDragGestureEvent =
  | {
      kind: "pointerMove";
      clientX: number;
      clientY: number;
      pointerId: number;
      sketchPoint: readonly [number, number] | null;
    }
  | {
      kind: "pointerUp";
      clientX: number;
      clientY: number;
      sketchPoint: readonly [number, number] | null;
    }
  | { kind: "rightButton" }
  | { kind: "pointerCancel" }
  | { kind: "lostPointerCapture" };

/** Actions the viewport must execute after a gesture decision. */
export interface SketchDragGestureActions {
  /** New gesture phase. */
  phase: SketchDragGesturePhase;
  /** Dispatch drag start with target and startPoint. */
  startDrag: {
    target: PrimitiveRef;
    startPoint: readonly [number, number];
  } | null;
  /** Schedule a coalesced drag move to this point. */
  scheduleDragMove: readonly [number, number] | null;
  /** Dispatch drag end at this point. */
  endDrag: readonly [number, number] | null;
  /** Dispatch drag cancel. */
  cancelDrag: boolean;
  /** Cancel the coalesced drag move animation frame. */
  cancelDragMove: boolean;
  /** Set pointer capture on this pointer ID. */
  requestCapture: number | null;
  /** Release pointer capture for this pointer ID. */
  releaseCapture: number | null;
  /** Set the cursor: `"grabbing"` during drag, `""` for reset. `null` = no change. */
  cursor: "grabbing" | "" | null;
  /** Whether the event is consumed (component should return early). */
  consumed: boolean;
  /** Call `preventDefault` / `stopPropagation` on the event. */
  preventDefault: boolean;
}

/**
 * Sketch drag gesture reducer: given the current gesture phase and a pointer
 * event, return the actions the viewport must execute.
 *
 * The reducer owns all threshold, capture, cursor, cancel, and click-suppression
 * decisions. The component owns ref management, sketch-point projection, pick
 * resolution, and callback dispatch.
 */
export function resolveSketchDragGesture(
  phase: SketchDragGesturePhase,
  event: SketchDragGestureEvent,
): SketchDragGestureActions {
  const noop: SketchDragGestureActions = {
    phase,
    startDrag: null,
    scheduleDragMove: null,
    endDrag: null,
    cancelDrag: false,
    cancelDragMove: false,
    requestCapture: null,
    releaseCapture: null,
    cursor: null,
    consumed: false,
    preventDefault: false,
  };

  if (event.kind === "pointerMove") {
    if (phase.kind === "active") {
      return {
        ...noop,
        scheduleDragMove: event.sketchPoint,
        cursor: "grabbing",
        consumed: true,
      };
    }
    if (phase.kind === "pending") {
      const distance = Math.hypot(
        event.clientX - phase.pointerDown.x,
        event.clientY - phase.pointerDown.y,
      );
      if (distance > SKETCH_DRAG_THRESHOLD_PX) {
        if (event.sketchPoint) {
          return {
            ...noop,
            phase: {
              kind: "active",
              target: phase.target,
              pointerId: event.pointerId,
            },
            startDrag: {
              target: phase.target,
              startPoint: phase.startPoint,
            },
            scheduleDragMove: event.sketchPoint,
            requestCapture: event.pointerId,
            cursor: "grabbing",
            consumed: true,
            preventDefault: true,
          };
        }
        // Over threshold but sketch projection failed: consumed, no drag start.
        return { ...noop, consumed: true };
      }
      return noop; // Under threshold — not consumed; hover logic continues.
    }
    return noop;
  }

  if (event.kind === "pointerUp") {
    if (phase.kind === "active") {
      return {
        ...noop,
        phase: { kind: "idle" },
        endDrag: event.sketchPoint,
        cancelDragMove: true,
        releaseCapture: phase.pointerId,
        cursor: "",
        consumed: true,
      };
    }
    if (phase.kind === "pending") {
      const distance = Math.hypot(
        event.clientX - phase.pointerDown.x,
        event.clientY - phase.pointerDown.y,
      );
      if (distance > SKETCH_DRAG_THRESHOLD_PX) {
        if (event.sketchPoint) {
          // Fast drag: start + end in one gesture.
          return {
            ...noop,
            phase: { kind: "idle" },
            startDrag: {
              target: phase.target,
              startPoint: phase.startPoint,
            },
            endDrag: event.sketchPoint,
            consumed: true,
          };
        }
        // Over threshold, no sketch point: consumed but no drag.
        return { ...noop, phase: { kind: "idle" }, consumed: true };
      }
      // Sub-threshold: it's a click. Phase → idle, not consumed.
      return { ...noop, phase: { kind: "idle" } };
    }
    return noop;
  }

  if (event.kind === "rightButton") {
    if (phase.kind === "active") {
      return {
        ...noop,
        phase: { kind: "idle" },
        cancelDrag: true,
        cancelDragMove: true,
        releaseCapture: phase.pointerId,
        cursor: "",
      };
    }
    return { ...noop, phase: { kind: "idle" }, cancelDragMove: true };
  }

  if (event.kind === "pointerCancel") {
    if (phase.kind === "active") {
      return {
        ...noop,
        phase: { kind: "idle" },
        cancelDrag: true,
        cancelDragMove: true,
        releaseCapture: phase.pointerId,
        cursor: "",
      };
    }
    // Clear stale pending (the pointer is done; no pointer-up will follow).
    if (phase.kind === "pending") {
      return { ...noop, phase: { kind: "idle" } };
    }
    return noop;
  }

  if (event.kind === "lostPointerCapture") {
    if (phase.kind === "active") {
      return {
        ...noop,
        phase: { kind: "idle" },
        cancelDrag: true,
        cancelDragMove: true,
        cursor: "",
        // No releaseCapture: capture is already lost.
      };
    }
    return noop;
  }

  return noop;
}

/**
 * Whether the pointer is hovering a draggable sketch target, producing a
 * `grab` cursor. The viewport calls this during hover resolution.
 */
export function isSketchDragHoverTarget(
  session: {
    activeTool: SketchAuthoringToolId | null | undefined;
    status: SketchSessionStatus | null | undefined;
    activeSpecialMode?: unknown;
  } | null,
  target: PrimitiveRef | null,
  definition: SketchDefinition | null | undefined,
): boolean {
  if (!session || session.activeSpecialMode) {
    return false;
  }
  if (
    !shouldViewportStartSketchGeometryDrag(session.activeTool, session.status)
  ) {
    return false;
  }
  if (!target || !definition) {
    return false;
  }
  return resolveHandleFromTarget(definition, target) !== null;
}
