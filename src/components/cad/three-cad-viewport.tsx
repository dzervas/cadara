// SLOP: Retained viewport renderer while the workbench/viewport port boundary is introduced and hidden context reads are removed.
import { Button } from "@mantine/core";
import { Canvas } from "@react-three/fiber";
import { Bvh, OrbitControls } from "@react-three/drei";
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
import { SketchSpecialModeViewportFeedback } from "@/components/cad/sketch-special-mode-viewport-feedback";
import { SketchConstraintAnnotations } from "@/components/cad/sketch-constraint-annotations";
import { shouldApplySketchDisplayStyles } from "@/components/cad/sketch-display-style";
import { resolveSketchRenderingPalette } from "@/components/cad/sketch-rendering-palette";
import {
  collectSketchViewportFeedbackAnchors,
  getAnnotationProjectionId,
  type SketchViewportFeedbackProjection,
} from "@/components/cad/sketch-viewport-feedback-model";
import {
  collectSketchSpecialModeFeedbackAnchors,
  type SketchSpecialModeFeedbackProjection,
} from "@/components/cad/sketch-special-mode-feedback-model";
import { createDimensionAnnotationPlacementPatch } from "@/components/cad/three-cad-viewport-annotation-drag";
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
  SketchPickChooser,
  type SketchPickChooserModel,
} from "@/components/cad/sketch-pick-chooser";
import {
  createSketchPickChooserItems,
  createSketchPickHint,
  getSketchPickHintText,
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
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import {
  collectBindings,
  collectRaycastPickCandidates,
  type CollectedBindings,
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
import { getSketchSessionDisplayDefinition } from "@/domain/editor/sketch-session/internals";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { createViewportCameraTransitionController } from "@/infrastructure/viewport/viewport-camera-transition";
import {
  getViewportCanvasClickIntent,
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
import {
  LEGACY_VIEWPORT_HEIGHT_PX,
  LEGACY_VIEWPORT_LEFT_INSET_PX,
  LEGACY_VIEWPORT_WIDTH_PX,
  VIEWPORT_CANVAS_TOP_INSET_PX,
  VIEWPORT_OVERLAY_TOP_INSET_STYLE,
  VIEW_CUBE_SIZE_PX,
} from "@/components/cad/viewport-overlay-layout";
import {
  cancelCoalescedSketchGeometryDragMove,
  createViewportInvalidationKey,
  createViewportBvhSceneKey,
  getViewportPickTuning,
  isViewportNavigationPointerMove,
  projectWorldPointToViewport,
  projectSceneTargetCentroidToViewport,
  resolveSectionScreenDragOffset,
  resizeViewCubeRenderer,
  scheduleCoalescedSketchGeometryDragMove,
} from "@/components/cad/three-cad-viewport-helpers";

/** The sketch pick stack at one pointer position, with each entry's class. */
interface SketchStackPick {
  stack: (PickResult & { pickClass: SketchPickClass })[];
  displayDefinition: SketchDefinition;
}

/** A stack and the client point it was resolved at. */
interface SketchStackPickAt {
  x: number;
  y: number;
  sketch: SketchStackPick;
}

interface ThreeCadViewportProps {
  model: ViewportModel;
  commands: readonly ViewportCommand[];
  onIntent: (intent: ViewportIntent) => void;
}

export function ThreeCadViewport({
  model,
  commands,
  onIntent,
}: ThreeCadViewportProps) {
  const {
    activeSectionView,
    hoverTarget,
    measurementWitnesses,
    renderables,
    sketchDisplayRenderables,
    sketchAnnotations,
    selection,
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
    (point: readonly [number, number]) =>
      onIntent({ type: "sketchPointerMoved", point }),
    [onIntent],
  );
  const onSketchRelease = useCallback(
    (point: readonly [number, number], target?: PrimitiveRef | null) =>
      onIntent({ type: "sketchPointerReleased", point, target }),
    [onIntent],
  );
  const onSketchGeometryDragStart = useCallback(
    (target: PrimitiveRef, point: readonly [number, number]) =>
      onIntent({ type: "sketchGeometryDragStarted", target, point }),
    [onIntent],
  );
  const onSketchGeometryDragMove = useCallback(
    (point: readonly [number, number]) =>
      onIntent({ type: "sketchGeometryDragMoved", point }),
    [onIntent],
  );
  const onSketchGeometryDragEnd = useCallback(
    (point: readonly [number, number]) =>
      onIntent({ type: "sketchGeometryDragEnded", point }),
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
  const [specialModeFeedbackProjections, setSpecialModeFeedbackProjections] =
    useState<SketchSpecialModeFeedbackProjection[]>([]);
  const [viewportTransitionVersion, setViewportTransitionVersion] = useState(0);
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const sketchPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const sketchHitPointRef = useRef(new THREE.Vector3());
  const primaryPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const sketchGeometryDragRef = useRef<{ target: PrimitiveRef } | null>(null);
  const sectionDragRef = useRef<{
    pointerId: number;
    sectionAtDragStart: SectionViewSession;
    dragStartClientPoint: { x: number; y: number };
  } | null>(null);
  const sectionDragOffsetRef = useRef<number | null>(null);
  const pendingSketchGeometryDragPointRef = useRef<
    readonly [number, number] | null
  >(null);
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
  const releasedPickRef = useRef<{
    x: number;
    y: number;
    pick: {
      top: PickResult | null;
      sketch: SketchStackPick | null;
    };
  } | null>(null);
  // The overlap the hint shows (sticky until another stack is hovered, a
  // click, or a definition/tool change; T11e) and the open chooser's pick
  // context (T11-D6).
  const pickOverlapRef = useRef<SketchStackPickAt | null>(null);
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
  // The hint with the definition and tool it was computed for; it shows
  // only while both are current (review A-3).
  const [pickHint, setPickHint] = useState<{
    hint: SketchPickHintModel | null;
    definition: unknown;
    activeTool: unknown;
  }>({ hint: null, definition: null, activeTool: null });
  const pickHintTextRef = useRef<string | null>(null);
  const lastFitViewRequestIdRef = useRef(fitViewRequestId);
  const pendingFitViewRequestIdRef = useRef<number | null>(null);
  const selectRef = useRef(onSelect);
  const connectedSketchSelectRef = useRef(onConnectedSketchSelect);
  const deselectRef = useRef(onDeselect);
  const annotationEditRef = useRef(onAnnotationEdit);
  const clearHoverRef = useRef(onClearHover);
  const sketchMoveRef = useRef(onSketchMove);
  const sketchReleaseRef = useRef(onSketchRelease);
  const sketchGeometryDragStartRef = useRef(onSketchGeometryDragStart);
  const sketchGeometryDragMoveRef = useRef(onSketchGeometryDragMove);
  const sketchGeometryDragEndRef = useRef(onSketchGeometryDragEnd);
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
  const sketchSessionRef = useRef(sketchSession);
  const acceptsSpecialModeTargetRef = useRef(
    capabilities.acceptsSpecialModeTarget,
  );
  const sectionViewRef = useRef(activeSectionView);
  const renderablesRef = useRef(renderables);
  const sketchDisplayRenderablesRef = useRef(sketchDisplayRenderables);
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
    [],
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
      if (cameraRef.current && controlsRef.current) {
        pendingProjectionFrameRef.current = captureViewportCameraFrame(
          cameraRef.current,
          controlsRef.current,
        );
      }

      projectionModeRef.current = nextMode;
      setProjectionMode(nextMode);
    },
    [projectionMode],
  );
  const scheduleSketchGeometryDragMove = useCallback(
    (point: readonly [number, number]) => {
      scheduleCoalescedSketchGeometryDragMove({
        point,
        pendingPointRef: pendingSketchGeometryDragPointRef,
        pendingFrameIdRef: pendingSketchGeometryDragFrameIdRef,
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        isDragActive: () => sketchGeometryDragRef.current !== null,
        onMove: (latestPoint) => sketchGeometryDragMoveRef.current(latestPoint),
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
  const annotationHighlightTargets = useMemo(
    () =>
      getAnnotationHighlightTargets(sketchAnnotations, selection, hoverTarget),
    [hoverTarget, selection, sketchAnnotations],
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
    sketchGeometryDragStartRef.current = onSketchGeometryDragStart;
    sketchGeometryDragMoveRef.current = onSketchGeometryDragMove;
    sketchGeometryDragEndRef.current = onSketchGeometryDragEnd;
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
    onSketchGeometryDragEnd,
    onSketchGeometryDragMove,
    onSketchGeometryDragStart,
    onSketchMove,
    onSketchRelease,
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
    bvhSceneKeyRef.current = bvhSceneKey;
  }, [
    activeSectionBounds,
    activeSectionView,
    bvhSceneKey,
    renderables,
    sketchDisplayRenderables,
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
  useEffect(() => {
    pickCycleRef.current = null;
    pickHintTextRef.current = null;
    pickOverlapRef.current = null;
    if (detachSketchPickChooser()) focusCanvas();
  }, [
    detachSketchPickChooser,
    focusCanvas,
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
    pickOverlapRef.current = null;
    if (pickHintTextRef.current !== null) {
      pickHintTextRef.current = null;
      setPickHint({ hint: null, definition: null, activeTool: null });
    }
  }, []);

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
      return true;
    },
    [closeSketchPickChooser, detachSketchPickChooser],
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
  }, [
    sketchAnnotations,
    sketchSession?.plane,
    sketchToolPresentation,
    specialModePresentation,
  ]);
  const updateSketchFeedbackProjectionsRef = useRef(
    updateSketchFeedbackProjections,
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

    const viewCubeScene = createViewCubeScene();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
      cubeElement.removeChild(renderer.domElement);
    };
  }, [controlsReadyVersion, requestCameraTransition]);

  useLayoutEffect(() => {
    bindingsRef.current = collectBindings(pickRootRef.current);
    bindingsSceneKeyRef.current = bvhSceneKey;
    const bindings = bindingsRef.current;

    if (bindings) {
      updateWorkspaceHighlight(
        bindings.targetToObjects,
        selection,
        hoverTarget,
        annotationHighlightTargets,
      );
    }
  }, [annotationHighlightTargets, bvhSceneKey, hoverTarget, selection]);

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
      raycasterRef.current.params.Line.threshold = pickTuning.linePickThreshold;
      (
        raycasterRef.current as THREE.Raycaster & { firstHitOnly?: boolean }
      ).firstHitOnly = false;

      const intersections = raycasterRef.current.intersectObjects(
        bindings.pickables,
        true,
      );
      const sketchSession = sketchSessionRef.current;
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
        sketch: { stack, displayDefinition: sketchDisplayDefinition },
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
     * (T11e). Empty space never calls this, so the last overlap stays.
     */
    const updateSketchPickHint = (
      at: SketchStackPickAt,
      previewTarget: PrimitiveRef | null,
      wiring: SketchPickCycleWiring | null,
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
      pickOverlapRef.current = hint ? at : null;
      const text = hint ? getSketchPickHintText(hint) : null;

      if (text !== pickHintTextRef.current) {
        pickHintTextRef.current = text;
        setPickHint({
          hint,
          definition: session?.definition ?? null,
          activeTool: session?.activeTool ?? null,
        });
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

    projectSketchClientPointRef.current = (clientX, clientY) =>
      projectSketchPoint(
        clientX,
        clientY,
        canvasElement.getBoundingClientRect(),
      );

    // The overlap hint stays (sticky last overlap, T11e).
    const clearHover = () => {
      lastPickedTargetRef.current = null;
      if (hoverTargetRef.current !== null) {
        hoverTargetRef.current = null;
        clearHoverRef.current();
      }
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

      if (sketchGeometryDragRef.current) {
        const point = projectSketchPoint(
          event.clientX,
          event.clientY,
          viewportRect,
        );

        if (point) {
          scheduleSketchGeometryDragMove(point);
        }

        return;
      }

      const pendingSketchGeometryDrag = pendingSketchGeometryDragRef.current;
      const pointerDown = primaryPointerDownRef.current;

      if (pendingSketchGeometryDrag && pointerDown) {
        const dragDistance = Math.hypot(
          event.clientX - pointerDown.x,
          event.clientY - pointerDown.y,
        );

        if (dragDistance > 6) {
          const point = projectSketchPoint(
            event.clientX,
            event.clientY,
            viewportRect,
          );

          if (point) {
            event.preventDefault();
            event.stopPropagation();
            sketchGeometryDragRef.current = {
              target: pendingSketchGeometryDrag.target,
            };
            pendingSketchGeometryDragRef.current = null;
            sketchGeometryDragStartRef.current(
              pendingSketchGeometryDrag.target,
              pendingSketchGeometryDrag.startPoint,
            );
            scheduleSketchGeometryDragMove(point);
          }

          return;
        }
      }

      if (isViewportNavigationPointerMove(event.buttons)) {
        return;
      }

      if (pointerWithinViewCube(event.clientX, event.clientY)) {
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

      // Any stack replaces the hint (T11e); empty space keeps it.
      if (pick.sketch && pick.sketch.stack.length > 0) {
        updateSketchPickHint(
          { x: event.clientX, y: event.clientY, sketch: pick.sketch },
          target,
          wiring,
        );
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
        sketchMoveRef.current(point);
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
      const resolvedTarget = getPickTargetFromClientPoint(
        event.clientX,
        event.clientY,
        viewportRect,
      )?.target;
      const dragTarget =
        resolvedTarget?.kind === "sketchPoint"
          ? resolvedTarget
          : lastPickedTargetRef.current?.kind === "sketchPoint"
            ? lastPickedTargetRef.current
            : hoverTargetRef.current?.kind === "sketchPoint"
              ? hoverTargetRef.current
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
        cancelSketchGeometryDragMove();
        primaryPointerDownRef.current = null;
        sketchGeometryDragRef.current = null;
        pendingSketchGeometryDragRef.current = null;
        return;
      }

      const activeSketchDrag = sketchGeometryDragRef.current;
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

      if (activeSketchDrag) {
        const viewportRect = canvasElement.getBoundingClientRect();
        const point = projectSketchPoint(
          event.clientX,
          event.clientY,
          viewportRect,
        );

        cancelSketchGeometryDragMove();
        if (point) {
          sketchGeometryDragEndRef.current(point);
        }

        sketchGeometryDragRef.current = null;
        primaryPointerDownRef.current = null;
        pendingSketchGeometryDragRef.current = null;
        return;
      }

      const pointerDown = primaryPointerDownRef.current;
      primaryPointerDownRef.current = null;

      if (!pointerDown) {
        return;
      }

      const dragDistance = Math.hypot(
        event.clientX - pointerDown.x,
        event.clientY - pointerDown.y,
      );

      const pendingSketchGeometryDrag = pendingSketchGeometryDragRef.current;
      pendingSketchGeometryDragRef.current = null;

      if (pendingSketchGeometryDrag && dragDistance > 6) {
        const viewportRect = canvasElement.getBoundingClientRect();
        const point = projectSketchPoint(
          event.clientX,
          event.clientY,
          viewportRect,
        );

        if (point) {
          sketchGeometryDragStartRef.current(
            pendingSketchGeometryDrag.target,
            pendingSketchGeometryDrag.startPoint,
          );
          sketchGeometryDragEndRef.current(point);
        }

        return;
      }

      const activeSketchSession = sketchSessionRef.current;

      if (dragDistance > 6 || !activeSketchSession) {
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

      if (point) {
        sketchReleaseRef.current(point, releaseTarget);
      }
    };

    const handlePointerLeave = () => {
      if (sectionDragRef.current === null && !sketchGeometryDragRef.current) {
        cancelSketchGeometryDragMove();
        primaryPointerDownRef.current = null;
        pendingSketchGeometryDragRef.current = null;
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
      });

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
        updateSketchPickHint(at, clicked.preview, wiring);
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

    canvasElement.addEventListener("pointerdown", handlePointerDown, true);
    canvasElement.addEventListener("pointermove", handlePointerMove);
    canvasElement.addEventListener("pointerleave", handlePointerLeave);
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
      sectionDragRef.current = null;
      sectionDragOffsetRef.current = null;
      primaryPointerDownRef.current = null;
      sketchGeometryDragRef.current = null;
      pendingSketchGeometryDragRef.current = null;
      canvasElement.removeEventListener("pointerdown", handlePointerDown, true);
      canvasElement.removeEventListener("pointermove", handlePointerMove);
      canvasElement.removeEventListener("pointerleave", handlePointerLeave);
      canvasElement.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("dblclick", handleDoubleClick, true);
    };
  }, [
    cancelSketchGeometryDragMove,
    canvasReadyVersion,
    clearSketchPickHint,
    closeSketchPickChooser,
    openSketchPickChooser,
    scheduleSketchGeometryDragMove,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

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
      <Canvas
        className="h-full w-full"
        frameloop="demand"
        gl={{ antialias: true, alpha: true, localClippingEnabled: true }}
        orthographic
        camera={{ near: 0.1, far: 1000, position: [14, -16, 28] }}
        onCreated={({ camera, gl, raycaster }) => {
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
          raycaster.params.Line.threshold = 0.75;
        }}
      >
        <ViewportProjectionCameraController
          projectionMode={projectionMode}
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          pendingFrameRef={pendingProjectionFrameRef}
          controlsReadyVersion={controlsReadyVersion}
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
          <group ref={pickRootRef}>
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
              />
            ))}
          </group>
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
          onStart={() => cameraTransitionControllerRef.current.cancel()}
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
      </Canvas>
      <div
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
          left: SKETCH_PICK_HINT_LEFT_PX,
          top: VIEWPORT_OVERLAY_TOP_INSET_STYLE,
        }}
      >
        <SketchPickHint
          hint={
            sketchSession &&
            pickHint.definition === sketchDefinition &&
            pickHint.activeTool === sketchActiveTool
              ? pickHint.hint
              : null
          }
          onChoose={() => {
            const overlap = pickOverlapRef.current;
            // Nothing to choose any more (the selection or its filter
            // changed): the hint goes (T11e review A-2).
            if (!overlap || !openSketchPickChooser(overlap)) {
              clearSketchPickHint();
            }
          }}
        />
      </div>
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
        hoveredAnnotation={isAnnotationTarget(hoverTarget) ? hoverTarget : null}
        selectedAnnotation={
          isAnnotationTarget(selection[0] ?? null)
            ? (selection[0] as SketchConstraintRef | SketchDimensionRef)
            : null
        }
        hoverTarget={hoverTarget}
        selection={selection}
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
        onSelect={(target) => selectRef.current(target)}
        onEdit={(target) => annotationEditRef.current(target)}
        onDimensionDrag={(handle, clientX, clientY, gesturePhase) => {
          const point = projectSketchClientPointRef.current(clientX, clientY);
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
