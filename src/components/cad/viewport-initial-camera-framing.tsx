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
}: {
  documentId: DocumentId | null;
  renderables: readonly ViewportRenderableRecord[];
  cameraRef: RefObject<ViewportCamera | null>;
  controlsRef: RefObject<ViewportCameraControls | null>;
  controlsReadyVersion: number;
}) {
  const framedDocuments = useRef(new Set<DocumentId>());
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);

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
    controlsReadyVersion,
    controlsRef,
    documentId,
    invalidate,
    renderables,
    size,
  ]);

  return null;
}
