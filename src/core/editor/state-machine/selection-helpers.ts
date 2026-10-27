import {
  getFeaturePrimarySelectionTarget,
  getFeatureSessionPreviewLabel,
  type FeatureEditSessionState,
} from "@/core/editor/feature-editing";
import {
  getPrimitiveRefKey,
  primitiveRefEquals,
  resolveSelectionCandidate,
  type CommandPreview,
  type PrimitiveRef,
  type SelectionFilter,
  type SelectionTargetCatalog,
} from "@/core/editor/schema";
import { getSketchSelectionCycleContext } from "@/core/editor/sketch-session/selection";
import type { EditorExtensionDependencies } from "./dependencies";
import type {
  EditorState,
  ImportSessionState,
  SelectionRequestMode,
  ShellSelectRequest,
} from "./types";

/**
 * The multi-selection contexts (cadara-h026.1): idle part selection, and
 * sketch selection with no tool (`multiSelect` in the sketch cycle table).
 * There a click toggles or replaces by `SelectionRequestMode`; every other
 * context keeps its own selection rules.
 */
export function isMultiSelectionContext(state: EditorState): boolean {
  return (
    state.kind === "idle" ||
    (state.kind === "editingSketch" &&
      getSketchSelectionCycleContext(state.session, state.selectionFilter)
        .mode === "multiSelect")
  );
}

/**
 * One pick against an ordered multi-selection (cadara-h026.1). A cycle pick
 * (`cycleReplaces` still selected) takes the replaced pick's place, or only
 * drops it when the target is already selected; otherwise `selectionMode`
 * (default `replace`) applies.
 */
export function applyMultiSelectionRequest(
  selection: readonly PrimitiveRef[],
  request: {
    target: PrimitiveRef;
    selectionMode?: SelectionRequestMode;
    cycleReplaces?: PrimitiveRef;
  },
): PrimitiveRef[] {
  const { target } = request;
  const without = (removed: PrimitiveRef) =>
    selection.filter((entry) => !primitiveRefEquals(entry, removed));
  const replacedIndex = request.cycleReplaces
    ? selection.findIndex((entry) =>
        primitiveRefEquals(entry, request.cycleReplaces!),
      )
    : -1;
  if (replacedIndex >= 0) {
    return selection.some(
      (entry, index) =>
        index !== replacedIndex && primitiveRefEquals(entry, target),
    )
      ? without(request.cycleReplaces!)
      : selection.map((entry, index) =>
          index === replacedIndex ? target : entry,
        );
  }
  switch (request.selectionMode ?? "replace") {
    case "replace":
      return [target];
    case "remove":
      return without(target);
    case "toggle":
      return selection.some((entry) => primitiveRefEquals(entry, target))
        ? without(target)
        : [...selection, target];
  }
}

/**
 * A parts-tree row click by list conventions (cadara-h026.1): plain
 * replaces (no request), Ctrl/Cmd toggles, Shift selects the selectable
 * rows from the anchor (the last row clicked without Shift) to the clicked
 * one, in that order, and Ctrl/Cmd+Shift adds them. Without an anchor in
 * `rows`, Shift acts as a plain or Ctrl/Cmd click.
 */
export function createShellRowSelectRequest({
  rows,
  anchorKey,
  target,
  modifiers,
  isSelectable,
}: {
  rows: readonly PrimitiveRef[];
  anchorKey: string | null;
  target: PrimitiveRef;
  modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
  isSelectable: (target: PrimitiveRef) => boolean;
}): ShellSelectRequest | undefined {
  const toggles = modifiers.ctrlKey || modifiers.metaKey;
  const anchorIndex = rows.findIndex(
    (row) => getPrimitiveRefKey(row) === anchorKey,
  );
  const targetIndex = rows.findIndex((row) => primitiveRefEquals(row, target));
  if (!modifiers.shiftKey || anchorIndex < 0 || targetIndex < 0) {
    return toggles ? { mode: "toggle" } : undefined;
  }
  const step = targetIndex >= anchorIndex ? 1 : -1;
  const range: PrimitiveRef[] = [];
  for (let index = anchorIndex; ; index += step) {
    if (isSelectable(rows[index]!)) range.push(rows[index]!);
    if (index === targetIndex) break;
  }
  return { range, ...(toggles ? { mode: "toggle" as const } : {}) };
}

/**
 * Several targets against an ordered multi-selection (cadara-h026.1):
 * `replace` makes them the selection, `add` appends those not yet in it.
 * Duplicates keep their first place.
 */
export function applyMultiSelectionTargets(
  selection: readonly PrimitiveRef[],
  targets: readonly PrimitiveRef[],
  mode: "replace" | "add",
): PrimitiveRef[] {
  const next: PrimitiveRef[] = mode === "add" ? [...selection] : [];
  for (const target of targets) {
    if (!next.some((entry) => primitiveRefEquals(entry, target))) {
      next.push(target);
    }
  }
  return next;
}

export function adoptOrderedSelection(
  currentSelection: readonly PrimitiveRef[],
  tryAppend: (
    adoptedSelection: readonly PrimitiveRef[],
    target: PrimitiveRef,
  ) => PrimitiveRef[] | null,
): PrimitiveRef[] {
  const adoptedSelection: PrimitiveRef[] = [];

  for (const target of currentSelection) {
    const nextSelection = tryAppend(adoptedSelection, target);

    if (
      !nextSelection ||
      nextSelection.length !== adoptedSelection.length + 1
    ) {
      return [];
    }

    if (
      adoptedSelection.some(
        (selectedTarget, index) =>
          !primitiveRefEquals(selectedTarget, nextSelection[index]!),
      )
    ) {
      return [];
    }

    if (!primitiveRefEquals(nextSelection[adoptedSelection.length]!, target)) {
      return [];
    }

    adoptedSelection.push(target);
  }

  return adoptedSelection;
}

export function adoptSelectionForFilter(
  currentSelection: readonly PrimitiveRef[],
  selectionFilter: SelectionFilter | null,
  selectionCatalog: SelectionTargetCatalog | null,
): PrimitiveRef[] {
  return adoptOrderedSelection(currentSelection, (adoptedSelection, target) => {
    const candidate = resolveSelectionCandidate(
      selectionFilter,
      [...adoptedSelection],
      target,
      selectionCatalog,
    );

    return candidate.accepted ? candidate.nextSelection : null;
  });
}

export function createSelectionPreview(
  state: EditorState,
  filter: SelectionFilter | null,
): CommandPreview | null {
  return createSelectionPreviewForSelection(state.selection, filter);
}

export function createSelectionPreviewForSelection(
  selection: PrimitiveRef[],
  filter: SelectionFilter | null,
): CommandPreview | null {
  if (!filter) {
    return null;
  }

  return {
    kind: "selection",
    label: `Awaiting ${filter.label.toLowerCase()}`,
    target: selection[0] ?? null,
  };
}

export function createFeatureSelectionPreview(
  session: FeatureEditSessionState,
  prefix = "Draft",
): CommandPreview {
  return {
    kind: "selection",
    label: getFeatureSessionPreviewLabel(session, prefix),
    target: getFeaturePrimarySelectionTarget(session),
  };
}

export function createImportSelectionPreview(
  session: ImportSessionState,
  dependencies: EditorExtensionDependencies,
  prefix = "Import",
): CommandPreview {
  const provider = dependencies.importProviders.getById(session.providerId);

  return {
    kind: "selection",
    label: provider ? `${prefix} ${provider.label}` : `${prefix} session`,
    target: null,
  };
}
