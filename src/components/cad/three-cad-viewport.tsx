// SLOP: Retained viewport renderer while the workbench/viewport port boundary is introduced and hidden context reads are removed.
import { Button } from "@mantine/core";
import { ViewportCanvas } from "@/components/cad/viewport-canvas";
import { WebGlRecoveryPanel } from "@/components/layout/webgl-recovery-panel";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import {
  createReportedWebGlRenderer,
  WebGlInitializationError,
  type WebGlSurface,
} from "@/infrastructure/viewport/webgl-renderer";
import {
  noopPerformanceTelemetry,
  type PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import { Bvh, OrbitControls } from "@react-three/drei";
import { flushViewportCameraDamping } from "@/infrastructure/viewport/viewport-camera-damping";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import { SketchViewportFeedbackLayer } from "@/components/cad/sketch-viewport-feedback";
import { SketchDragFeedbackCue } from "@/components/cad/sketch-drag-feedback-cue";
import { SketchSpecialModeViewportFeedback } from "@/components/cad/sketch-special-mode-viewport-feedback";
import { SketchConstraintAnnotations } from "@/components/cad/sketch-constraint-annotations";
import { isSketchAnnotationIdleContext } from "@/components/cad/sketch-constraint-annotation-visibility";
import { shouldApplySketchDisplayStyles } from "@/components/cad/sketch-display-style";
import { resolveSketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import {
  collectSketchViewportFeedbackAnchors,
  getAnnotationProjectionId,
  getSketchToolLabelObstacles,
  type SketchAnnotationLayoutObstacle,
  type SketchAnnotationLayoutViewport,
  type SketchViewportFeedbackProjection,
} from "@/components/cad/sketch-viewport-feedback-model";
import {
  collectSketchSpecialModeFeedbackAnchors,
  type SketchSpecialModeFeedbackProjection,
} from "@/components/cad/sketch-special-mode-feedback-model";
import {
  createDimensionAnnotationPlacementPatch,
  getDimensionLabelDragPoint,
} from "@/components/cad/three-cad-viewport-annotation-drag";
import {
  requestViewCubeCameraTransition,
  resolveSketchCameraTransition,
  type SketchCameraTransitionState,
} from "@/components/cad/three-cad-viewport-camera-transitions";
import {
  createViewCubeScene,
  resolveViewCubePresetId,
  updateViewCubeVisibility,
} from "@/components/cad/three-cad-viewport-view-cube";
import { DocumentRenderableNode } from "@/components/cad/three-cad-viewport-document-nodes";
import { ViewportInitialCameraFraming } from "@/components/cad/viewport-initial-camera-framing";
import { SketchDisplayRenderableNode } from "@/components/cad/three-cad-viewport-sketch-nodes";
import {
  collectProjectedSketchCurveCandidates,
  collectProjectedSketchDisplayPointCandidates,
  collectProjectedVertexCandidates,
  createSketchPickCycleWiring,
  getAnnotationHighlightTargets,
  getSketchPickChooserTargets,
  getSketchPickPreviewTarget,
  isAnnotationTarget,
  resolveSketchPickChoice,
  resolveSketchPickClick,
  type SketchPickCycleWiring,
  updatePointerFromClientPoint,
} from "@/components/cad/three-cad-viewport-pick-candidates";
import { SketchPickHint } from "@/components/cad/sketch-pick-hint";
import {
  SKETCH_NEAR_GAP_GLYPH_MIN_PX,
  SketchNearGapGlyphs,
} from "@/components/cad/sketch-near-gap-glyphs";
import { computeSketchUnitsPerPixel } from "@/components/cad/sketch-snap-scale";
import {
  SketchPickChooser,
  type SketchPickChooserModel,
} from "@/components/cad/sketch-pick-chooser";
import { useDwellHint } from "@/hooks/dwell-hint";
import {
  createSketchNearGapHint,
  getSketchNearGapHintPointIds,
  createSketchPickChooserItems,
  createSketchPickHint,
  handleSketchPickChooserKeyDown,
  SKETCH_PICK_HINT_LEFT_PX,
  type SketchPickChooserItem,
  type SketchPickHintModel,
} from "@/components/cad/sketch-pick-hint-model";
import {
  SectionCapLayer,
  SectionViewOverlay,
} from "@/components/cad/three-cad-viewport-section";
import {
  BodyLodWatcher,
  FirstNonEmptyGeometryFrameSignal,
  MeasurementWitnessLayer,
  RenderIdleSignal,
  SketchProjectionFrameWatcher,
  ViewportInvalidationBridge,
  ViewportCameraTransitionDriver,
  ViewportProjectionCameraController,
  ViewportPickRoot,
  ViewportProjectionSelector,
  WorkspaceSceneScaffold,
} from "@/components/cad/three-cad-viewport-inner-components";
import {
  type PrimitiveRef,
  getPrimitiveRefKey,
  primitiveRefEquals,
  selectionFilterAllowsTarget,
} from "@/core/editor/schema";
import {
  getSectionPlaneOrigin,
  type SectionViewSession,
  type Vec3,
} from "@/core/section-view/session";
import type { SketchSpecialModeHandleRef } from "@/core/sketch-special-modes/schema";
import {
  collectBindings,
  collectRaycastPickCandidates,
  type CollectedBindings,
  intersectObjectsWithLinePickRadius,
  isSeededDatumPlaneRenderable,
  type PickResult,
  resolveAllCandidates,
  toSketchPickStackCandidates,
  updateWorkspaceHighlight,
} from "@/infrastructure/viewport/render-picking";
import {
  resolveSketchPickStack,
  type SketchPickClass,
  type SketchPickCycle,
} from "@/domain/sketch-interaction/pick-stack";
import {
  findNearGapEndpoints,
  getSketchNearGapBasis,
  type SketchNearGap,
} from "@/domain/sketch-interaction/near-gap";
import {
  createSketchPointRef,
  getSketchSessionDisplayDefinition,
} from "@/domain/editor/sketch-session/internals";
import type { SketchId } from "@/contracts/shared/ids";
import { mapSketchPointToWorld } from "@/domain/editor/sketch-session/state";
import {
  getSketchRevealedPointIds,
  getSketchRevealedHandleEntityIds,
  getSketchToolMarkerPointIds,
} from "@/domain/editor/sketch-session/display";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { createViewportCameraTransitionController } from "@/infrastructure/viewport/viewport-camera-transition";
import {
  getViewportCanvasClickIntent,
  resolveSketchDragTarget,
  shouldViewportClickEventRequestConnectedSketchSelection,
  shouldViewportDoubleClickRequestConnectedSketchSelection,
  shouldViewportStartSketchGeometryDrag,
} from "@/domain/editor/workbench-interactions";
import type { ViewportCameraControls } from "@/infrastructure/viewport/viewport-camera-controls";
import {
  DEFAULT_VIEWPORT_PROJECTION_MODE,
  applyViewportRenderableFitFrame,
  applyViewportCameraFrame,
  applyViewportCameraFrameToCamera,
  captureViewportCameraFrame,
  cloneViewportCameraFrame,
  createViewportCamera,
  getDefaultViewportCameraFrame,
  type ViewportCamera,
  type ViewportCameraFrame,
  type ViewportProjectionMode,
} from "@/infrastructure/viewport/viewport-projection";
import { computeSketchCameraFrame } from "@/infrastructure/viewport/sketch-camera-framing";
import type { OccTessellationTierId } from "@/domain/modeling/occ/tessellation";
import type { ViewNavigationPresetId } from "@/infrastructure/viewport/view-navigation";
import {
  createSectionCapRenderables,
  createSectionClippingPlane,
  getSectionRenderableBounds,
} from "@/infrastructure/section-view/rendering";
import { projectSketchFeedbackAnchor } from "@/core/workspace/sketch-feedback-projection";
import { useSketchInferenceSuppression } from "@/components/cad/use-sketch-inference-suppression";
import {
  mapWorldPointToWorkspaceSketch,
  type WorkspaceVec3,
} from "@/core/workspace/sketch-plane-mapping";
import {
  getLatestViewportFitViewRequestId,
  type ViewportCommand,
  type ViewportIntent,
  type ViewportModel,
} from "@/workbench/viewport/viewport-boundary";
import { isCadaraDebugPlatformEnabled } from "@/workbench/debug/cadara-debug-bridge";
import {
  LEGACY_VIEWPORT_HEIGHT_PX,
  LEGACY_VIEWPORT_LEFT_INSET_PX,
  LEGACY_VIEWPORT_WIDTH_PX,
  VIEWPORT_CANVAS_TOP_INSET_PX,
  VIEWPORT_OVERLAY_TOP_INSET_PX,
  VIEWPORT_OVERLAY_TOP_INSET_STYLE,
  VIEW_CUBE_SIZE_PX,
} from "@/components/cad/viewport-overlay-layout";
import {
  cancelCoalescedSketchGeometryDragMove,
  createViewportInvalidationKey,
  createViewportBvhSceneKey,
  getViewportPickTuning,
  isSketchDragHoverTarget,
  isSketchFitPointDraftActive,
  isViewportNavigationPointerMove,
  projectWorldPointToViewport,
  projectSceneTargetCentroidToViewport,
  resolveSketchDragGesture,
  shouldCaptureZeroTangentHandle,
  SKETCH_DRAG_THRESHOLD_PX,
  resolveSectionScreenDragOffset,
  createSketchStackPick,
  resolveSketchFitPointRelease,
  resizeViewCubeRenderer,
  scheduleCoalescedSketchGeometryDragMove,
  type SketchDragGestureActions,
  type SketchDragGesturePhase,
} from "@/components/cad/three-cad-viewport-helpers";

/** The sketch pick stack at one pointer position, with each entry's class. */
interface SketchStackPick {
  stack: (PickResult & { pickClass: SketchPickClass })[];
  displayDefinition: SketchDefinition;
  /** The display solve: D9′ judges drag targets against it. */
  solvedSnapshot: SolvedSketchSnapshot;
}

/** A stack and the client point it was resolved at. */
interface SketchStackPickAt {
  x: number;
  y: number;
  sketch: SketchStackPick;
}

/** The hovered sketch stack's targets and their member-set key (T11f). */
interface SketchHoverStack {
  key: string;
  targets: readonly PrimitiveRef[];
}

const EMPTY_SKETCH_HOVER_STACK: SketchHoverStack = { key: "", targets: [] };
const EMPTY_SKETCH_NEAR_GAPS: readonly SketchNearGap[] = [];

interface SketchAnnotationDomFrame {
  viewport: SketchAnnotationLayoutViewport;
  obstacles: readonly SketchAnnotationLayoutObstacle[];
}

const EMPTY_SKETCH_ANNOTATION_DOM_FRAME: SketchAnnotationDomFrame = {
  viewport: {
    width: 0,
    height: 0,
    topInset: VIEWPORT_OVERLAY_TOP_INSET_PX,
    bottomInset: 0,
  },
  obstacles: [],
};

/**
 * T14d: the marker attributes the workbench puts on `display: contents`
 * wrappers; the rects of their children are what the annotation layout reads.
 * `obstacles`: transient panels labels move clear of (left tool panel stack).
 * `chrome`: workbench chrome over the canvas (not usable canvas: anchors in it
 * are not rendered). `bottom-band`: full-width chrome along the bottom edge
 * (timeline, tabs); its top is the bottom of the usable band.
 */
const SKETCH_ANNOTATION_DOM_MARKERS = [
  "data-viewport-annotation-obstacles",
  "data-viewport-annotation-chrome",
  "data-viewport-annotation-bottom-band",
] as const;

/**
 * T14b/T14d review R-2: the pick hint's slot (overlap and near-gap chips,
 * `SKETCH_PICK_HINT_LEFT_PX`, top inset), reserved for the whole sketch
 * session so a hint appearing on hover never moves a label. The hint column
 * is capped at this width; two chips fit in this height.
 */
const SKETCH_PICK_HINT_SLOT_WIDTH_PX = 420;
const SKETCH_PICK_HINT_SLOT_HEIGHT_PX = 72;

/**
 * T14d: one read of the canvas rect, the top overlay inset (a CSS variable
 * that grows when the toolbar wraps), the bottom band, and the floating DOM
 * the annotation layout avoids, in canvas px.
 */
function readSketchAnnotationDomFrame(
  canvasElement: HTMLCanvasElement,
  viewportElement: HTMLElement,
  viewCubeColumn: HTMLElement | null,
): SketchAnnotationDomFrame {
  const canvasRect = canvasElement.getBoundingClientRect();
  const topInset = Number.parseFloat(
    getComputedStyle(viewportElement).getPropertyValue(
      "--workbench-viewport-overlay-top",
    ),
  );
  const root = viewportElement.parentElement;
  const rectsOf = (elements: Iterable<Element>) =>
    [...elements].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? [
            {
              x: rect.left - canvasRect.left,
              y: rect.top - canvasRect.top,
              width: rect.width,
              height: rect.height,
            },
          ]
        : [];
    });
  const [panels, chrome, bottomBand] = SKETCH_ANNOTATION_DOM_MARKERS.map(
    (marker) => rectsOf(root?.querySelectorAll(`[${marker}] > *`) ?? []),
  );
  // Re-review RR-1: the history Actions strip draws above its band element's
  // box, so it is chrome of its own (it changes with the session's actions,
  // which re-runs this read).
  const overflowingBandChrome = rectsOf(
    root?.querySelectorAll(
      "[data-viewport-annotation-bottom-band] [data-history-actions]",
    ) ?? [],
  );
  const bandTop = Math.min(
    canvasRect.height,
    ...bottomBand!.map((rect) => rect.y),
  );

  return {
    viewport: {
      width: canvasRect.width,
      height: canvasRect.height,
      topInset: Number.isFinite(topInset)
        ? topInset
        : VIEWPORT_OVERLAY_TOP_INSET_PX,
      bottomInset: Math.max(0, canvasRect.height - bandTop),
    },
    obstacles: [
      ...panels!,
      ...[
        ...chrome!,
        ...overflowingBandChrome,
        ...rectsOf(viewCubeColumn ? [viewCubeColumn] : []),
      ].map((rect) => ({ ...rect, chrome: true })),
    ],
  };
}

function sketchAnnotationDomFramesEqual(
  left: SketchAnnotationDomFrame,
  right: SketchAnnotationDomFrame,
) {
  const rectsEqual = (
    a: SketchAnnotationLayoutObstacle,
    b: SketchAnnotationLayoutObstacle,
  ) =>
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.chrome === b.chrome;

  return (
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height &&
    left.viewport.topInset === right.viewport.topInset &&
    left.viewport.bottomInset === right.viewport.bottomInset &&
    left.obstacles.length === right.obstacles.length &&
    left.obstacles.every((rect, index) =>
      rectsEqual(rect, right.obstacles[index]!),
    )
  );
}

interface ThreeCadViewportProps {
  model: ViewportModel;
  commands: readonly ViewportCommand[];
  onIntent: (intent: ViewportIntent) => void;
  performanceTelemetry?: PerformanceTelemetry;
  onGraphicsUnavailable: () => void;
}

export function ThreeCadViewport({
  performanceTelemetry = noopPerformanceTelemetry,
  onGraphicsUnavailable,
  ...props
}: ThreeCadViewportProps) {
  const reporter = useErrorReporter();
  const [failure, setFailure] = useState<WebGlInitializationError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const createRenderer = useCallback(
    (parameters: THREE.WebGLRendererParameters, surface: WebGlSurface) =>
      createReportedWebGlRenderer(
        parameters,
        surface,
        reporter,
        performanceTelemetry,
      ),
    [reporter, performanceTelemetry],
  );

  const handleGraphicsFailure = useCallback(
    (error: WebGlInitializationError) => {
      setFailure(error);
      onGraphicsUnavailable();
    },
    [onGraphicsUnavailable],
  );

  if (failure) {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-40 grid justify-items-center overflow-y-auto px-4 pb-14 md:pl-[268px]"
        style={{
          alignItems: "safe center",
          paddingTop: "var(--workbench-viewport-overlay-top)",
        }}
      >
        <WebGlRecoveryPanel
          diagnostics={failure.diagnostics}
          onRetry={() => {
            setAttempt((current) => current + 1);
            setFailure(null);
          }}
        />
      </div>
    );
  }

  return (
    <ThreeCadViewportScene
      {...props}
      key={attempt}
      createRenderer={createRenderer}
      onGraphicsFailure={handleGraphicsFailure}
    />
  );
}

