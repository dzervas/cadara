import type { CSSProperties } from "react";

interface HistoryTimelinePanelMotionState {
  ariaHidden: true | undefined;
  transitionState: "active" | "collapsed-down";
  style: CSSProperties;
}

interface HistoryTimelinePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const HISTORY_TIMELINE_COLLAPSED_STORAGE_KEY =
  "cad.workbench.historyTimelineCollapsed.v1";

export function getHistoryTimelinePanelMotionState(
  collapsed: boolean,
): HistoryTimelinePanelMotionState {
  return {
    ariaHidden: collapsed ? true : undefined,
    transitionState: collapsed ? "collapsed-down" : "active",
    style: {
      opacity: collapsed ? 0 : 1,
      transform: collapsed ? "translateY(calc(100% + 12px))" : "translateY(0)",
      transition:
        "transform 220ms cubic-bezier(0.25, 1, 0.5, 1), opacity 140ms cubic-bezier(0.25, 1, 0.5, 1)",
    },
  };
}

function getDefaultHistoryTimelinePreferenceStorage(): HistoryTimelinePreferenceStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readHistoryTimelineCollapsedPreference(
  storage: HistoryTimelinePreferenceStorage | null = getDefaultHistoryTimelinePreferenceStorage(),
) {
  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(HISTORY_TIMELINE_COLLAPSED_STORAGE_KEY) === "true";
  } catch (error) {
    console.warn(
      "History timeline collapsed preference could not be read.",
      error,
    );
    return false;
  }
}

export function writeHistoryTimelineCollapsedPreference(
  collapsed: boolean,
  storage: HistoryTimelinePreferenceStorage | null = getDefaultHistoryTimelinePreferenceStorage(),
) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      HISTORY_TIMELINE_COLLAPSED_STORAGE_KEY,
      collapsed ? "true" : "false",
    );
  } catch (error) {
    console.warn(
      "History timeline collapsed preference could not be saved.",
      error,
    );
  }
}
