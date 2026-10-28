import type { ImportPreparedActionRef, ImportPreparedActions } from "@/contracts/import/actions";

export function getOrderedActionRefs(actions: ImportPreparedActions): ImportPreparedActionRef[] {
  if (actions.orderedActions) {
    return [...actions.orderedActions];
  }

  return [
    ...(actions.addDocumentVariables ?? []).map((_, index) => ({
      kind: "addDocumentVariable" as const,
      index,
    })),
    ...(actions.commitSketches ?? []).map((_, index) => ({
      kind: "commitSketch" as const,
      index,
    })),
    ...(actions.createFeatures ?? []).map((_, index) => ({
      kind: "createFeature" as const,
      index,
    })),
  ];
}

/** Return a compact prepared-action prefix ending immediately before a consumer. */
export function takePreparedActionPrefix(
  actions: ImportPreparedActions,
  exclusiveOrderedPosition: number,
): ImportPreparedActions {
  const refs = getOrderedActionRefs(actions).slice(0, exclusiveOrderedPosition);
  const addDocumentVariables: NonNullable<ImportPreparedActions["addDocumentVariables"]> = [];
  const commitSketches: NonNullable<ImportPreparedActions["commitSketches"]> = [];
  const createFeatures: NonNullable<ImportPreparedActions["createFeatures"]> = [];
  const orderedActions: ImportPreparedActionRef[] = [];

  for (const ref of refs) {
    switch (ref.kind) {
      case "addDocumentVariable":
        addDocumentVariables.push(actions.addDocumentVariables![ref.index]!);
        orderedActions.push({ kind: ref.kind, index: addDocumentVariables.length - 1 });
        break;
      case "commitSketch":
        commitSketches.push(actions.commitSketches![ref.index]!);
        orderedActions.push({ kind: ref.kind, index: commitSketches.length - 1 });
        break;
      case "createFeature":
        createFeatures.push(actions.createFeatures![ref.index]!);
        orderedActions.push({ kind: ref.kind, index: createFeatures.length - 1 });
        break;
    }
  }

  return { addDocumentVariables, commitSketches, createFeatures, orderedActions };
}
