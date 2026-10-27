import { SketchSpecialModePanel } from "./sketch-special-mode-panel";
import type { SketchSpecialModePanelSection } from "@/core/sketch-special-modes/schema";
import type { SketchCloseSplineState } from "@/core/editor/sketch-session";

interface SketchSplineActionsProps {
  closeSpline: SketchCloseSplineState | null;
  tangent: {
    visible: boolean;
    resetEnabled: boolean;
    zeroEnabled: boolean;
  } | null;
  onPatch: (patch: Record<string, unknown>) => void;
}

/** Selection actions use the same prompt/options renderer as sketch modes. */
export function SketchSplineActions({
  closeSpline,
  tangent,
  onPatch,
}: SketchSplineActionsProps) {
  const sections: SketchSpecialModePanelSection[] = [];
  if (closeSpline) {
    sections.push({
      id: "sketch-close-spline-action",
      title: "Spline",
      diagnostics: closeSpline.refusal
        ? [
            {
              id: "spline-close-refusal",
              message: closeSpline.refusal,
              severity: "warning",
            },
          ]
        : undefined,
      buttons: [
        {
          id: "spline-close",
          label: "Close spline",
          disabled: closeSpline.refusal !== null,
          action: { kind: "invoke", actionId: "closeSpline" },
        },
      ],
    });
  }
  if (tangent?.visible) {
    sections.push({
      id: "sketch-tangent-actions",
      title: "Tangent",
      buttons: [
        {
          id: "tangent-reset",
          label: "Reset to automatic",
          disabled: !tangent.resetEnabled,
          action: { kind: "invoke", actionId: "resetTangentToAutomatic" },
        },
        {
          id: "tangent-zero",
          label: "Set to zero",
          disabled: !tangent.zeroEnabled,
          action: { kind: "invoke", actionId: "setTangentToZero" },
        },
      ],
    });
  }
  if (sections.length === 0) return null;
  return (
    <SketchSpecialModePanel
      inline
      schema={{ title: "Spline selection", sections }}
      onAction={(action) => {
        if (action.kind === "invoke") onPatch({ intent: action.actionId });
      }}
    />
  );
}
