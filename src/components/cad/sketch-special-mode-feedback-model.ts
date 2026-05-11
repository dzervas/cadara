import type { SketchToolAnchorDescriptor } from "@/core/sketch-tools/editor-schema";
import type {
  SketchSpecialModeViewportOverlay,
  SketchSpecialModeViewportPresentation,
} from "@/core/sketch-special-modes/schema";

export interface SketchSpecialModeFeedbackProjection {
  id: string;
  x: number;
  y: number;
}

interface SketchSpecialModeFeedbackAnchor {
  id: string;
  anchor: SketchToolAnchorDescriptor;
}

export function collectSketchSpecialModeFeedbackAnchors(
  presentation: SketchSpecialModeViewportPresentation | null,
): readonly SketchSpecialModeFeedbackAnchor[] {
  if (!presentation) {
    return [];
  }

  return (presentation.overlays ?? []).flatMap((overlay) => {
    switch (overlay.kind) {
      case "badge":
      case "diagnostic":
      case "handle":
        return [
          {
            id: getSketchSpecialModeOverlayProjectionId(overlay.id),
            anchor: overlay.anchor,
          },
        ];
      case "segment":
        return [
          {
            id: getSketchSpecialModeSegmentProjectionId(overlay.id, "start"),
            anchor: { kind: "sketchPoint", point: overlay.start },
          },
          {
            id: getSketchSpecialModeSegmentProjectionId(overlay.id, "end"),
            anchor: { kind: "sketchPoint", point: overlay.end },
          },
        ];
    }
  });
}

export function getSketchSpecialModeOverlayProjectionId(id: string) {
  return `sketch-special-overlay:${id}`;
}

export function getSketchSpecialModeSegmentProjectionId(
  id: string,
  point: "start" | "end",
) {
  return `sketch-special-segment:${id}:${point}`;
}

export function getSketchSpecialModeOverlayTone(
  overlay: SketchSpecialModeViewportOverlay,
) {
  switch (overlay.kind) {
    case "diagnostic":
      return overlay.severity === "error"
        ? "warning"
        : overlay.severity === "warning"
          ? "warning"
          : "neutral";
    case "badge":
    case "segment":
    case "handle":
      return overlay.tone ?? "neutral";
  }
}
