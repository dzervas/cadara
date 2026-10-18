import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, type RefObject } from "react";

import type { DocumentId } from "@/contracts/shared/ids";
import type { ViewportRenderableRecord } from "@/core/workspace/viewport-renderables";
import type { ViewportCameraControls } from "@/infrastructure/viewport/viewport-camera-controls";
import {
  applyViewportRenderableFitFrame,
  type ViewportCamera,
} from "@/infrastructure/viewport/viewport-projection";

export function ViewportInitialCameraFraming({
  documentId,
  renderables,
  cameraRef,
  controlsRef,
  controlsReadyVersion,
  sketchSessionActive,
  cameraTransitionVersion,
}: {
  documentId: DocumentId | null;
  renderables: readonly ViewportRenderableRecord[];
  cameraRef: RefObject<ViewportCamera | null>;
  controlsRef: RefObject<ViewportCameraControls | null>;
  controlsReadyVersion: number;
  sketchSessionActive: boolean;
  cameraTransitionVersion: number;
}) {
  const framedDocuments = useRef(new Set<DocumentId>());
  const previousTransitionVersion = useRef(cameraTransitionVersion);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    const transitionStarted =
      previousTransitionVersion.current !== cameraTransitionVersion;
    previousTransitionVersion.current = cameraTransitionVersion;
    if (!documentId) return;

    // Explicit camera ownership wins even before a transition's first frame.
    if (sketchSessionActive || transitionStarted) {
      framedDocuments.current.add(documentId);
    }
    const controls = controlsRef.current;
    if (!controls) return;

    const standDown = () => framedDocuments.current.add(documentId);
    controls.addEventListener("change", standDown);
    return () => controls.removeEventListener("change", standDown);
  }, [
    cameraTransitionVersion,
    controlsReadyVersion,
    controlsRef,
    documentId,
    sketchSessionActive,
  ]);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (
      !documentId ||
      framedDocuments.current.has(documentId) ||
      !camera ||
      !controls ||
      size.width <= 0 ||
      size.height <= 0
    ) {
      return;
    }

    // OCC may publish the document before its body geometry. Only consume the
    // initial fit once committed bounds exist, never for a tool preview.
    // Its own synchronous controls change also consumes this same one-shot fit.
    if (
      applyViewportRenderableFitFrame({
        camera,
        controls,
        renderables: renderables
          .filter((entry) => entry.origin === "document")
          .map((entry) => entry.renderable),
      })
    ) {
      framedDocuments.current.add(documentId);
      invalidate();
    }
  }, [
    cameraRef,
    cameraTransitionVersion,
    controlsReadyVersion,
    controlsRef,
    documentId,
    invalidate,
    renderables,
    size,
    sketchSessionActive,
  ]);

  return null;
}