function ThreeCadViewportScene({
  model,
  commands,
  onIntent,
  createRenderer,
  onGraphicsFailure,
}: Omit<ThreeCadViewportProps, "onGraphicsUnavailable" | "performanceTelemetry"> & {
  createRenderer: (
    parameters: THREE.WebGLRendererParameters,
    surface: WebGlSurface,
  ) => THREE.WebGLRenderer;
  onGraphicsFailure: (error: WebGlInitializationError) => void;
}) {
  const {
    activeSectionView,
    hoverTarget,
    measurementWitnesses,
    renderables,
    sketchDisplayRenderables,
    sketchAnnotations,
    selection,
    annotationContext,
    showAllAnnotations,
    sketchToolPresentation,
    specialModePresentation,
    hasNonEmptyCommittedGeometry,
    interaction,
    capabilities,
  } = model;
  const {
    mode,
    selectionFilter,
    selectionCatalog,
    sketchSession,
    isEditorRenderIdle,
  } = interaction;
  const fitViewRequestId = getLatestViewportFitViewRequestId(commands);
  const onHover = useCallback(
    (target: PrimitiveRef) => onIntent({ type: "hovered", target }),
    [onIntent],
  );
  const onSelect = useCallback(
    (
      target: PrimitiveRef,
      cameraPosition?: Vec3,
      cycleReplaces?: PrimitiveRef,
    ) =>
      onIntent({
        type: "selected",
        target,
        cameraPosition,
        ...(cycleReplaces ? { cycleReplaces } : {}),
      }),
    [onIntent],
  );
  const onConnectedSketchSelect = useCallback(
    (target: PrimitiveRef) =>
      onIntent({ type: "connectedSketchSelected", target }),
    [onIntent],
  );
  const onDeselect = useCallback(
    () => onIntent({ type: "deselected" }),
    [onIntent],
  );
  const onAnnotationEdit = useCallback(
    (target: Extract<PrimitiveRef, { kind: "constraint" | "dimension" }>) =>
      onIntent({ type: "annotationEditRequested", target }),
    [onIntent],
  );
  const onClearHover = useCallback(
    () => onIntent({ type: "hoverCleared" }),
    [onIntent],
  );
  const onSketchMove = useCallback(
    (point: readonly [number, number], sketchUnitsPerPixel: number | null) =>
      onIntent({ type: "sketchPointerMoved", point, sketchUnitsPerPixel }),
    [onIntent],
  );
  const onSketchRelease = useCallback(
    (
      point: readonly [number, number],
      sketchUnitsPerPixel: number | null,
      target?: PrimitiveRef | null,
    ) =>
      onIntent({
        type: "sketchPointerReleased",
        point,
        sketchUnitsPerPixel,
        target,
      }),
    [onIntent],
  );
  const onSketchDrawFinalize = useCallback(
    () => onIntent({ type: "sketchDrawFinalizeRequested" }),
    [onIntent],
  );
  const onSketchGeometryDragStart = useCallback(
    (target: PrimitiveRef, point: readonly [number, number]) =>
      onIntent({ type: "sketchGeometryDragStarted", target, point }),
    [onIntent],
  );
  const onSketchGeometryDragMove = useCallback(
    (point: readonly [number, number], options?: { exactZero?: boolean }) =>
      onIntent({ type: "sketchGeometryDragMoved", point, ...options }),
    [onIntent],
  );
  const onSketchGeometryDragEnd = useCallback(
    (point: readonly [number, number], options?: { exactZero?: boolean }) =>
      onIntent({ type: "sketchGeometryDragEnded", point, ...options }),
    [onIntent],
  );
  const onSketchGeometryDragCancel = useCallback(
    () => onIntent({ type: "sketchGeometryDragCancelled" }),
    [onIntent],
  );
  const onSpecialModeClick = useCallback(
    (point: readonly [number, number], target?: PrimitiveRef | null) =>
      onIntent({ type: "specialModeClicked", point, target }),
    [onIntent],
  );
  const onSpecialModeDoubleClick = useCallback(
    (point: readonly [number, number], target?: PrimitiveRef | null) =>
      onIntent({ type: "specialModeDoubleClicked", point, target }),
    [onIntent],
  );
  const onSpecialModeDragStart = useCallback(
    (handle: SketchSpecialModeHandleRef, point: readonly [number, number]) =>
      onIntent({ type: "specialModeDragStarted", handle, point }),
    [onIntent],
  );
  const onSpecialModeDragMove = useCallback(
    (handle: SketchSpecialModeHandleRef, point: readonly [number, number]) =>
      onIntent({ type: "specialModeDragMoved", handle, point }),
    [onIntent],
  );
  const onSpecialModeDragEnd = useCallback(
    (handle: SketchSpecialModeHandleRef, point: readonly [number, number]) =>
      onIntent({ type: "specialModeDragEnded", handle, point }),
    [onIntent],
  );
  const onSectionOffsetChange = useCallback(
    (offset: number) => onIntent({ type: "sectionOffsetChanged", offset }),
    [onIntent],
  );
  const onSectionFlip = useCallback(
    () => onIntent({ type: "sectionFlipRequested" }),
    [onIntent],
  );
  const onSectionClear = useCallback(
    () => onIntent({ type: "sectionClearRequested" }),
    [onIntent],
  );
  const onSketchToolPatch = useCallback(
    (patch: Record<string, unknown>) =>
      onIntent({ type: "sketchToolPatched", patch }),
    [onIntent],
  );
  const onLodTierChange = useCallback(
    (tierId: OccTessellationTierId) =>
      onIntent({ type: "lodTierChanged", tierId }),
    [onIntent],
  );
  const onCanvasCreated = useCallback(
    () => onIntent({ type: "canvasCreated" }),
    [onIntent],
  );
  const onFirstNonEmptyGeometryFrame = useCallback(
    () => onIntent({ type: "firstNonEmptyGeometryFrame" }),
    [onIntent],
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // T13-D22: Shift held suppresses placement inference.
  const onSketchInferenceHeldChange = useCallback(
    (held: boolean) =>
      onIntent({ type: "sketchInferenceSuppressionChanged", held }),
    [onIntent],
  );
  useSketchInferenceSuppression(
    sketchSession !== null,
    viewportRef,
    onSketchInferenceHeldChange,
  );
  const viewCubeRef = useRef<HTMLDivElement | null>(null);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef<ViewportCamera | null>(null);
  const controlsRef = useRef<ViewportCameraControls | null>(null);
  const controlsInitializedRef = useRef(false);
  const pendingProjectionFrameRef = useRef<ViewportCameraFrame | null>(null);
  const [canvasReadyVersion, setCanvasReadyVersion] = useState(0);
  const [controlsReadyVersion, setControlsReadyVersion] = useState(0);
  const [projectionMode, setProjectionMode] = useState<ViewportProjectionMode>(
    DEFAULT_VIEWPORT_PROJECTION_MODE,
  );
  const [sketchFeedbackProjections, setSketchFeedbackProjections] = useState<
    SketchViewportFeedbackProjection[]
  >([]);
  const [sketchAnnotationProjections, setSketchAnnotationProjections] =
    useState<SketchViewportFeedbackProjection[]>([]);
  const [sketchEntityScreenExtents, setSketchEntityScreenExtents] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const [specialModeFeedbackProjections, setSpecialModeFeedbackProjections] =
    useState<SketchSpecialModeFeedbackProjection[]>([]);
  // T13k (D26): the near gaps at their current screen positions.
  const [sketchNearGaps, setSketchNearGaps] = useState(EMPTY_SKETCH_NEAR_GAPS);
  // T14d: the canvas size, top overlay inset and floating DOM obstacles the
  // annotation layout reads (one DOM read per render, see below).
  const [sketchAnnotationDomFrame, setSketchAnnotationDomFrame] =
    useState<SketchAnnotationDomFrame>(EMPTY_SKETCH_ANNOTATION_DOM_FRAME);
  const sketchAnnotationDomFrameRef = useRef(sketchAnnotationDomFrame);
  const viewCubeColumnRef = useRef<HTMLDivElement | null>(null);
  const [dragFeedbackCue, setDragFeedbackCue] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const [viewportTransitionVersion, setViewportTransitionVersion] = useState(0);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const sketchPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const sketchHitPointRef = useRef(new THREE.Vector3());
  const primaryPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const sketchGeometryDragRef = useRef<{ target: PrimitiveRef } | null>(null);
  const sketchGeometryDragPointerIdRef = useRef<number | null>(null);
  const sectionDragRef = useRef<{
    pointerId: number;
    sectionAtDragStart: SectionViewSession;
    dragStartClientPoint: { x: number; y: number };
  } | null>(null);
  const sectionDragOffsetRef = useRef<number | null>(null);
  const pendingSketchGeometryDragPointRef = useRef<
    readonly [number, number] | null
  >(null);
  const pendingSketchGeometryDragExactZeroRef = useRef(false);
  const pendingSketchGeometryDragFrameIdRef = useRef<number | null>(null);
  const pendingSketchGeometryDragRef = useRef<{
    target: PrimitiveRef;
    startPoint: readonly [number, number];
  } | null>(null);
  const pickRootRef = useRef<THREE.Group | null>(null);
  const bindingsRef = useRef<CollectedBindings | null>(null);
  const bindingsSceneKeyRef = useRef<string | null>(null);
  const hoverRef = useRef(onHover);
  const hoverTargetRef = useRef(hoverTarget);
  const cameraTransitionControllerRef = useRef(
    createViewportCameraTransitionController(),
  );
  const projectionModeRef = useRef<ViewportProjectionMode>(
    DEFAULT_VIEWPORT_PROJECTION_MODE,
  );
  const sketchCameraStateRef = useRef<SketchCameraTransitionState>({
    activeSessionToken: null,
    preSketchFrame: null,
  });
  const lastPickedTargetRef = useRef<PrimitiveRef | null>(null);
  // The repeated-click cycle (T11d): a pure reducer's state kept in a ref,
  // and the pick resolved at the last pointer-up for its `click`.
  const pickCycleRef = useRef<SketchPickCycle | null>(null);
  // The last dispatched fit-point release, for the double-click
  // de-duplication (T11-D13).
  const fitPointReleaseRef = useRef<{ x: number; y: number } | null>(null);
  const releasedPickRef = useRef<{
    x: number;
    y: number;
    pick: {
      top: PickResult | null;
      sketch: SketchStackPick | null;
    };
  } | null>(null);
  // The open chooser's pick context (T11-D6). The displayed hint owns its
  // overlap context, including during linger, so Choose never uses a stack
  // that is still waiting for dwell (T11e).
  const chooserRef = useRef<{
    x: number;
    y: number;
    wiring: SketchPickCycleWiring;
    restoreHover: PrimitiveRef | null;
    /** The session scope the wiring was built for (review B-1). */
    definition: unknown;
    activeTool: unknown;
    detachKeys: () => void;
  } | null>(null);
  // Set by the canvas press that dismisses an open chooser; that press's
  // pointer-up and click are swallowed (T11e review R-2).
  const chooserDismissPressRef = useRef(false);
  const [chooser, setChooser] = useState<SketchPickChooserModel | null>(null);
  // The hovered sketch pick stack's targets, which reveal contextual point
  // markers (T11-D8). Keyed by its member set, so neither a pointer move
  // nor a reorder of the same members renders (T11f review A-3).
  const [sketchHoverStack, setSketchHoverStack] = useState<SketchHoverStack>(
    EMPTY_SKETCH_HOVER_STACK,
  );
  const updateSketchHoverStack = useCallback(
    (stack: readonly PrimitiveRef[]) => {
      const key = stack.map(getPrimitiveRefKey).sort().join("|");
      setSketchHoverStack((current) =>
        current.key === key ? current : { key, targets: stack },
      );
    },
    [],
  );
  // Entering, leaving or switching sketches forgets the last hovered stack
  // (T11f review A-4); adjusted while rendering, like the chooser scope.
  const sketchHoverScope = sketchSession
    ? (sketchSession.sketchId ?? "sketch_draft")
    : null;
  const [hoverStackScope, setHoverStackScope] = useState(sketchHoverScope);
  if (hoverStackScope !== sketchHoverScope) {
    setHoverStackScope(sketchHoverScope);
    setSketchHoverStack(EMPTY_SKETCH_HOVER_STACK);
  }
  const markerActiveTool = sketchSession?.activeTool ?? null;
  const markerStartPointId = sketchSession?.toolStartPointId ?? null;
  const markerPlacements = sketchSession?.toolPlacements;
  const sketchMarkerToolPointIds = useMemo(
    () =>
      getSketchToolMarkerPointIds({
        activeTool: markerActiveTool,
        toolStartPointId: markerStartPointId,
        toolPlacements: markerPlacements,
      }),
    [markerActiveTool, markerStartPointId, markerPlacements],
  );
  // One revealed-point set per render, not a scan per marker (A-3).
  const sketchMarkerContext = useMemo(() => {
    const context = {
      hoverStack: sketchHoverStack.targets,
      hoverTarget,
      selection,
      toolPointIds: sketchMarkerToolPointIds,
    };
    return {
      revealedPointIds: getSketchRevealedPointIds(
        sketchDisplayRenderables,
        context,
      ),
      revealedHandleEntityIds: getSketchRevealedHandleEntityIds(
        sketchDisplayRenderables,
        context,
      ),
      hoverTarget,
    };
  }, [
    hoverTarget,
    selection,
    sketchDisplayRenderables,
    sketchHoverStack,
    sketchMarkerToolPointIds,
  ]);
  // The hint with the definition and tool it was computed for; it shows
  // only while both are current (review A-3).
  const { value: pickHint, timing: pickHintTiming } = useDwellHint<{
    hint: SketchPickHintModel;
    definition: unknown;
    activeTool: unknown;
    overlap: SketchStackPickAt;
  }>();
  const lastFitViewRequestIdRef = useRef(fitViewRequestId);
  const pendingFitViewRequestIdRef = useRef<number | null>(null);
  const selectRef = useRef(onSelect);
  const connectedSketchSelectRef = useRef(onConnectedSketchSelect);
  const deselectRef = useRef(onDeselect);
  const annotationEditRef = useRef(onAnnotationEdit);
  const clearHoverRef = useRef(onClearHover);
  const sketchMoveRef = useRef(onSketchMove);
  const sketchReleaseRef = useRef(onSketchRelease);
  const sketchDrawFinalizeRef = useRef(onSketchDrawFinalize);
  const sketchGeometryDragStartRef = useRef(onSketchGeometryDragStart);
  const sketchGeometryDragMoveRef = useRef(onSketchGeometryDragMove);
  const sketchGeometryDragEndRef = useRef(onSketchGeometryDragEnd);
  const sketchGeometryDragCancelRef = useRef(onSketchGeometryDragCancel);
  const specialModeClickRef = useRef(onSpecialModeClick);
  const specialModeDoubleClickRef = useRef(onSpecialModeDoubleClick);
  const specialModeDragStartRef = useRef(onSpecialModeDragStart);
  const specialModeDragMoveRef = useRef(onSpecialModeDragMove);
  const specialModeDragEndRef = useRef(onSpecialModeDragEnd);
  const sectionOffsetChangeRef = useRef(onSectionOffsetChange);
  const sectionFlipRef = useRef(onSectionFlip);
  const sectionClearRef = useRef(onSectionClear);
  const sketchToolPatchRef = useRef(onSketchToolPatch);
  const projectSketchClientPointRef = useRef<
    (clientX: number, clientY: number) => readonly [number, number] | null
  >(() => null);
  const lodTierChangeRef = useRef(onLodTierChange);
  const canvasCreatedRef = useRef(onCanvasCreated);
  const firstNonEmptyGeometryFrameRef = useRef(onFirstNonEmptyGeometryFrame);
  const sketchDisplayStylesEnabled = shouldApplySketchDisplayStyles(
    mode,
    sketchSession !== null,
  );
  const sketchRenderingPalette = useMemo(
    () => resolveSketchRenderingPalette(),
    [],
  );
  const selectionRef = useRef(selection);
  // T14g (T-10): whether the radial annotation wheel is open (the chooser
  // closes it; it also makes a region click a first-stage blank). Review
  // R-1: a camera change that starts after it opened closes it (a camera
  // controls gesture start, a mouse-wheel zoom included; a programmatic
  // transition such as the view cube; a projection switch; a window
  // resize); the damped tail of a gesture that ended earlier does not.
  // Stable (read through refs), so the chooser callbacks and the canvas
  // listeners that depend on it are not re-created.
  const annotationWheelOpenRef = useRef(false);
  const annotationWheelIntentRef = useRef(onIntent);
  useEffect(() => {
    annotationWheelOpenRef.current = Boolean(annotationContext?.wheel);
    annotationWheelIntentRef.current = onIntent;
  });
  const closeAnnotationWheel = useCallback(() => {
    if (annotationWheelOpenRef.current) {
      annotationWheelOpenRef.current = false;
      annotationWheelIntentRef.current({ type: "annotationWheelClosed" });
    }
  }, []);
  useEffect(() => {
    window.addEventListener("resize", closeAnnotationWheel);
    return () => window.removeEventListener("resize", closeAnnotationWheel);
  }, [closeAnnotationWheel]);
  const sketchSessionRef = useRef(sketchSession);
  const acceptsSpecialModeTargetRef = useRef(
    capabilities.acceptsSpecialModeTarget,
  );
  const sectionViewRef = useRef(activeSectionView);
  const renderablesRef = useRef(renderables);
  const sketchDisplayRenderablesRef = useRef(sketchDisplayRenderables);
  const sketchMarkerContextRef = useRef(sketchMarkerContext);
  const requestCameraTransition = useCallback(
    (targetFrame: ViewportCameraFrame, fromFrame?: ViewportCameraFrame) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const transitionStartFrame =
        fromFrame ??
        (camera && controls
          ? captureViewportCameraFrame(camera, controls)
          : null);

      if (!transitionStartFrame) {
        return;
      }

      closeAnnotationWheel();
      cameraTransitionControllerRef.current.start({
        fromFrame: transitionStartFrame,
        toFrame: targetFrame,
      });
      setViewportTransitionVersion((current) => current + 1);

      if (projectionModeRef.current !== targetFrame.projectionMode) {
        pendingProjectionFrameRef.current =
          cloneViewportCameraFrame(transitionStartFrame);
        projectionModeRef.current = targetFrame.projectionMode;
        setProjectionMode(targetFrame.projectionMode);
      }
    },
    [closeAnnotationWheel],
  );
  const handleControlsRef = useCallback((controls: unknown) => {
    const nextControls = controls as ViewportCameraControls | null;

    if (controlsRef.current !== nextControls) {
      controlsRef.current = nextControls;
      setControlsReadyVersion((current) => current + 1);
    }

    const camera = cameraRef.current;

    if (!nextControls || !camera) {
      return;
    }

    if (pendingProjectionFrameRef.current) {
      applyViewportCameraFrame(
        camera,
        nextControls,
        pendingProjectionFrameRef.current,
      );
      pendingProjectionFrameRef.current = null;
      return;
    }

    if (controlsInitializedRef.current) {
      return;
    }

    applyViewportCameraFrame(
      camera,
      nextControls,
      getDefaultViewportCameraFrame(),
    );
    controlsInitializedRef.current = true;
  }, []);
  const handleProjectionModeChange = useCallback(
    (nextMode: ViewportProjectionMode) => {
      if (nextMode === projectionMode) {
        return;
      }

      cameraTransitionControllerRef.current.cancel();
      closeAnnotationWheel();
      if (cameraRef.current && controlsRef.current) {
        pendingProjectionFrameRef.current = captureViewportCameraFrame(
          cameraRef.current,
          controlsRef.current,
        );
      }

      projectionModeRef.current = nextMode;
      setProjectionMode(nextMode);
    },
    [closeAnnotationWheel, projectionMode],
  );
  const scheduleSketchGeometryDragMove = useCallback(
    (point: readonly [number, number], options?: { exactZero?: boolean }) => {
      scheduleCoalescedSketchGeometryDragMove({
        point,
        exactZero: options?.exactZero,
        pendingPointRef: pendingSketchGeometryDragPointRef,
        pendingExactZeroRef: pendingSketchGeometryDragExactZeroRef,
        pendingFrameIdRef: pendingSketchGeometryDragFrameIdRef,
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        isDragActive: () => sketchGeometryDragRef.current !== null,
        onMove: (latestPoint, opts) =>
          sketchGeometryDragMoveRef.current(latestPoint, opts),
      });
    },
    [],
  );
  const cancelSketchGeometryDragMove = useCallback(() => {
    cancelCoalescedSketchGeometryDragMove({
      pendingPointRef: pendingSketchGeometryDragPointRef,
      pendingFrameIdRef: pendingSketchGeometryDragFrameIdRef,
      cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
    });
  }, []);
  // T16f: the session fields the mirror counterparts and the edited
  // annotation read (not the whole session, which changes per pointer move).
  const highlightSketchId = sketchSession?.sketchId ?? null;
  const highlightDefinition = sketchSession?.definition ?? null;
  const highlightLiveSolve = sketchSession?.liveSolve ?? null;
  const highlightAnnotationEdit = sketchSession?.activeAnnotationEdit ?? null;
  const annotationHighlightTargets = useMemo(
    () =>
      getAnnotationHighlightTargets(
        sketchAnnotations,
        selection,
        hoverTarget,
        highlightDefinition
          ? {
              sketchId: highlightSketchId,
              definition: highlightDefinition,
              liveSolve: highlightLiveSolve,
              activeAnnotationEdit: highlightAnnotationEdit,
            }
          : null,
      ),
    [
      hoverTarget,
      selection,
      sketchAnnotations,
      highlightSketchId,
      highlightDefinition,
      highlightLiveSolve,
      highlightAnnotationEdit,
    ],
  );
  const selectionFilterRef = useRef(selectionFilter);
  const selectionCatalogRef = useRef(selectionCatalog);
  const bvhSceneKey = useMemo(
    () => createViewportBvhSceneKey(renderables, sketchDisplayRenderables),
    [renderables, sketchDisplayRenderables],
  );
  const bvhSceneKeyRef = useRef(bvhSceneKey);
  const activeSectionClippingPlane = useMemo(
    () =>
      activeSectionView ? createSectionClippingPlane(activeSectionView) : null,
    [activeSectionView],
  );
  const viewportInvalidationKey = useMemo(
    () =>
      createViewportInvalidationKey({
        sceneKey: bvhSceneKey,
        hoverTargetKey: hoverTarget ? getPrimitiveRefKey(hoverTarget) : "none",
        selectionKeys: selection.map(getPrimitiveRefKey),
        sketchFeedbackKey: JSON.stringify({
          annotations: sketchAnnotations.map((annotation) => annotation.id),
          specialMode: specialModePresentation,
          tool: sketchToolPresentation,
        }),
        measurementWitnessCount: measurementWitnesses.length,
        sectionViewKey: activeSectionView
          ? JSON.stringify(activeSectionView)
          : "none",
        clippingKey: activeSectionClippingPlane
          ? activeSectionClippingPlane.normal.toArray().join(",") +
            `:${activeSectionClippingPlane.constant}`
          : "none",
        lodKey: renderables
          .map((entry) => `${entry.origin}:${entry.renderable.id}`)
          .join(","),
        projectionMode,
        themeKey: sketchDisplayStylesEnabled
          ? "sketch-styles"
          : "default-styles",
        fitViewRequestId,
        transitionVersion: viewportTransitionVersion,
      }),
    [
      activeSectionClippingPlane,
      activeSectionView,
      bvhSceneKey,
      fitViewRequestId,
      hoverTarget,
      measurementWitnesses.length,
      projectionMode,
      renderables,
      selection,
      sketchAnnotations,
      sketchDisplayStylesEnabled,
      sketchToolPresentation,
      specialModePresentation,
      viewportTransitionVersion,
    ],
  );
  const activeSectionCaps = useMemo(
    () =>
      activeSectionView
        ? createSectionCapRenderables(
            renderables
              .filter((entry) => entry.renderable.geometry.kind === "mesh")
              .map((entry) => entry.renderable),
            activeSectionView,
          )
        : [],
    [activeSectionView, renderables],
  );
  const activeSectionBounds = useMemo(
    () =>
      getSectionRenderableBounds(renderables.map((entry) => entry.renderable)),
    [renderables],
  );
  const activeSectionBoundsRef = useRef(activeSectionBounds);

  useEffect(() => {
    hoverRef.current = onHover;
    selectRef.current = onSelect;
    connectedSketchSelectRef.current = onConnectedSketchSelect;
    deselectRef.current = onDeselect;
    annotationEditRef.current = onAnnotationEdit;
    clearHoverRef.current = onClearHover;
    sketchMoveRef.current = onSketchMove;
    sketchReleaseRef.current = onSketchRelease;
    sketchDrawFinalizeRef.current = onSketchDrawFinalize;
    sketchGeometryDragStartRef.current = onSketchGeometryDragStart;
    sketchGeometryDragMoveRef.current = onSketchGeometryDragMove;
    sketchGeometryDragEndRef.current = onSketchGeometryDragEnd;
    sketchGeometryDragCancelRef.current = onSketchGeometryDragCancel;
    specialModeClickRef.current = onSpecialModeClick;
    specialModeDoubleClickRef.current = onSpecialModeDoubleClick;
    specialModeDragStartRef.current = onSpecialModeDragStart;
    specialModeDragMoveRef.current = onSpecialModeDragMove;
    specialModeDragEndRef.current = onSpecialModeDragEnd;
    sectionOffsetChangeRef.current = onSectionOffsetChange;
    sectionFlipRef.current = onSectionFlip;
    sectionClearRef.current = onSectionClear;
    sketchToolPatchRef.current = onSketchToolPatch;
    lodTierChangeRef.current = onLodTierChange;
    canvasCreatedRef.current = onCanvasCreated;
    firstNonEmptyGeometryFrameRef.current = onFirstNonEmptyGeometryFrame;
    selectionRef.current = selection;
    sketchSessionRef.current = sketchSession;
    acceptsSpecialModeTargetRef.current = capabilities.acceptsSpecialModeTarget;
    sectionViewRef.current = activeSectionView;
    selectionFilterRef.current = selectionFilter;
    selectionCatalogRef.current = selectionCatalog;
  }, [
    activeSectionView,
    onClearHover,
    onDeselect,
    onAnnotationEdit,
    onHover,
    onSelect,
    onConnectedSketchSelect,
    onSpecialModeClick,
    onSpecialModeDoubleClick,
    onSpecialModeDragEnd,
    onSpecialModeDragMove,
    onSpecialModeDragStart,
    onSketchGeometryDragCancel,
    onSketchGeometryDragEnd,
    onSketchGeometryDragMove,
    onSketchGeometryDragStart,
    onSketchMove,
    onSketchRelease,
    onSketchDrawFinalize,
    onSectionClear,
    onSectionFlip,
    onSectionOffsetChange,
    onSketchToolPatch,
    onLodTierChange,
    onCanvasCreated,
    onFirstNonEmptyGeometryFrame,
    selection,
    sketchSession,
    selectionCatalog,
    selectionFilter,
    capabilities.acceptsSpecialModeTarget,
  ]);

  useLayoutEffect(() => {
    activeSectionBoundsRef.current = activeSectionBounds;
    sectionViewRef.current = activeSectionView;
    renderablesRef.current = renderables;
    sketchDisplayRenderablesRef.current = sketchDisplayRenderables;
    sketchMarkerContextRef.current = sketchMarkerContext;
    bvhSceneKeyRef.current = bvhSceneKey;
  }, [
    activeSectionBounds,
    activeSectionView,
    bvhSceneKey,
    renderables,
    sketchDisplayRenderables,
    sketchMarkerContext,
  ]);

  useEffect(() => {
    projectionModeRef.current = projectionMode;
  }, [projectionMode]);

  useEffect(() => {
    if (lastFitViewRequestIdRef.current === fitViewRequestId) {
      return;
    }

    lastFitViewRequestIdRef.current = fitViewRequestId;
    pendingFitViewRequestIdRef.current = fitViewRequestId;
  }, [fitViewRequestId]);

  useLayoutEffect(() => {
    if (pendingFitViewRequestIdRef.current === null) {
      return;
    }

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) {
      return;
    }

    cameraTransitionControllerRef.current.cancel();
    const applied = applyViewportRenderableFitFrame({
      camera,
      controls,
      renderables: renderables.map((entry) => entry.renderable),
    });

    if (applied) {
      pendingFitViewRequestIdRef.current = null;
    }
  }, [bvhSceneKey, controlsReadyVersion, renderables]);

  useLayoutEffect(() => {
    if (hoverTarget === null) {
      hoverTargetRef.current = null;
    }
  }, [hoverTarget]);

  const focusCanvas = useCallback(() => {
    canvasElementRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * Forgets the open chooser's pick context and its window Escape listener
   * (T11e); returns what was open.
   */
  const detachSketchPickChooser = useCallback(() => {
    const open = chooserRef.current;
    chooserRef.current = null;
    open?.detachKeys();
    return open;
  }, []);

  // A definition change (an Undo or Redo, a commit, a toggle), a tool
  // change (Escape, a keyboard switch) or leaving the sketch resets the
  // cycle and clears the hint until the pointer moves again; selection
  // changes from elsewhere fail the cycle's retention check at the next
  // hover or click (T11d, review A-3). An open chooser closes without a
  // pick (T11e review B-1).
  const sketchDefinition = sketchSession?.definition ?? null;
  const sketchActiveTool = sketchSession?.activeTool ?? null;
  // T13k review R1: near gaps need the accepted live solve of the current
  // definition (its declared join classes); without one there are none.
  const sketchLiveSolve = sketchSession?.liveSolve ?? null;
  const sketchNearGapBasis = useMemo(
    () =>
      sketchDefinition
        ? getSketchNearGapBasis({
            definition: sketchDefinition,
            liveSolve: sketchLiveSolve,
          })
        : null,
    [sketchDefinition, sketchLiveSolve],
  );
  // T13k (D26): the displayed world position of each point of this sketch
  // (its point markers), for the near-gap pass.
  const sketchNearGapPositions = useMemo(
    () =>
      new Map(
        sketchDisplayRenderables.flatMap((renderable) =>
          renderable.target?.kind === "sketchPoint" &&
          renderable.target.sketchId === sketchHoverScope &&
          renderable.geometry.kind === "marker"
            ? [[renderable.target.pointId, renderable.geometry.position]]
            : [],
        ),
      ),
    [sketchDisplayRenderables, sketchHoverScope],
  );
  // Hovering or selecting an end of a near gap shows the hint with Merge…
  // (T13k, D26); only while no tool is active.
  // Memoised: the hint runs the merge refusal check for its pair.
  const nearGapCandidate = useMemo(
    () =>
      sketchDefinition && sketchActiveTool === null
        ? createSketchNearGapHint({
            gaps: sketchNearGaps,
            pointIds: getSketchNearGapHintPointIds(
              hoverTarget,
              selection,
              sketchHoverScope,
            ),
            definition: sketchDefinition,
          })
        : null,
    [
      hoverTarget,
      selection,
      sketchActiveTool,
      sketchDefinition,
      sketchHoverScope,
      sketchNearGaps,
    ],
  );
  const { value: nearGapDisplay, timing: nearGapTiming } = useDwellHint<{
    hint: NonNullable<typeof nearGapCandidate>;
    definition: unknown;
  }>();
  const nearGapHint =
    nearGapDisplay?.definition === sketchDefinition && sketchActiveTool === null
      ? nearGapDisplay?.hint ?? null
      : null;
  useEffect(() => {
    if (nearGapCandidate) {
      nearGapTiming.hover(
        `${nearGapCandidate.sourcePointId}|${nearGapCandidate.destinationPointId}`,
        { hint: nearGapCandidate, definition: sketchDefinition },
      );
    } else {
      nearGapTiming.leave();
    }
  }, [nearGapCandidate, nearGapTiming, sketchDefinition]);
  useEffect(() => {
    pickCycleRef.current = null;
    pickHintTiming.clear();
    nearGapTiming.clear();
    if (detachSketchPickChooser()) focusCanvas();
  }, [
    detachSketchPickChooser,
    focusCanvas,
    pickHintTiming,
    nearGapTiming,
    sketchDefinition,
    sketchActiveTool,
  ]);
  // Unmounting with the chooser open must not leave its window Escape
  // listener behind (T11e re-review N-2).
  useEffect(
    () => () => void detachSketchPickChooser(),
    [detachSketchPickChooser],
  );
  // The chooser's state follows the same scope: adjusted while rendering,
  // so a stale chooser never renders, not even after leaving and
  // re-entering a sketch (T11e review B-1).
  const [chooserScope, setChooserScope] = useState({
    definition: sketchDefinition,
    activeTool: sketchActiveTool,
  });
  if (
    chooserScope.definition !== sketchDefinition ||
    chooserScope.activeTool !== sketchActiveTool
  ) {
    setChooserScope({
      definition: sketchDefinition,
      activeTool: sketchActiveTool,
    });
    setChooser(null);
  }

  /** Clears the overlap hint and its stored overlap (T11e: a click). */
  const clearSketchPickHint = useCallback(() => {
    pickHintTiming.clear();
    nearGapTiming.clear();
  }, [pickHintTiming, nearGapTiming]);

  useEffect(() => {
    // Escape also dismisses passive hints when no active tool changes scope.
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSketchPickHint();
    };
    window.addEventListener("keydown", dismiss, true);
    return () => window.removeEventListener("keydown", dismiss, true);
  }, [clearSketchPickHint]);

  const setViewportHover = useCallback((target: PrimitiveRef | null) => {
    hoverTargetRef.current = target;
    if (target) {
      hoverRef.current(target);
    } else {
      clearHoverRef.current();
    }
  }, []);

  /** Escape or click outside: nothing selected, the hover restored. */
  const closeSketchPickChooser = useCallback(() => {
    const open = detachSketchPickChooser();
    setChooser(null);
    if (open) setViewportHover(open.restoreHover);
    focusCanvas();
  }, [detachSketchPickChooser, focusCanvas, setViewportHover]);

  /**
   * Opens the candidate chooser for a stack at its overlap point when it has
   * at least 2 eligible candidates (T11e, T11-D6); false otherwise. While
   * open, a window capture-phase listener consumes Escape whatever has focus
   * (Mantine moves focus into the menu only after a timeout), before the
   * shortcut layer's `editor.cancel` (review A-5(b), T11e review R-1).
   */
  const openSketchPickChooser = useCallback(
    ({ x, y, sketch }: SketchStackPickAt) => {
      const session = sketchSessionRef.current;
      const viewportElement = viewportRef.current;
      if (!session || !viewportElement) return false;
      const selection = selectionRef.current;
      const wiring = createSketchPickCycleWiring({
        session,
        selection,
        selectionFilter: selectionFilterRef.current,
        stack: sketch.stack.map((entry) => entry.target),
      });
      const targets = getSketchPickChooserTargets(session, wiring);
      if (!targets) return false;
      const classes = new Map(
        sketch.stack.map(
          (entry) =>
            [getPrimitiveRefKey(entry.target), entry.pickClass] as const,
        ),
      );
      const rect = viewportElement.getBoundingClientRect();
      detachSketchPickChooser();
      const handleKeyDown = (event: KeyboardEvent) =>
        handleSketchPickChooserKeyDown(event, closeSketchPickChooser);
      window.addEventListener("keydown", handleKeyDown, true);
      chooserRef.current = {
        x,
        y,
        wiring,
        restoreHover: hoverTargetRef.current,
        definition: session.definition,
        activeTool: session.activeTool,
        detachKeys: () =>
          window.removeEventListener("keydown", handleKeyDown, true),
      };
      setChooser({
        left: x - rect.left,
        top: y - rect.top,
        items: createSketchPickChooserItems({
          targets,
          classOf: (target) => classes.get(getPrimitiveRefKey(target)),
          isSelected: (target) =>
            selection.some((selected) => primitiveRefEquals(selected, target)),
          definition: sketch.displayDefinition,
        }),
      });
      // T14g (T-10): opening the chooser closes the wheel.
      closeAnnotationWheel();
      return true;
    },
    [closeAnnotationWheel, closeSketchPickChooser, detachSketchPickChooser],
  );

  /**
   * The same selection event a click picking the item sends (T11-D6). A
   * pick whose wiring was built for another definition or tool is dropped
   * (T11e review B-1).
   */
  const pickFromSketchPickChooser = useCallback(
    (item: SketchPickChooserItem) => {
      const open = detachSketchPickChooser();
      setChooser(null);
      focusCanvas();
      const session = sketchSessionRef.current;
      if (
        !open ||
        !session ||
        open.definition !== session.definition ||
        open.activeTool !== session.activeTool
      ) {
        return;
      }
      const choice = resolveSketchPickChoice(
        pickCycleRef.current,
        open,
        open.wiring,
        item.target,
      );
      pickCycleRef.current = choice.cycle;
      clearSketchPickHint();
      lastPickedTargetRef.current = choice.target;
      const camera = cameraRef.current;
      selectRef.current(
        choice.target,
        camera
          ? [camera.position.x, camera.position.y, camera.position.z]
          : undefined,
        choice.replaces ?? undefined,
      );
    },
    [clearSketchPickHint, detachSketchPickChooser, focusCanvas],
  );

  const updateSketchFeedbackProjections = useCallback(() => {
    const camera = cameraRef.current;
    const canvasElement = canvasElementRef.current;
    const plane = sketchSession?.plane;

    if (!camera || !canvasElement || !plane) {
      setSketchFeedbackProjections([]);
      setSketchAnnotationProjections([]);
      setSpecialModeFeedbackProjections([]);
      setSketchNearGaps(EMPTY_SKETCH_NEAR_GAPS);
      return;
    }

    const rect = canvasElement.getBoundingClientRect();
    const anchors = collectSketchViewportFeedbackAnchors(
      sketchToolPresentation,
    );
    const specialModeAnchors = collectSketchSpecialModeFeedbackAnchors(
      specialModePresentation,
    );
    const projections = anchors.flatMap((anchor) => {
      const screenPoint = projectSketchFeedbackAnchor({
        anchor: anchor.anchor,
        plane,
        viewport: {
          width: rect.width,
          height: rect.height,
        },
        projectWorldPoint: (point: WorkspaceVec3) => {
          const projected = new THREE.Vector3(
            point[0],
            point[1],
            point[2],
          ).project(camera);
          return { x: projected.x, y: projected.y, z: projected.z };
        },
      });

      return screenPoint
        ? [{ id: anchor.id, x: screenPoint.x, y: screenPoint.y }]
        : [];
    });

    setSketchFeedbackProjections(projections);
    setSpecialModeFeedbackProjections(
      specialModeAnchors.flatMap((anchor) => {
        const screenPoint = projectSketchFeedbackAnchor({
          anchor: anchor.anchor,
          plane,
          viewport: {
            width: rect.width,
            height: rect.height,
          },
          projectWorldPoint: (point: WorkspaceVec3) => {
            const projected = new THREE.Vector3(
              point[0],
              point[1],
              point[2],
            ).project(camera);
            return { x: projected.x, y: projected.y, z: projected.z };
          },
        });

        return screenPoint
          ? [{ id: anchor.id, x: screenPoint.x, y: screenPoint.y }]
          : [];
      }),
    );
    setSketchAnnotationProjections(
      sketchAnnotations.flatMap((annotation) => {
        const screenPoint = projectSketchFeedbackAnchor({
          anchor: annotation.anchor,
          plane,
          viewport: {
            width: rect.width,
            height: rect.height,
          },
          projectWorldPoint: (point: WorkspaceVec3) => {
            const projected = new THREE.Vector3(
              point[0],
              point[1],
              point[2],
            ).project(camera);
            return { x: projected.x, y: projected.y, z: projected.z };
          },
        });

        return screenPoint
          ? [
              {
                id: getAnnotationProjectionId(annotation.id),
                x: screenPoint.x,
                y: screenPoint.y,
              },
            ]
          : [];
      }),
    );

    // T14f (T-9): every displayed curve's screen bounding-box diagonal, the
    // context extent that picks the annotation dense limit (K = 4 or 2).
    const entityScreenBounds = new Map<
      string,
      { minX: number; minY: number; maxX: number; maxY: number }
    >();
    for (const renderable of sketchDisplayRenderables) {
      if (!renderable.target || renderable.geometry.kind !== "polyline") {
        continue;
      }
      const key = getPrimitiveRefKey(renderable.target);
      for (const point of renderable.geometry.points) {
        const screenPoint = projectSketchFeedbackAnchor({
          anchor: { kind: "worldPoint", point },
          plane,
          viewport: { width: rect.width, height: rect.height },
          projectWorldPoint: (world: WorkspaceVec3) => {
            const projected = new THREE.Vector3(
              world[0],
              world[1],
              world[2],
            ).project(camera);
            return { x: projected.x, y: projected.y, z: projected.z };
          },
        });
        if (!screenPoint) {
          continue;
        }
        const bounds = entityScreenBounds.get(key);
        entityScreenBounds.set(
          key,
          bounds
            ? {
                minX: Math.min(bounds.minX, screenPoint.x),
                minY: Math.min(bounds.minY, screenPoint.y),
                maxX: Math.max(bounds.maxX, screenPoint.x),
                maxY: Math.max(bounds.maxY, screenPoint.y),
              }
            : {
                minX: screenPoint.x,
                minY: screenPoint.y,
                maxX: screenPoint.x,
                maxY: screenPoint.y,
              },
        );
      }
    }
    setSketchEntityScreenExtents(
      new Map(
        [...entityScreenBounds].map(([key, bounds]) => [
          key,
          Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY),
        ]),
      ),
    );

    // T12f: project the drag feedback cue (issue 05 local diagnostic).
    const dragFeedback = sketchSession?.activeDrag?.feedback;
    if (dragFeedback) {
      const screenPoint = projectSketchFeedbackAnchor({
        anchor: { kind: "sketchPoint", point: dragFeedback.target },
        plane,
        viewport: { width: rect.width, height: rect.height },
        projectWorldPoint: (point: WorkspaceVec3) => {
          const projected = new THREE.Vector3(
            point[0],
            point[1],
            point[2],
          ).project(camera);
          return { x: projected.x, y: projected.y, z: projected.z };
        },
      });
      setDragFeedbackCue(
        screenPoint
          ? { x: screenPoint.x, y: screenPoint.y, text: dragFeedback.text }
          : null,
      );
    } else {
      setDragFeedbackCue(null);
    }

    // T13k (D26): near gaps, recomputed on every camera or geometry change.
    const nearGaps = sketchNearGapBasis
      ? findNearGapEndpoints(
          sketchNearGapBasis.definition,
          sketchNearGapBasis.solved,
          sketchNearGapPositions,
          (point: WorkspaceVec3) =>
            projectSketchFeedbackAnchor({
              anchor: { kind: "worldPoint", point },
              plane,
              viewport: { width: rect.width, height: rect.height },
              projectWorldPoint: (world: WorkspaceVec3) => {
                const projected = new THREE.Vector3(
                  world[0],
                  world[1],
                  world[2],
                ).project(camera);
                return { x: projected.x, y: projected.y, z: projected.z };
              },
            }),
        )
      : [];
    setSketchNearGaps(nearGaps.length > 0 ? nearGaps : EMPTY_SKETCH_NEAR_GAPS);
  }, [
    sketchAnnotations,
    sketchDisplayRenderables,
    sketchNearGapBasis,
    sketchNearGapPositions,
    sketchSession?.activeDrag?.feedback,
    sketchSession?.plane,
    sketchToolPresentation,
    specialModePresentation,
  ]);
  const updateSketchFeedbackProjectionsRef = useRef(
    updateSketchFeedbackProjections,
  );

  // T14d (A-11, review B-1): the floating DOM the annotation layout reads:
  // the workbench's marked wrappers (left tool panel stack; chrome: parts
  // panel, notifications, debugger, variables; bottom band: timeline, tabs),
  // the view-cube column, the canvas size and top overlay inset. One read
  // after each commit that can move them (a projection pass, i.e. a camera
  // change or resize; the session and selection the workbench panels render
  // from) or when the chrome itself changes (observers below), before paint;
  // state only changes when a rect does.
  const [sketchAnnotationDomVersion, setSketchAnnotationDomVersion] =
    useState(0);
  const sketchSessionOpen = sketchSession !== null;
  useEffect(() => {
    const root = viewportRef.current?.parentElement;
    if (!sketchSessionOpen || !root) {
      return;
    }
    const bump = () => setSketchAnnotationDomVersion((version) => version + 1);
    const resizeObserver = new ResizeObserver(bump);
    const wrappers = root.querySelectorAll(
      SKETCH_ANNOTATION_DOM_MARKERS.map((marker) => `[${marker}]`).join(","),
    );
    const observeChildren = () => {
      resizeObserver.disconnect();
      wrappers.forEach((wrapper) =>
        [...wrapper.children].forEach((child) => resizeObserver.observe(child)),
      );
    };
    // A chrome element mounting or unmounting (a notification, the
    // variables panel) changes a wrapper's children.
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      bump();
    });
    wrappers.forEach((wrapper) =>
      mutationObserver.observe(wrapper, { childList: true }),
    );
    observeChildren();
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [sketchSessionOpen]);
  useLayoutEffect(() => {
    const canvasElement = canvasElementRef.current;
    const viewportElement = viewportRef.current;
    const next =
      sketchSession && canvasElement && viewportElement
        ? readSketchAnnotationDomFrame(
            canvasElement,
            viewportElement,
            viewCubeColumnRef.current,
          )
        : EMPTY_SKETCH_ANNOTATION_DOM_FRAME;

    if (
      !sketchAnnotationDomFramesEqual(sketchAnnotationDomFrameRef.current, next)
    ) {
      sketchAnnotationDomFrameRef.current = next;
      setSketchAnnotationDomFrame(next);
    }
  }, [
    selection,
    sketchAnnotationDomVersion,
    sketchAnnotationProjections,
    sketchSession,
  ]);
  // T14d (A4): near-gap rings and the active tool's labels are obstacles too
  // (both layers stay `pointer-events-none`; the layout only avoids them).
  const sketchAnnotationObstacles = useMemo(
    () => [
      ...sketchNearGaps.map(({ a, b, distancePx }) => {
        // The ring `SketchNearGapGlyphs` draws.
        const size = Math.max(SKETCH_NEAR_GAP_GLYPH_MIN_PX, distancePx + 10);
        return {
          x: (a.screen.x + b.screen.x) / 2 - size / 2,
          y: (a.screen.y + b.screen.y) / 2 - size / 2,
          width: size,
          height: size,
        };
      }),
      ...getSketchToolLabelObstacles(
        sketchToolPresentation,
        sketchFeedbackProjections,
      ),
      ...sketchAnnotationDomFrame.obstacles,
      // Review R-2: the hint slot, reserved while the sketch is open.
      {
        x: SKETCH_PICK_HINT_LEFT_PX,
        y: sketchAnnotationDomFrame.viewport.topInset,
        width: SKETCH_PICK_HINT_SLOT_WIDTH_PX,
        height: SKETCH_PICK_HINT_SLOT_HEIGHT_PX,
      },
    ],
    [
      sketchAnnotationDomFrame.obstacles,
      sketchAnnotationDomFrame.viewport.topInset,
      sketchFeedbackProjections,
      sketchNearGaps,
      sketchToolPresentation,
    ],
  );

  useEffect(() => {
    updateSketchFeedbackProjectionsRef.current =
      updateSketchFeedbackProjections;
  }, [updateSketchFeedbackProjections]);

  useEffect(() => {
    const cubeElement = viewCubeRef.current;

    if (!cubeElement) {
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = createRenderer({ antialias: true, alpha: true }, "view-cube");
    } catch (error) {
      if (!(error instanceof WebGlInitializationError)) throw error;
      onGraphicsFailure(error);
      return;
    }
    const viewCubeScene = createViewCubeScene();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    cubeElement.appendChild(renderer.domElement);

    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let animationFrameId = 0;
    let attachedControls: ViewportCameraControls | null = null;
    let hoveredPresetId: ViewNavigationPresetId | null = null;

    const updatePointerFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const getIntersectedViewCubeObject = (event: PointerEvent) => {
      updatePointerFromEvent(event);
      raycaster.setFromCamera(pointer, viewCubeScene.camera);

      return raycaster.intersectObjects(
        viewCubeScene.interactiveObjects,
        false,
      )[0]?.object;
    };

    const setHoveredPreset = (
      nextHoveredPresetId: ViewNavigationPresetId | null,
    ) => {
      if (hoveredPresetId === nextHoveredPresetId) {
        return;
      }

      hoveredPresetId = nextHoveredPresetId;
      requestRender();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      const presetId = resolveViewCubePresetId(
        getIntersectedViewCubeObject(event),
      );

      if (!presetId) {
        return;
      }

      requestViewCubeCameraTransition({
        presetId,
        camera: cameraRef.current,
        controls: controlsRef.current,
        requestTransition: requestCameraTransition,
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      const object = getIntersectedViewCubeObject(event);
      const presetId = resolveViewCubePresetId(object);

      renderer.domElement.style.cursor = presetId ? "pointer" : "";
      setHoveredPreset(presetId);
    };

    const handlePointerLeave = () => {
      renderer.domElement.style.cursor = "";
      setHoveredPreset(null);
    };

    function renderCube() {
      const viewportCamera = cameraRef.current;
      const viewportControls = controlsRef.current;

      if (viewportCamera && viewportControls) {
        const orbitOffset = viewportCamera.position
          .clone()
          .sub(viewportControls.target)
          .normalize();
        viewCubeScene.camera.position.copy(orbitOffset.multiplyScalar(4));
        viewCubeScene.camera.up.copy(viewportCamera.up);
        viewCubeScene.camera.lookAt(0, 0, 0);
      }

      updateViewCubeVisibility(viewCubeScene, hoveredPresetId);
      renderer.render(viewCubeScene.scene, viewCubeScene.camera);
    }

    function requestRender() {
      if (animationFrameId !== 0) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = 0;
        renderCube();
      });
    }

    const resizeRenderer = () => {
      resizeViewCubeRenderer({ cubeElement, renderer });

      if (attachedControls) {
        requestRender();
      }
    };
    const resizeObserver = new ResizeObserver(resizeRenderer);

    const attachControls = () => {
      animationFrameId = 0;
      const controls = controlsRef.current;

      if (!controls) {
        animationFrameId = window.requestAnimationFrame(attachControls);
        return;
      }

      attachedControls = controls;
      controls.addEventListener("change", requestRender);
      requestRender();
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    resizeObserver.observe(cubeElement);
    resizeRenderer();
    animationFrameId = window.requestAnimationFrame(attachControls);
    if (controlsReadyVersion > 0) {
      requestRender();
    }

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener(
        "pointerleave",
        handlePointerLeave,
      );
      attachedControls?.removeEventListener("change", requestRender);
      viewCubeScene.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      cubeElement.removeChild(renderer.domElement);
    };
  }, [
    controlsReadyVersion,
    requestCameraTransition,
    createRenderer,
    onGraphicsFailure,
  ]);

  // T17c6 (D-4): pick bindings are collected after the R3F commit of the
  // pick root (`ViewportPickRoot`), whenever its objects or the highlight
  // inputs may have changed; a DOM-side layout effect runs before that
  // commit and could keep the previous scene's objects.
  const pickRootCommitToken = useMemo(
    () => [
      activeSectionClippingPlane,
      annotationHighlightTargets,
      bvhSceneKey,
      hoverTarget,
      renderables,
      selection,
      sketchDisplayRenderables,
      sketchDisplayStylesEnabled,
      sketchMarkerContext,
      sketchRenderingPalette,
    ],
    [
      activeSectionClippingPlane,
      annotationHighlightTargets,
      bvhSceneKey,
      hoverTarget,
      renderables,
      selection,
      sketchDisplayRenderables,
      sketchDisplayStylesEnabled,
      sketchMarkerContext,
      sketchRenderingPalette,
    ],
  );
  const handlePickRootCommit = () => {
    const bindings = collectBindings(pickRootRef.current);
    bindingsRef.current = bindings;
    bindingsSceneKeyRef.current = bvhSceneKey;

    if (bindings) {
      updateWorkspaceHighlight(
        bindings.targetToObjects,
        selection,
        hoverTarget,
        annotationHighlightTargets,
      );
    }
  };

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!camera || !controls) {
      return;
    }

    const nextTransition = resolveSketchCameraTransition({
      camera,
      controls,
      sketchSession,
      sketchDisplayRenderables,
      state: sketchCameraStateRef.current,
    });

    sketchCameraStateRef.current = nextTransition.state;

    if (!nextTransition.targetFrame) {
      return;
    }

    requestCameraTransition(
      nextTransition.targetFrame,
      nextTransition.fromFrame,
    );
    window.requestAnimationFrame(updateSketchFeedbackProjections);
  }, [
    controlsReadyVersion,
    requestCameraTransition,
    sketchDisplayRenderables,
    sketchSession,
    updateSketchFeedbackProjections,
  ]);

  useEffect(() => {
    const controls = controlsRef.current;
    let animationFrameId = window.requestAnimationFrame(
      updateSketchFeedbackProjections,
    );

    const requestProjectionUpdate = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(
        updateSketchFeedbackProjections,
      );
    };

    controls?.addEventListener("change", requestProjectionUpdate);
    window.addEventListener("resize", requestProjectionUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      controls?.removeEventListener("change", requestProjectionUpdate);
      window.removeEventListener("resize", requestProjectionUpdate);
    };
  }, [
    canvasReadyVersion,
    controlsReadyVersion,
    updateSketchFeedbackProjections,
  ]);

  useEffect(() => {
    if (bindingsRef.current) {
      updateWorkspaceHighlight(
        bindingsRef.current.targetToObjects,
        selection,
        hoverTarget,
        annotationHighlightTargets,
      );
    }
  }, [annotationHighlightTargets, hoverTarget, selection]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    const canvasElement = canvasElementRef.current;

    if (!viewportElement || !canvasElement) {
      return;
    }

    const getCachedBindings = () => {
      if (
        bindingsRef.current &&
        bindingsSceneKeyRef.current === bvhSceneKeyRef.current &&
        bindingsRef.current.pickables.length > 0
      ) {
        return bindingsRef.current;
      }

      const bindings = collectBindings(pickRootRef.current);
      bindingsRef.current = bindings;
      bindingsSceneKeyRef.current = bvhSceneKeyRef.current;
      return bindings;
    };

    const pointerWithinViewCube = (clientX: number, clientY: number) => {
      const cubeElement = viewCubeRef.current;

      if (!cubeElement) {
        return false;
      }

      const rect = cubeElement.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    };

    const acceptsViewportTarget = (target: PrimitiveRef) => {
      const activeSpecialModeSession = sketchSessionRef.current;

      if (activeSpecialModeSession?.activeSpecialMode) {
        return acceptsSpecialModeTargetRef.current({
          session: activeSpecialModeSession,
          target,
          selection: selectionRef.current,
          selectionCatalog: selectionCatalogRef.current,
        });
      }

      return selectionFilterAllowsTarget(
        selectionFilterRef.current,
        selectionRef.current,
        target,
        selectionCatalogRef.current,
      );
    };

    /**
     * The pick at a client point. In sketch mode `sketch` holds the whole
     * ordered sketch pick stack (T11c) and its display definition; `top` is
     * its first entry. Part mode resolves one target.
     */
    const resolvePickFromClientPoint = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ): {
      top: PickResult | null;
      sketch: SketchStackPick | null;
    } => {
      const camera = cameraRef.current;
      const bindings = getCachedBindings();

      if (!camera || !bindings) {
        return { top: null, sketch: null };
      }

      updatePointerFromClientPoint(
        pointerRef.current,
        viewportRect,
        clientX,
        clientY,
      );
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const pickTuning = getViewportPickTuning(selectionFilterRef.current);
      (
        raycasterRef.current as THREE.Raycaster & { firstHitOnly?: boolean }
      ).firstHitOnly = false;
      const sketchSession = sketchSessionRef.current;
      // Part mode picks lines within a screen-pixel band capped at the
      // world band (T17-19); sketch mode keeps the world band.
      raycasterRef.current.params.Line.threshold = pickTuning.linePickThreshold;
      const intersections = sketchSession
        ? raycasterRef.current.intersectObjects(bindings.pickables, true)
        : intersectObjectsWithLinePickRadius({
            raycaster: raycasterRef.current,
            objects: bindings.pickables,
            camera,
            viewportHeight: viewportRect.height,
            linePickRadiusPx: pickTuning.linePickRadiusPx,
            maxLineThreshold: pickTuning.linePickThreshold,
          });
      // Built once per pick; the curve collector and the stack share it.
      const sketchDisplayDefinition = sketchSession
        ? getSketchSessionDisplayDefinition(sketchSession)
        : undefined;
      const candidates = [
        ...collectRaycastPickCandidates(intersections),
        ...collectProjectedSketchDisplayPointCandidates({
          clientX,
          clientY,
          camera,
          viewportRect,
          sketchDisplayRenderables: sketchDisplayRenderablesRef.current,
          acceptsTarget: acceptsViewportTarget,
          currentHoverTarget: hoverTargetRef.current,
          revealedHandleEntityIds:
            sketchMarkerContextRef.current?.revealedHandleEntityIds,
        }),
        ...collectProjectedSketchCurveCandidates({
          clientX,
          clientY,
          camera,
          viewportRect,
          sketchSession,
          displayDefinition: sketchDisplayDefinition,
          acceptsTarget: acceptsViewportTarget,
          currentHoverTarget: hoverTargetRef.current,
        }),
        ...collectProjectedVertexCandidates({
          clientX,
          clientY,
          camera,
          viewportRect,
          renderables: renderablesRef.current,
          acceptsTarget: acceptsViewportTarget,
          currentHoverTarget: hoverTargetRef.current,
          inSketchSession: sketchSession !== null,
        }),
      ];

      if (!sketchSession || !sketchDisplayDefinition) {
        return {
          top: resolveAllCandidates(
            candidates,
            acceptsViewportTarget,
            pickTuning.resolutionOptions,
          ),
          sketch: null,
        };
      }

      // Sketch mode: hover, release and click all read the one sketch pick
      // stack (T11c); the repeated-click cycle walks it (T11d).
      const stack = resolveSketchPickStack({
        session: sketchSession,
        displayDefinition: sketchDisplayDefinition,
        candidates: toSketchPickStackCandidates(candidates, {
          ...pickTuning.resolutionOptions,
          excludeBackgroundDatumPlanes:
            getViewportCanvasClickIntent({
              activeSketchTool: sketchSession.activeTool,
              hasResolvedTarget: true,
              isBackgroundDatumTarget: true,
              selectionFilterKind: selectionFilterRef.current?.kind ?? null,
            }) === "clearSelection",
        }),
        acceptsTarget: acceptsViewportTarget,
      }).map((entry) => ({
        pickId: entry.candidate.pick.pickId,
        target: entry.target,
        renderable: entry.candidate.pick.renderable,
        pickClass: entry.pickClass,
      }));

      return {
        top: stack[0] ?? null,
        sketch: createSketchStackPick(
          sketchSession,
          stack,
          sketchDisplayDefinition,
        ),
      };
    };

    const getPickTargetFromClientPoint = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ): PickResult | null =>
      resolvePickFromClientPoint(clientX, clientY, viewportRect).top;

    const getSketchPickCycleWiring = (
      stack: readonly PickResult[],
    ): SketchPickCycleWiring | null => {
      const session = sketchSessionRef.current;

      if (!session) {
        return null;
      }

      return createSketchPickCycleWiring({
        session,
        selection: selectionRef.current,
        selectionFilter: selectionFilterRef.current,
        stack: stack.map((entry) => entry.target),
      });
    };

    /**
     * The hint for the sketch stack hovered or clicked at (x, y) (T11d): it
     * replaces the shown one, and is kept as the overlap "Choose…" opens
     * (T11e). Hover dwells; click-generated hints remain immediate.
     */
    const updateSketchPickHint = (
      at: SketchStackPickAt,
      previewTarget: PrimitiveRef | null,
      wiring: SketchPickCycleWiring | null,
      immediate = false,
    ) => {
      const session = sketchSessionRef.current;
      const targets =
        wiring && session ? getSketchPickChooserTargets(session, wiring) : null;
      const hint =
        targets && wiring
          ? createSketchPickHint({
              stack: targets,
              previewTarget,
              cycles: wiring.hintCycles ?? wiring.context.mode !== "none",
              definition: at.sketch.displayDefinition,
            })
          : null;
      if (hint && targets) {
        pickHintTiming.hover(
          targets.map(getPrimitiveRefKey).sort().join("|"),
          {
            hint,
            definition: session?.definition ?? null,
            activeTool: session?.activeTool ?? null,
            overlap: at,
          },
          immediate,
        );
      } else {
        pickHintTiming.leave();
      }
    };

    const getViewportCameraPosition = (): Vec3 | null => {
      const camera = cameraRef.current;

      return camera
        ? [camera.position.x, camera.position.y, camera.position.z]
        : null;
    };

    const getSectionHandleHitFromClientPoint = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ) => {
      const activeSection = sectionViewRef.current;
      const camera = cameraRef.current;

      if (!activeSection || !camera) {
        return null;
      }

      const handlePosition = getSectionPlaneOrigin(activeSection);
      const projectedHandleCenter = projectWorldPointToViewport({
        camera,
        point: handlePosition,
        viewport: {
          width: viewportRect.width,
          height: viewportRect.height,
        },
      });

      if (!projectedHandleCenter) {
        return null;
      }

      const boundsSize =
        activeSectionBoundsRef.current?.getSize(new THREE.Vector3()) ??
        new THREE.Vector3(24, 24, 24);
      const planeSize = Math.max(boundsSize.length() * 0.6, 12);
      const handleRadius = Math.max(planeSize * 0.045, 0.6);
      const handleEdgePoint: Vec3 = [
        handlePosition[0] + activeSection.plane.frame.xAxis[0] * handleRadius,
        handlePosition[1] + activeSection.plane.frame.xAxis[1] * handleRadius,
        handlePosition[2] + activeSection.plane.frame.xAxis[2] * handleRadius,
      ];
      const projectedHandleEdge = projectWorldPointToViewport({
        camera,
        point: handleEdgePoint,
        viewport: {
          width: viewportRect.width,
          height: viewportRect.height,
        },
      });
      const pixelRadius = projectedHandleEdge
        ? Math.hypot(
            projectedHandleEdge.x - projectedHandleCenter.x,
            projectedHandleEdge.y - projectedHandleCenter.y,
          )
        : 0;
      const hitRadiusPx = Math.max(pixelRadius, 14);
      const localClientX = clientX - viewportRect.left;
      const localClientY = clientY - viewportRect.top;

      return Math.hypot(
        projectedHandleCenter.x - localClientX,
        projectedHandleCenter.y - localClientY,
      ) <= hitRadiusPx
        ? true
        : null;
    };

    const projectSketchPoint = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ): readonly [number, number] | null => {
      const camera = cameraRef.current;
      const activeSketchSession = sketchSessionRef.current;
      const controls = controlsRef.current;

      if (!camera || !activeSketchSession || !controls) {
        return null;
      }

      const transitionTargetFrame =
        cameraTransitionControllerRef.current.getTargetFrame();

      if (transitionTargetFrame) {
        applyViewportCameraFrame(camera, controls, transitionTargetFrame);
        cameraTransitionControllerRef.current.cancel();
        window.requestAnimationFrame(() =>
          updateSketchFeedbackProjectionsRef.current(),
        );
      }

      updatePointerFromClientPoint(
        pointerRef.current,
        viewportRect,
        clientX,
        clientY,
      );
      raycasterRef.current.setFromCamera(pointerRef.current, camera);

      const { frame } = activeSketchSession.plane;
      sketchPlaneRef.current.set(
        new THREE.Vector3(frame.normal[0], frame.normal[1], frame.normal[2]),
        -(
          frame.normal[0] * frame.origin[0] +
          frame.normal[1] * frame.origin[1] +
          frame.normal[2] * frame.origin[2]
        ),
      );

      if (
        !raycasterRef.current.ray.intersectPlane(
          sketchPlaneRef.current,
          sketchHitPointRef.current,
        )
      ) {
        const fallbackFrame = computeSketchCameraFrame({
          camera,
          plane: activeSketchSession.plane,
          renderables: sketchDisplayRenderablesRef.current,
        });

        applyViewportCameraFrame(camera, controls, fallbackFrame);
        cameraTransitionControllerRef.current.cancel();
        window.requestAnimationFrame(() =>
          updateSketchFeedbackProjectionsRef.current(),
        );
        raycasterRef.current.setFromCamera(pointerRef.current, camera);

        if (
          !raycasterRef.current.ray.intersectPlane(
            sketchPlaneRef.current,
            sketchHitPointRef.current,
          )
        ) {
          return null;
        }
      }

      return mapWorldPointToWorkspaceSketch(activeSketchSession.plane, [
        sketchHitPointRef.current.x,
        sketchHitPointRef.current.y,
        sketchHitPointRef.current.z,
      ]);
    };

    /** The screen scale snapping uses at a sketch pointer event (T13-D13). */
    const measureSketchUnitsPerPixel = (
      clientX: number,
      clientY: number,
      viewportRect: DOMRectReadOnly,
    ) => {
      const camera = cameraRef.current;
      const activeSketchSession = sketchSessionRef.current;

      return camera && activeSketchSession
        ? computeSketchUnitsPerPixel({
            camera,
            viewportRect,
            plane: activeSketchSession.plane,
            clientX,
            clientY,
          })
        : null;
    };

    projectSketchClientPointRef.current = (clientX, clientY) =>
      projectSketchPoint(
        clientX,
        clientY,
        canvasElement.getBoundingClientRect(),
      );

    // Keep the last actionable overlap during the bounded linger (T11e).
    const clearHover = () => {
      pickHintTiming.leave();
      nearGapTiming.leave();
      lastPickedTargetRef.current = null;
      if (hoverTargetRef.current !== null) {
        hoverTargetRef.current = null;
        clearHoverRef.current();
      }
    };

    /** Construct the current sketch drag gesture phase from refs. */
    const getSketchDragGesturePhase = (): SketchDragGesturePhase => {
      if (
        sketchGeometryDragRef.current &&
        sketchGeometryDragPointerIdRef.current !== null
      ) {
        return {
          kind: "active",
          target: sketchGeometryDragRef.current.target,
          pointerId: sketchGeometryDragPointerIdRef.current,
        };
      }
      if (
        pendingSketchGeometryDragRef.current &&
        primaryPointerDownRef.current
      ) {
        return {
          kind: "pending",
          target: pendingSketchGeometryDragRef.current.target,
          startPoint: pendingSketchGeometryDragRef.current.startPoint,
          pointerDown: primaryPointerDownRef.current,
        };
      }
      return { kind: "idle" };
    };

    /** Apply the result of `resolveSketchDragGesture` to DOM and refs. */
    const applyDragGestureActions = (
      actions: SketchDragGestureActions,
      canvas: HTMLElement,
    ) => {
      // 1. Apply phase to refs (clear drag state BEFORE release for
      //    lostpointercapture invariant).
      switch (actions.phase.kind) {
        case "idle":
          sketchGeometryDragRef.current = null;
          sketchGeometryDragPointerIdRef.current = null;
          pendingSketchGeometryDragRef.current = null;
          break;
        case "active":
          sketchGeometryDragRef.current = { target: actions.phase.target };
          sketchGeometryDragPointerIdRef.current = actions.phase.pointerId;
          pendingSketchGeometryDragRef.current = null;
          break;
        case "pending":
          // Pending is set by pointer-down, not by the reducer.
          break;
      }
      // 2. Cancel pending RAF before any dispatches.
      if (actions.cancelDragMove) {
        cancelSketchGeometryDragMove();
      }
      // 3. Dispatch cancel, start, move, end.
      if (actions.cancelDrag) {
        sketchGeometryDragCancelRef.current();
      }
      if (actions.startDrag) {
        sketchGeometryDragStartRef.current(
          actions.startDrag.target,
          actions.startDrag.startPoint,
        );
      }
      if (actions.scheduleDragMove) {
        scheduleSketchGeometryDragMove(actions.scheduleDragMove);
      }
      if (actions.endDrag) {
        sketchGeometryDragEndRef.current(actions.endDrag);
      }
      // 4. Cursor.
      if (actions.cursor !== null) {
        canvas.style.cursor = actions.cursor;
      }
      // 5. Pointer capture (request first, release last).
      if (actions.requestCapture !== null) {
        canvas.setPointerCapture(actions.requestCapture);
      }
      if (
        actions.releaseCapture !== null &&
        canvas.hasPointerCapture(actions.releaseCapture)
      ) {
        canvas.releasePointerCapture(actions.releaseCapture);
      }
    };

    /** T12d D4: check whether the pointer is within 6 screen-px of a
     *  tangent handle's fit point (for exact-zero capture). */
    const isWithinZeroCaptureRadius = (
      event: PointerEvent,
      viewportRect: DOMRect,
      handleTarget: import("@/contracts/shared/references").SketchTangentHandleRef,
    ): boolean => {
      const dragSession = sketchSessionRef.current;
      if (!dragSession || !cameraRef.current) return false;
      const ptId = handleTarget.pointId;
      const solvedPt = dragSession.liveSolve?.solvedSnapshot.solvedPoints.find(
        (sp) => sp.pointId === ptId,
      );
      const fitPos =
        solvedPt?.solvedPosition ??
        dragSession.definition.points.find((p) => p.pointId === ptId)?.position;
      if (!fitPos) return false;
      const fitWorld = mapSketchPointToWorld(dragSession.plane, fitPos);
      const proj = new THREE.Vector3(
        fitWorld[0],
        fitWorld[1],
        fitWorld[2],
      ).project(cameraRef.current);
      return shouldCaptureZeroTangentHandle(
        {
          x: event.clientX - viewportRect.left,
          y: event.clientY - viewportRect.top,
        },
        {
          x: ((proj.x + 1) / 2) * viewportRect.width,
          y: ((-proj.y + 1) / 2) * viewportRect.height,
        },
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      const viewportRect = canvasElement.getBoundingClientRect();

      if (sectionDragRef.current !== null) {
        const offset = resolveSectionScreenDragOffset({
          camera: cameraRef.current,
          viewport: {
            width: viewportRect.width,
            height: viewportRect.height,
          },
          sectionAtDragStart: sectionDragRef.current.sectionAtDragStart,
          dragStartClientPoint: {
            x:
              sectionDragRef.current.dragStartClientPoint.x - viewportRect.left,
            y: sectionDragRef.current.dragStartClientPoint.y - viewportRect.top,
          },
          currentClientPoint: {
            x: event.clientX - viewportRect.left,
            y: event.clientY - viewportRect.top,
          },
        });

        if (offset !== null && offset !== sectionDragOffsetRef.current) {
          sectionDragOffsetRef.current = offset;
          sectionOffsetChangeRef.current(offset);
        }

        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // Sketch drag gesture: delegate threshold, cursor, and capture
      // decisions to the extracted reducer.
      {
        const gesturePhase = getSketchDragGesturePhase();
        if (gesturePhase.kind !== "idle") {
          const sketchPoint = projectSketchPoint(
            event.clientX,
            event.clientY,
            viewportRect,
          );
          const actions = resolveSketchDragGesture(gesturePhase, {
            kind: "pointerMove",
            clientX: event.clientX,
            clientY: event.clientY,
            pointerId: event.pointerId,
            sketchPoint,
          });
          // T12d D4: zero capture — when dragging a tangent handle and
          // the pointer is within the screen-px threshold of the fit
          // point, signal exactZero so the session stores exactly [0, 0].
          let zeroCaptured = false;
          if (
            actions.scheduleDragMove &&
            gesturePhase.kind === "active" &&
            gesturePhase.target.kind === "sketchTangentHandle"
          ) {
            zeroCaptured = isWithinZeroCaptureRadius(
              event,
              viewportRect,
              gesturePhase.target as import("@/contracts/shared/references").SketchTangentHandleRef,
            );
          }
          if (zeroCaptured && actions.scheduleDragMove) {
            scheduleSketchGeometryDragMove(actions.scheduleDragMove, {
              exactZero: true,
            });
            // Skip the normal applyDragGestureActions scheduleDragMove.
            actions.scheduleDragMove = null;
          }
          applyDragGestureActions(actions, canvasElement);
          if (actions.consumed) {
            if (actions.preventDefault) {
              event.preventDefault();
              event.stopPropagation();
            }
            return;
          }
        }
      }

      if (isViewportNavigationPointerMove(event.buttons)) {
        return;
      }

      if (pointerWithinViewCube(event.clientX, event.clientY)) {
        updateSketchHoverStack([]);
        clearHover();
        return;
      }

      const pick = resolvePickFromClientPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );
      const wiring = pick.sketch
        ? getSketchPickCycleWiring(pick.sketch.stack)
        : null;
      updateSketchHoverStack(
        pick.sketch?.stack.map((entry) => entry.target) ?? [],
      );
      // Hover highlights exactly what the next click picks: `stack[0]`, or
      // `stack[next]` while a cycle is armed (T11d).
      const target = wiring
        ? getSketchPickPreviewTarget(
            pickCycleRef.current,
            event.clientX,
            event.clientY,
            wiring,
          )
        : (pick.top?.target ?? null);

      // A new stack dwells before replacing the last actionable hint.
      if (pick.sketch && pick.sketch.stack.length > 0) {
        updateSketchPickHint(
          { x: event.clientX, y: event.clientY, sketch: pick.sketch },
          target,
          wiring,
        );
      } else {
        pickHintTiming.leave();
      }

      if (target && acceptsViewportTarget(target)) {
        lastPickedTargetRef.current = target;
        if (
          hoverTargetRef.current === null ||
          !primitiveRefEquals(hoverTargetRef.current, target)
        ) {
          hoverTargetRef.current = target;
          hoverRef.current(target);
        }
      } else {
        clearHover();
      }

      const activeSketchSession = sketchSessionRef.current;

      // R-5: show grab cursor when hovering a draggable target and no
      // non-drawing tool is armed.
      if (
        isSketchDragHoverTarget(
          activeSketchSession,
          target,
          pick.sketch?.displayDefinition,
          pick.sketch?.solvedSnapshot ?? null,
        )
      ) {
        canvasElement.style.cursor = "grab";
      } else if (canvasElement.style.cursor === "grab") {
        canvasElement.style.cursor = "";
      }

      if (!activeSketchSession) {
        return;
      }

      if (activeSketchSession.activeSpecialMode) {
        return;
      }

      const point = projectSketchPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );

      if (point) {
        sketchMoveRef.current(
          point,
          measureSketchUnitsPerPixel(
            event.clientX,
            event.clientY,
            viewportRect,
          ),
        );
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      // A new press: a stack cached at an earlier pointer-up whose `click`
      // returned early is stale (review A-2).
      releasedPickRef.current = null;
      chooserDismissPressRef.current = false;

      // A press on the canvas only dismisses an open chooser; its
      // pointer-up and click are swallowed (T11e review R-2).
      if (chooserRef.current && event.button === 0) {
        chooserDismissPressRef.current = true;
        closeSketchPickChooser();
        return;
      }

      if (
        event.button !== 0 ||
        pointerWithinViewCube(event.clientX, event.clientY)
      ) {
        return;
      }

      const viewportRect = canvasElement.getBoundingClientRect();

      primaryPointerDownRef.current = {
        x: event.clientX,
        y: event.clientY,
      };

      const sectionHandleHit = getSectionHandleHitFromClientPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );

      if (sectionHandleHit && sectionViewRef.current) {
        event.preventDefault();
        event.stopPropagation();
        sectionDragRef.current = {
          pointerId: event.pointerId,
          sectionAtDragStart: sectionViewRef.current,
          dragStartClientPoint: {
            x: event.clientX,
            y: event.clientY,
          },
        };
        sectionDragOffsetRef.current = sectionViewRef.current.offset;
        canvasElement.setPointerCapture(event.pointerId);
        if (controlsRef.current) {
          (
            controlsRef.current as ViewportCameraControls & {
              enabled?: boolean;
            }
          ).enabled = false;
        }
        return;
      }

      const activeSketchSession = sketchSessionRef.current;

      if (
        !activeSketchSession ||
        activeSketchSession.activeSpecialMode ||
        !shouldViewportStartSketchGeometryDrag(
          activeSketchSession.activeTool,
          activeSketchSession.status,
        )
      ) {
        return;
      }

      const point = projectSketchPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );

      // D3: resolve drag target from pick stack + selection.
      const pick = resolvePickFromClientPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );
      const definition = pick.sketch?.displayDefinition;
      const stack = pick.sketch?.stack ?? [];
      const dragTarget = definition
        ? resolveSketchDragTarget(
            stack,
            selectionRef.current,
            definition,
            pick.sketch?.solvedSnapshot ?? null,
          )
        : null;

      if (point && dragTarget) {
        pendingSketchGeometryDragRef.current = {
          target: dragTarget,
          startPoint: point,
        };
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button === 0 && chooserDismissPressRef.current) {
        return;
      }

      if (event.button !== 0) {
        const gesturePhase = getSketchDragGesturePhase();
        const actions = resolveSketchDragGesture(gesturePhase, {
          kind: "rightButton",
        });
        applyDragGestureActions(actions, canvasElement);
        primaryPointerDownRef.current = null;
        return;
      }

      const activeSectionDrag = sectionDragRef.current !== null;

      if (activeSectionDrag) {
        const pointerId = sectionDragRef.current?.pointerId;
        sectionDragRef.current = null;
        sectionDragOffsetRef.current = null;
        if (
          pointerId !== undefined &&
          canvasElement.hasPointerCapture(pointerId)
        ) {
          canvasElement.releasePointerCapture(pointerId);
        }
        if (controlsRef.current) {
          (
            controlsRef.current as ViewportCameraControls & {
              enabled?: boolean;
            }
          ).enabled = true;
        }
        primaryPointerDownRef.current = null;
        return;
      }

      // Active drag or pending drag: delegate to the gesture reducer.
      {
        const gesturePhase = getSketchDragGesturePhase();
        if (gesturePhase.kind === "active") {
          const viewportRect = canvasElement.getBoundingClientRect();
          const sketchPoint = projectSketchPoint(
            event.clientX,
            event.clientY,
            viewportRect,
          );
          const actions = resolveSketchDragGesture(gesturePhase, {
            kind: "pointerUp",
            clientX: event.clientX,
            clientY: event.clientY,
            sketchPoint,
          });
          // T12d D4: zero capture on drag end.
          if (
            actions.endDrag &&
            gesturePhase.target.kind === "sketchTangentHandle" &&
            isWithinZeroCaptureRadius(
              event,
              viewportRect,
              gesturePhase.target as import("@/contracts/shared/references").SketchTangentHandleRef,
            )
          ) {
            // Signal exactZero through the end-drag dispatch.
            sketchGeometryDragEndRef.current(actions.endDrag, {
              exactZero: true,
            });
            // Suppress the normal endDrag dispatch in applyDragGestureActions.
            actions.endDrag = null;
          }
          applyDragGestureActions(actions, canvasElement);
          primaryPointerDownRef.current = null;
          return;
        }
      }

      const pointerDown = primaryPointerDownRef.current;
      primaryPointerDownRef.current = null;

      if (!pointerDown) {
        return;
      }

      // Check pending drag release (fast drag vs click).
      const pending = pendingSketchGeometryDragRef.current;
      if (pending) {
        const gesturePhase: SketchDragGesturePhase = {
          kind: "pending",
          target: pending.target,
          startPoint: pending.startPoint,
          pointerDown,
        };
        const viewportRect = canvasElement.getBoundingClientRect();
        const sketchPoint = projectSketchPoint(
          event.clientX,
          event.clientY,
          viewportRect,
        );
        const actions = resolveSketchDragGesture(gesturePhase, {
          kind: "pointerUp",
          clientX: event.clientX,
          clientY: event.clientY,
          sketchPoint,
        });
        applyDragGestureActions(actions, canvasElement);
        if (actions.consumed) {
          return;
        }
        // Sub-threshold: fall through to click path (pending already cleared
        // by applyDragGestureActions phase → idle).
      } else {
        pendingSketchGeometryDragRef.current = null;
      }

      const dragDistance = Math.hypot(
        event.clientX - pointerDown.x,
        event.clientY - pointerDown.y,
      );

      const activeSketchSession = sketchSessionRef.current;

      if (dragDistance > SKETCH_DRAG_THRESHOLD_PX || !activeSketchSession) {
        return;
      }

      if (activeSketchSession.activeSpecialMode) {
        return;
      }

      const viewportRect = canvasElement.getBoundingClientRect();
      const point = projectSketchPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );
      // The stack is resolved once per physical click, here, and reused by
      // `click`, where `detail` is reliable (T11d, review R-1).
      const pick = resolvePickFromClientPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );
      releasedPickRef.current = {
        x: event.clientX,
        y: event.clientY,
        pick,
      };
      const wiring = pick.sketch
        ? getSketchPickCycleWiring(pick.sketch.stack)
        : null;
      // The release carries what the click will pick: the armed cycle's
      // `stack[next]`, else `stack[0]`.
      const releaseTarget = wiring
        ? getSketchPickPreviewTarget(
            pickCycleRef.current,
            event.clientX,
            event.clientY,
            wiring,
          )
        : (pick.top?.target ?? null);

      if (!point) {
        return;
      }

      // A double-click's second release does not add a fit point; its
      // `dblclick` finalizes the spline (T11-D13).
      const fitPointRelease = resolveSketchFitPointRelease({
        session: activeSketchSession,
        previous: fitPointReleaseRef.current,
        release: { x: event.clientX, y: event.clientY },
      });
      fitPointReleaseRef.current = fitPointRelease.record;
      if (fitPointRelease.dispatch) {
        sketchReleaseRef.current(
          point,
          measureSketchUnitsPerPixel(
            event.clientX,
            event.clientY,
            viewportRect,
          ),
          releaseTarget,
        );
      }
    };

    const handlePointerLeave = (event: PointerEvent) => {
      pickHintTiming.leave();
      nearGapTiming.leave();
      if (sectionDragRef.current === null && !sketchGeometryDragRef.current) {
        cancelSketchGeometryDragMove();
        primaryPointerDownRef.current = null;
        pendingSketchGeometryDragRef.current = null;
      }
      updateSketchHoverStack([]);
      // T14b (T-18/R-2): annotation hover is its own channel. A leave into an
      // interactive annotation hands the hover to it: the chip's own enter and
      // leave own it (React dispatches that enter before this native leave).
      if (
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest("[data-sketch-annotation-layer]")
      ) {
        lastPickedTargetRef.current = null;
        return;
      }
      // T14e/O11: the same hand-over to the Constraints list and linked
      // sketch diagnostics. React dispatches
      // the row's `onPointerEnter` while handling the native `pointerout`,
      // which fires before this native `pointerleave`, so the row's hover is
      // already the editor's: it must not be cleared here. The canvas
      // forgets its own hover, so its next pick is dispatched again.
      if (
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest(
          '[data-sketch-constraint-list], [data-sketch-diagnostic="linked"]',
        )
      ) {
        lastPickedTargetRef.current = null;
        hoverTargetRef.current = null;
        return;
      }
      clearHover();
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button === 0 && chooserDismissPressRef.current) {
        chooserDismissPressRef.current = false;
        return;
      }

      if (
        event.button !== 0 ||
        pointerWithinViewCube(event.clientX, event.clientY)
      ) {
        return;
      }

      const eventTarget = event.target instanceof Node ? event.target : null;
      const isCanvasClick = eventTarget === canvasElement;

      if (!isCanvasClick) {
        return;
      }

      const viewportRect = canvasElement.getBoundingClientRect();
      const sectionHandleHit = getSectionHandleHitFromClientPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );

      if (sectionViewRef.current) {
        if (sectionHandleHit) {
          return;
        }

        return;
      }

      // A click clears the stored overlap; a selecting click on a stack
      // shows that stack's hint again below (T11e).
      clearSketchPickHint();

      // Reuse the stack resolved at this click's pointer-up (T11d, R-1).
      const released = releasedPickRef.current;
      releasedPickRef.current = null;
      const pick =
        released && released.x === event.clientX && released.y === event.clientY
          ? released.pick
          : resolvePickFromClientPoint(
              event.clientX,
              event.clientY,
              viewportRect,
            );
      const resolvedTarget = pick.top;

      if (sketchSessionRef.current?.activeSpecialMode) {
        pickCycleRef.current = null;
        const point = projectSketchPoint(
          event.clientX,
          event.clientY,
          viewportRect,
        );

        if (point) {
          specialModeClickRef.current(point, resolvedTarget?.target ?? null);
        }

        return;
      }

      if (
        shouldViewportClickEventRequestConnectedSketchSelection({
          activeSketchTool: sketchSessionRef.current?.activeTool,
          clickDetail: event.detail,
          sketchStatus: sketchSessionRef.current?.status,
          target: resolvedTarget?.target ?? null,
        })
      ) {
        // Connected selection (`detail >= 2`) resets the cycle.
        pickCycleRef.current = null;
        const target = resolvedTarget?.target;

        if (target) {
          lastPickedTargetRef.current = target;
          connectedSketchSelectRef.current(target);
        }

        return;
      }

      const intent = getViewportCanvasClickIntent({
        activeSketchTool: sketchSessionRef.current?.activeTool,
        hasResolvedTarget: resolvedTarget !== null,
        isBackgroundDatumTarget: resolvedTarget?.renderable
          ? isSeededDatumPlaneRenderable(resolvedTarget.renderable)
          : false,
        selectionFilterKind: selectionFilterRef.current?.kind ?? null,
        // T14g: an open wheel makes it a first-stage blank too.
        activeAnnotation:
          isAnnotationTarget(selectionRef.current[0] ?? null) ||
          annotationWheelOpenRef.current,
        topPickClass: pick.sketch?.stack[0]?.pickClass ?? null,
      });

      // A consumed first-stage blank (T14c R-9) resets the cycle too; the
      // hint was cleared above.
      if (intent === "clearSelection") {
        pickCycleRef.current = null;
        deselectRef.current();
        return;
      }

      if (intent === "ignore" || !resolvedTarget) {
        pickCycleRef.current = null;
        return;
      }

      const wiring = pick.sketch
        ? getSketchPickCycleWiring(pick.sketch.stack)
        : null;

      if (!wiring) {
        lastPickedTargetRef.current = resolvedTarget.target;
        selectRef.current(
          resolvedTarget.target,
          getViewportCameraPosition() ?? undefined,
        );
        return;
      }

      const at = pick.sketch
        ? { x: event.clientX, y: event.clientY, sketch: pick.sketch }
        : null;

      // Alt+click with ≥ 2 eligible candidates opens the chooser at the
      // click point; otherwise it is a plain click (T11e, T11-D6).
      if (at && event.altKey && event.detail === 1) {
        if (openSketchPickChooser(at)) {
          updateSketchPickHint(
            at,
            getSketchPickPreviewTarget(
              pickCycleRef.current,
              at.x,
              at.y,
              wiring,
            ),
            wiring,
            true,
          );
          return;
        }
      }

      const clicked = resolveSketchPickClick(
        pickCycleRef.current,
        { x: event.clientX, y: event.clientY, detail: event.detail },
        wiring,
      );
      pickCycleRef.current = clicked.cycle;

      if (!clicked.target) {
        return;
      }

      lastPickedTargetRef.current = clicked.target;
      selectRef.current(
        clicked.target,
        getViewportCameraPosition() ?? undefined,
        clicked.replaces ?? undefined,
      );

      if (at) {
        updateSketchPickHint(at, clicked.preview, wiring, true);
      }

      // The hover now previews what the next click would pick (the
      // selection transition has just hovered the selected target).
      if (
        clicked.preview &&
        !primitiveRefEquals(clicked.preview, clicked.target)
      ) {
        hoverTargetRef.current = clicked.preview;
        hoverRef.current(clicked.preview);
      }
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        pointerWithinViewCube(event.clientX, event.clientY)
      ) {
        return;
      }

      const eventTarget = event.target instanceof Node ? event.target : null;
      const isCanvasClick = eventTarget === canvasElement;

      if (!isCanvasClick) {
        return;
      }

      const viewportRect = canvasElement.getBoundingClientRect();
      const resolvedTarget = getPickTargetFromClientPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      );

      if (sketchSessionRef.current?.activeSpecialMode) {
        const point = projectSketchPoint(
          event.clientX,
          event.clientY,
          viewportRect,
        );

        if (point) {
          specialModeDoubleClickRef.current(
            point,
            resolvedTarget?.target ?? null,
          );
        }

        return;
      }

      // A double-click with a spline draft finalizes it (Enter's step, so
      // < 2 points does nothing), never a connected selection (T11-D13).
      if (isSketchFitPointDraftActive(sketchSessionRef.current)) {
        sketchDrawFinalizeRef.current();
        return;
      }

      if (resolvedTarget?.target?.kind === "sketchOperation") {
        const point = projectSketchPoint(
          event.clientX,
          event.clientY,
          viewportRect,
        );

        if (point) {
          specialModeDoubleClickRef.current(point, resolvedTarget.target);
        }

        return;
      }

      if (
        !shouldViewportDoubleClickRequestConnectedSketchSelection({
          activeSketchTool: sketchSessionRef.current?.activeTool,
          sketchStatus: sketchSessionRef.current?.status,
          target: resolvedTarget?.target ?? null,
        })
      ) {
        return;
      }

      const target = resolvedTarget?.target;

      if (!target) {
        return;
      }

      lastPickedTargetRef.current = target;
      connectedSketchSelectRef.current(target);
    };

    const handleContextMenu = (event: Event) => event.preventDefault();

    // D2: pointercancel cancels the drag.
    const handlePointerCancel = () => {
      const gesturePhase = getSketchDragGesturePhase();
      const actions = resolveSketchDragGesture(gesturePhase, {
        kind: "pointerCancel",
      });
      applyDragGestureActions(actions, canvasElement);
      primaryPointerDownRef.current = null;
    };

    // D2: lost pointer capture (not caused by our own release) cancels the drag.
    const handleLostPointerCapture = () => {
      const gesturePhase = getSketchDragGesturePhase();
      const actions = resolveSketchDragGesture(gesturePhase, {
        kind: "lostPointerCapture",
      });
      applyDragGestureActions(actions, canvasElement);
      if (gesturePhase.kind === "active") {
        primaryPointerDownRef.current = null;
      }
    };

    canvasElement.addEventListener("pointerdown", handlePointerDown, true);
    canvasElement.addEventListener("pointermove", handlePointerMove);
    canvasElement.addEventListener("pointerleave", handlePointerLeave);
    canvasElement.addEventListener("pointercancel", handlePointerCancel);
    canvasElement.addEventListener(
      "lostpointercapture",
      handleLostPointerCapture,
    );
    canvasElement.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("click", handleClick, true);
    window.addEventListener("dblclick", handleDoubleClick, true);

    return () => {
      cancelSketchGeometryDragMove();
      projectSketchClientPointRef.current = () => null;
      if (
        sectionDragRef.current &&
        canvasElement.hasPointerCapture(sectionDragRef.current.pointerId)
      ) {
        canvasElement.releasePointerCapture(sectionDragRef.current.pointerId);
      }
      const dragPointerId = sketchGeometryDragPointerIdRef.current;
      if (
        dragPointerId !== null &&
        canvasElement.hasPointerCapture(dragPointerId)
      ) {
        canvasElement.releasePointerCapture(dragPointerId);
      }
      sectionDragRef.current = null;
      sectionDragOffsetRef.current = null;
      primaryPointerDownRef.current = null;
      sketchGeometryDragRef.current = null;
      sketchGeometryDragPointerIdRef.current = null;
      pendingSketchGeometryDragRef.current = null;
      canvasElement.removeEventListener("pointerdown", handlePointerDown, true);
      canvasElement.removeEventListener("pointermove", handlePointerMove);
      canvasElement.removeEventListener("pointerleave", handlePointerLeave);
      canvasElement.removeEventListener("pointercancel", handlePointerCancel);
      canvasElement.removeEventListener(
        "lostpointercapture",
        handleLostPointerCapture,
      );
      canvasElement.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("dblclick", handleDoubleClick, true);
    };
  }, [
    cancelSketchGeometryDragMove,
    canvasReadyVersion,
    pickHintTiming,
    nearGapTiming,
    clearSketchPickHint,
    closeSketchPickChooser,
    openSketchPickChooser,
    scheduleSketchGeometryDragMove,
    updateSketchHoverStack,
  ]);

  useEffect(() => {
    // Same gate as `__cadaraDebug`: dev, or a build with TEST = "true" (the
    // offline E2E sub-lane's production build, `vite.offline-test.config.ts`).
    if (!isCadaraDebugPlatformEnabled()) {
      return;
    }

    window.__cadFlushCameraDamping = () => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      // Controls change events invalidate the demand-rendered canvas as usual.
      return Boolean(
        camera && controls && flushViewportCameraDamping(camera, controls),
      );
    };
    window.__cadProjectToScreen = (objectId: string) => {
      const viewportElement = viewportRef.current;
      const rect = viewportElement?.getBoundingClientRect();

      const projected = projectSceneTargetCentroidToViewport({
        root: pickRootRef.current,
        camera: cameraRef.current,
        objectId,
        viewport: {
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
        },
      });
      if (!projected) {
        return null;
      }
      // Return coordinates relative to the legacy positioning marker so e2e
      // helpers can use a single bbox source for both projected and hardcoded
      // pointer coordinates. See `LEGACY_VIEWPORT_LEFT_INSET_PX`.
      return {
        x: projected.x - LEGACY_VIEWPORT_LEFT_INSET_PX,
        y: projected.y,
      };
    };

    return () => {
      delete window.__cadFlushCameraDamping;
      delete window.__cadProjectToScreen;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    window.__cadProjectSectionHandleToScreen = () => {
      const viewportElement = viewportRef.current;
      const section = sectionViewRef.current;
      const camera = cameraRef.current;
      const rect = viewportElement?.getBoundingClientRect();

      if (!section || !camera || !rect) {
        return null;
      }

      const handle = projectWorldPointToViewport({
        camera,
        point: getSectionPlaneOrigin(section),
        viewport: {
          width: rect.width,
          height: rect.height,
        },
      });
      const normal = projectWorldPointToViewport({
        camera,
        point: [
          section.plane.frame.origin[0] +
            section.plane.frame.normal[0] * (section.offset + 1),
          section.plane.frame.origin[1] +
            section.plane.frame.normal[1] * (section.offset + 1),
          section.plane.frame.origin[2] +
            section.plane.frame.normal[2] * (section.offset + 1),
        ],
        viewport: {
          width: rect.width,
          height: rect.height,
        },
      });

      // Reproject to legacy positioning marker space — see `__cadProjectToScreen`.
      if (!handle) {
        return null;
      }
      return {
        handle: { x: handle.x - LEGACY_VIEWPORT_LEFT_INSET_PX, y: handle.y },
        normal: normal
          ? { x: normal.x - LEGACY_VIEWPORT_LEFT_INSET_PX, y: normal.y }
          : null,
        offset: section.offset,
      };
    };

    return () => {
      delete window.__cadProjectSectionHandleToScreen;
    };
  }, [activeSectionView]);

  return (
    <div
      ref={viewportRef}
      className="relative"
      style={{
        position: "absolute",
        top: VIEWPORT_CANVAS_TOP_INSET_PX,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {/*
        Legacy positioning marker for e2e harnesses. Sits inside the canvas at the
        sub-region the structural shell used to reserve (1080×912 at left:180,
        top:0 within the cad-viewport ref). Hardcoded pointer coordinates in
        e2e specs (`hoverViewportAtReal({ x, y })`) translate through this marker's
        boundingBox so they continue to hit the same world points they did under
        the structural shell. See LEGACY_VIEWPORT_* constants in
        `viewport-overlay-layout.ts`.
       */}
      <div
        data-testid="cad-viewport"
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: LEGACY_VIEWPORT_LEFT_INSET_PX,
          width: LEGACY_VIEWPORT_WIDTH_PX,
          height: LEGACY_VIEWPORT_HEIGHT_PX,
          pointerEvents: "none",
        }}
      />
      <ViewportCanvas
        createRenderer={createRenderer}
        onGraphicsFailure={onGraphicsFailure}
        onCreated={({ camera, gl }) => {
          const viewportCamera =
            camera instanceof THREE.OrthographicCamera ||
            camera instanceof THREE.PerspectiveCamera
              ? camera
              : createViewportCamera(DEFAULT_VIEWPORT_PROJECTION_MODE, 1);
          applyViewportCameraFrameToCamera(
            viewportCamera,
            getDefaultViewportCameraFrame(),
          );
          cameraRef.current = viewportCamera;
          canvasElementRef.current = gl.domElement;
          // Focusable without a tab stop, so focus can return to it when
          // the candidate chooser closes (T11e).
          gl.domElement.tabIndex = -1;
          gl.domElement.style.outline = "none";
          gl.domElement.setAttribute("aria-label", "3D viewport");
          canvasCreatedRef.current?.();
          setCanvasReadyVersion((current) => current + 1);
          gl.setClearColor(0x000000, 0);
        }}
      >
        <ViewportProjectionCameraController
          projectionMode={projectionMode}
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          pendingFrameRef={pendingProjectionFrameRef}
          controlsReadyVersion={controlsReadyVersion}
        />
        <ViewportInitialCameraFraming
          documentId={model.documentId}
          renderables={renderables}
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          controlsReadyVersion={controlsReadyVersion}
          sketchSessionActive={Boolean(sketchSession)}
          cameraTransitionVersion={viewportTransitionVersion}
        />
        <ViewportCameraTransitionDriver
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          transitionControllerRef={cameraTransitionControllerRef}
          transitionVersion={viewportTransitionVersion}
        />
        <ViewportInvalidationBridge
          controlsReadyVersion={controlsReadyVersion}
          controlsRef={controlsRef}
          invalidationKey={viewportInvalidationKey}
        />
        <ambientLight color={0xd7dfe9} intensity={0.56} />
        <hemisphereLight
          args={[0xe8edf5, 0x253447, 0.62]}
          position={[0, 0, 1]}
        />
        <directionalLight args={[0xf5eee2, 1.45]} position={[14, -16, 28]} />
        <directionalLight args={[0x91b4d8, 0.52]} position={[-12, 14, 18]} />
        <directionalLight args={[0xb6d6f5, 0.18]} position={[-14, -10, 12]} />
        <WorkspaceSceneScaffold />
        <SketchProjectionFrameWatcher
          enabled={Boolean(sketchSession)}
          onCameraChanged={() => {
            updateSketchFeedbackProjections();
            // The stored overlap's screen point is stale, and so is an open
            // chooser's anchor (T11e review A-1, re-review N-1).
            clearSketchPickHint();
            if (chooserRef.current) closeSketchPickChooser();
            // The last fit-point release's screen point is stale too: a
            // click at that pixel is a new sketch point (T11i review A-1).
            fitPointReleaseRef.current = null;
          }}
        />
        <BodyLodWatcher
          enabled={!sketchSession}
          renderables={renderables}
          onLodTierChange={(tierId) => lodTierChangeRef.current(tierId)}
        />
        <RenderIdleSignal
          isEditorIdle={isEditorRenderIdle}
          sceneKey={bvhSceneKey}
          viewportRef={viewportRef}
        />
        <FirstNonEmptyGeometryFrameSignal
          hasNonEmptyGeometry={hasNonEmptyCommittedGeometry}
          onReady={() => firstNonEmptyGeometryFrameRef.current?.()}
        />
        <Bvh key={bvhSceneKey} enabled>
          <ViewportPickRoot
            rootRef={pickRootRef}
            commitToken={pickRootCommitToken}
            onCommit={handlePickRootCommit}
          >
            {renderables.map((entry) => (
              <DocumentRenderableNode
                key={`${entry.origin}:${entry.renderable.id}`}
                entry={entry}
                palette={sketchRenderingPalette}
                clippingPlane={activeSectionClippingPlane}
              />
            ))}
            {sketchDisplayRenderables.map((renderable) => (
              <SketchDisplayRenderableNode
                key={renderable.id}
                renderable={renderable}
                applyStyles={sketchDisplayStylesEnabled}
                palette={sketchRenderingPalette}
                markerContext={sketchMarkerContext}
              />
            ))}
          </ViewportPickRoot>
        </Bvh>
        <MeasurementWitnessLayer witnesses={measurementWitnesses} />
        {activeSectionView ? (
          <>
            <SectionCapLayer caps={activeSectionCaps} />
            <SectionViewOverlay
              bounds={activeSectionBounds}
              section={activeSectionView}
            />
          </>
        ) : null}
        <OrbitControls
          ref={handleControlsRef}
          makeDefault
          onStart={() => {
            cameraTransitionControllerRef.current.cancel();
            closeAnnotationWheel();
          }}
          target={[0, 0, 4]}
          enableDamping
          dampingFactor={0.08}
          screenSpacePanning
          mouseButtons={{
            LEFT: -1 as THREE.MOUSE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
        />
      </ViewportCanvas>
      <div
        ref={viewCubeColumnRef}
        className="pointer-events-none absolute right-4 z-20 flex flex-col items-end gap-1"
        style={{
          top: VIEWPORT_OVERLAY_TOP_INSET_STYLE,
          width: `min(${VIEW_CUBE_SIZE_PX}px, calc(100% - 32px))`,
        }}
      >
        <div
          ref={viewCubeRef}
          data-testid="view-cube"
          className="pointer-events-auto w-full"
          style={{ aspectRatio: "1 / 1" }}
        />
        <ViewportProjectionSelector
          projectionMode={projectionMode}
          onProjectionModeChange={handleProjectionModeChange}
        />
        {activeSectionView ? (
          <div className="pointer-events-auto flex items-center gap-2">
            <Button
              size="compact-xs"
              variant="filled"
              color="gray"
              onClick={() => sectionFlipRef.current()}
            >
              Flip
            </Button>
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => sectionClearRef.current()}
            >
              Clear
            </Button>
          </div>
        ) : null}
      </div>
      {/* Overlap hint (T11d, T11-D7) with its "Choose…" button (T11e, A-8). */}
      <div
        className="pointer-events-none absolute z-20"
        style={{
          maxWidth: SKETCH_PICK_HINT_SLOT_WIDTH_PX,
          left: SKETCH_PICK_HINT_LEFT_PX,
          top: VIEWPORT_OVERLAY_TOP_INSET_STYLE,
        }}
      >
        <SketchPickHint
          hint={
            sketchSession &&
            pickHint?.definition === sketchDefinition &&
            pickHint.activeTool === sketchActiveTool
              ? pickHint.hint
              : null
          }
          onChoose={() => {
            const overlap = pickHint?.overlap;
            // Nothing to choose any more (the selection or its filter
            // changed): the hint goes (T11e review A-2).
            if (!overlap || !openSketchPickChooser(overlap)) {
              clearSketchPickHint();
            }
          }}
          nearGap={nearGapHint}
          onMerge={() => {
            if (!nearGapHint || !sketchHoverScope) return;
            const sketchId = sketchHoverScope as SketchId;
            // Arms Merge Points source → staged destination; the merge
            // itself still needs Enter or the floating Merge (T13k).
            onIntent({
              type: "sketchMergeOffered",
              source: createSketchPointRef(sketchId, nearGapHint.sourcePointId),
              destination: createSketchPointRef(
                sketchId,
                nearGapHint.destinationPointId,
              ),
            });
            focusCanvas();
          }}
        />
      </div>
      <SketchNearGapGlyphs gaps={sketchSession ? sketchNearGaps : []} />
      <SketchPickChooser
        chooser={sketchSession ? chooser : null}
        onPick={pickFromSketchPickChooser}
        onPreview={(item) => setViewportHover(item.target)}
        onClose={closeSketchPickChooser}
      />
      <SketchViewportFeedbackLayer
        schema={sketchToolPresentation}
        projections={sketchFeedbackProjections}
        documentVariableNames={model.documentVariableNames}
        onPatch={(patch) => sketchToolPatchRef.current(patch)}
        onDragHandle={(handle, clientX, clientY, gesturePhase) => {
          const point = projectSketchClientPointRef.current(clientX, clientY);
          if (point) {
            sketchToolPatchRef.current({
              intent: handle.dimensionId
                ? "setDimensionAnnotationPlacement"
                : "setConstraintAnnotationPlacement",
              handleId: handle.id,
              handleKind: handle.kind,
              dimensionId: handle.dimensionId,
              point,
              gesturePhase,
              clientPoint: [clientX, clientY],
            });
          }
        }}
      />
      <SketchDragFeedbackCue cue={dragFeedbackCue} />
      <SketchSpecialModeViewportFeedback
        presentation={specialModePresentation}
        projections={specialModeFeedbackProjections}
        onHandleDragStart={(handle, clientX, clientY) => {
          const point = projectSketchClientPointRef.current(clientX, clientY);
          if (point) {
            specialModeDragStartRef.current(handle, point);
          }
        }}
        onHandleDragMove={(handle, clientX, clientY) => {
          const point = projectSketchClientPointRef.current(clientX, clientY);
          if (point) {
            specialModeDragMoveRef.current(handle, point);
          }
        }}
        onHandleDragEnd={(handle, clientX, clientY) => {
          const point = projectSketchClientPointRef.current(clientX, clientY);
          if (point) {
            specialModeDragEndRef.current(handle, point);
          }
        }}
      />
      <SketchConstraintAnnotations
        annotations={sketchAnnotations}
        projections={sketchAnnotationProjections}
        viewport={sketchAnnotationDomFrame.viewport}
        obstacles={sketchAnnotationObstacles}
        hoveredAnnotation={isAnnotationTarget(hoverTarget) ? hoverTarget : null}
        hoverTarget={hoverTarget}
        selection={selection}
        annotationContext={annotationContext}
        showAll={showAllAnnotations}
        entityScreenExtents={sketchEntityScreenExtents}
        definition={sketchSession?.definition ?? null}
        interactive={isSketchAnnotationIdleContext(
          sketchSession,
          chooser !== null,
        )}
        onHover={(target) => {
          hoverTargetRef.current = target;
          hoverRef.current(target);
        }}
        onClearHover={() => {
          if (hoverTargetRef.current !== null) {
            hoverTargetRef.current = null;
          }
          clearHoverRef.current();
        }}
        onSelect={(target) => {
          // T-2: an annotation click resets the pick cycle and clears the
          // sticky overlap hint, as a canvas click does.
          pickCycleRef.current = null;
          clearSketchPickHint();
          selectRef.current(target);
        }}
        onEdit={(target) => annotationEditRef.current(target)}
        onOpenAnnotationWheel={(clusterKey, members) => {
          // T14g (T-10): opening the wheel resets the pick cycle and clears
          // the sticky hint; the chooser cannot be open (`+N` is passive
          // while it is, T-5).
          pickCycleRef.current = null;
          clearSketchPickHint();
          annotationWheelOpenRef.current = true;
          onIntent({ type: "annotationWheelOpened", clusterKey, members });
        }}
        onCloseAnnotationWheel={() => {
          annotationWheelOpenRef.current = false;
          onIntent({ type: "annotationWheelClosed" });
        }}
        onAnnotationWheelListFilter={(filtered) =>
          onIntent({ type: "annotationWheelListFilterChanged", filtered })
        }
        onWheel={(event) => {
          // T14b review A-6: the camera controls listen on the canvas only;
          // a wheel over an interactive chip zooms as it would beside it.
          canvasElementRef.current?.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              deltaZ: event.deltaZ,
              deltaMode: event.deltaMode,
              clientX: event.clientX,
              clientY: event.clientY,
              screenX: event.screenX,
              screenY: event.screenY,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              altKey: event.altKey,
              metaKey: event.metaKey,
            }),
          );
        }}
        onDimensionDrag={(handle, clientX, clientY, gesturePhase, grab) => {
          const point = getDimensionLabelDragPoint(
            grab,
            clientX,
            clientY,
            projectSketchClientPointRef.current,
          );
          if (point) {
            sketchToolPatchRef.current({
              ...createDimensionAnnotationPlacementPatch(handle, point),
              gesturePhase,
              clientPoint: [clientX, clientY],
            });
          }
        }}
      />
    </div>
  );
}
