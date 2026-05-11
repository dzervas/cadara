import type { CSSProperties } from "react";

import { WorkbenchIcon } from "@/components/ui/workbench-icon";

interface WorkbenchVariablesFabProps {
  open: boolean;
  onToggle: () => void;
}

const FAB_SIZE = 52;

const FAB_BASE: CSSProperties = {
  position: "absolute",
  bottom: 188,
  right: 24,
  zIndex: 28,
  width: FAB_SIZE,
  height: FAB_SIZE,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  background: "var(--workbench-spark-accent)",
  color: "var(--workbench-shell-text)",
  border: "1px solid var(--workbench-glass-border-spark-open)",
  boxShadow: "var(--workbench-fab-shadow)",
  transition:
    "transform 160ms cubic-bezier(0.25, 1, 0.5, 1), background-color 160ms cubic-bezier(0.25, 1, 0.5, 1), color 160ms cubic-bezier(0.25, 1, 0.5, 1)",
  pointerEvents: "auto",
};

/**
 * Variables FAB — second of the three Spark Affordances. See DESIGN.md.
 *
 * Always spark-orange in chrome — the FAB is the dedicated entry point to the variables
 * panel. Closed: variables glyph. Open: hover-flips to the slightly brighter ember tone
 * and the glyph swaps to a close mark, communicating "click again to dismiss."
 *
 * Anchored above the bottom history+timeline+tabs stack at bottom:188 so the timeline
 * never overlaps it.
 */
export function WorkbenchVariablesFab({
  open,
  onToggle,
}: WorkbenchVariablesFabProps) {
  return (
    <button
      type="button"
      aria-label={open ? "Close variables" : "Open variables"}
      aria-expanded={open}
      data-workbench-variables-fab
      data-state={open ? "open" : "closed"}
      onClick={onToggle}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = "translateY(-1px)";
        event.currentTarget.style.background =
          "var(--workbench-spark-accent-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
        event.currentTarget.style.background = "var(--workbench-spark-accent)";
      }}
      style={FAB_BASE}
    >
      <WorkbenchIcon
        name={open ? "close" : "variables"}
        className="h-[22px] w-[22px]"
      />
    </button>
  );
}
