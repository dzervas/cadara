import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ActionIcon, Tooltip } from "@mantine/core";

import { shouldStartVariableKeyboardEdit } from "@/components/layout/feature-sidebar.a11y";
import {
  VIEWPORT_OVERLAY_INSET_PX,
  VIEWPORT_OVERLAY_TOP_INSET_STYLE,
} from "@/components/cad/viewport-overlay-layout";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import type {
  DocumentVariableRecord,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import { evaluateDocumentVariableExpressions } from "@/domain/modeling/document-variable-expressions";

interface WorkbenchVariablesPanelProps {
  snapshot: WorkspaceSnapshot | null;
  invalidVariableValueIds?: Record<string, boolean>;
  invalidVariableValueMessages?: Record<string, string>;
  onAddVariable: () => void;
  onUpdateVariable: (
    variable: DocumentVariableRecord,
    next: Pick<DocumentVariableRecord, "name" | "valueText">,
  ) => void;
  onClose: () => void;
}

type VariableResultPresentation =
  | { kind: "success"; text: string }
  | { kind: "error"; text: "???"; message: string };

function formatVariableResult(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : Number.parseFloat(value.toPrecision(12)).toString();
}

function getVariableResultPresentations(
  variables: readonly DocumentVariableRecord[],
  invalidVariableValueIds: Record<string, boolean>,
  invalidVariableValueMessages: Record<string, string>,
) {
  const evaluation = evaluateDocumentVariableExpressions(variables);
  const diagnosticsByVariableId = new Map<
    DocumentVariableRecord["variableId"],
    string
  >();
  const presentations = new Map<
    DocumentVariableRecord["variableId"],
    VariableResultPresentation
  >();

  if (!evaluation.ok) {
    for (const diagnostic of evaluation.diagnostics) {
      if (!diagnosticsByVariableId.has(diagnostic.variableId)) {
        diagnosticsByVariableId.set(diagnostic.variableId, diagnostic.message);
      }
    }
  }

  for (const variable of variables) {
    const runtimeError =
      invalidVariableValueMessages[variable.variableId] ??
      (invalidVariableValueIds[variable.variableId]
        ? "Variable expression failed to evaluate."
        : null);
    const evaluationError =
      runtimeError ??
      diagnosticsByVariableId.get(variable.variableId) ??
      (!evaluation.ok
        ? "Variable expression evaluation is blocked by another variable error."
        : null);

    if (evaluationError) {
      presentations.set(variable.variableId, {
        kind: "error",
        text: "???",
        message: evaluationError,
      });
      continue;
    }

    if (!evaluation.ok) {
      presentations.set(variable.variableId, {
        kind: "error",
        text: "???",
        message: "Variable expression result is unavailable.",
      });
      continue;
    }

    const evaluatedValue = evaluation.valuesById.get(variable.variableId);
    if (evaluatedValue === undefined) {
      presentations.set(variable.variableId, {
        kind: "error",
        text: "???",
        message: "Variable expression result is unavailable.",
      });
      continue;
    }

    presentations.set(variable.variableId, {
      kind: "success",
      text: formatVariableResult(evaluatedValue),
    });
  }

  return presentations;
}

const PANEL_STYLE: CSSProperties = {
  position: "absolute",
  top: VIEWPORT_OVERLAY_TOP_INSET_STYLE,
  right: VIEWPORT_OVERLAY_INSET_PX,
  bottom: 172,
  width: 320,
  zIndex: 27,
  display: "flex",
  flexDirection: "column",
  borderRadius: 16,
  background: "var(--workbench-glass-fill-strong)",
  backdropFilter: "var(--workbench-glass-blur-panel)",
  WebkitBackdropFilter: "var(--workbench-glass-blur-panel)",
  border: "1px solid var(--workbench-glass-border)",
  boxShadow: "var(--workbench-panel-shadow)",
  overflow: "hidden",
  transformOrigin: "bottom right",
  animation: "workbench-vars-panel-in 200ms cubic-bezier(0.2, 0.8, 0.3, 1.05)",
  pointerEvents: "auto",
};

/**
 * Floating variables panel — see DESIGN.md "Variables FAB & Panel".
 *
 * Anchored top:76 / right:16 / bottom:100 so it never overlaps the toolbar, history,
 * or tab bar. Replaces the "Variables" sidebar accordion section. Reuses the existing
 * `evaluateDocumentVariableExpressions` evaluator and the inline-edit row pattern.
 */
export function WorkbenchVariablesPanel({
  snapshot,
  invalidVariableValueIds = {},
  invalidVariableValueMessages = {},
  onAddVariable,
  onUpdateVariable,
  onClose,
}: WorkbenchVariablesPanelProps) {
  const [editingVariableId, setEditingVariableId] = useState<string | null>(
    null,
  );
  const [variableDrafts, setVariableDrafts] = useState<
    Record<string, Pick<DocumentVariableRecord, "name" | "valueText">>
  >({});
  const previousVariableIdsRef = useRef<Set<string> | null>(null);

  const variables = useMemo(
    () => snapshot?.document.variables ?? [],
    [snapshot],
  );
  const variableResultPresentations = useMemo(
    () =>
      getVariableResultPresentations(
        variables,
        invalidVariableValueIds,
        invalidVariableValueMessages,
      ),
    [variables, invalidVariableValueIds, invalidVariableValueMessages],
  );
  const autoOpenedInvalidVariableId = useMemo(() => {
    for (const variable of variables) {
      const variableResult = variableResultPresentations.get(
        variable.variableId,
      );
      if (variableResult?.kind === "error") {
        return variable.variableId;
      }
    }
    return null;
  }, [variables, variableResultPresentations]);

  useEffect(() => {
    if (!snapshot) {
      previousVariableIdsRef.current = null;
      return;
    }

    const previousVariableIds = previousVariableIdsRef.current;
    if (previousVariableIds) {
      const addedVariable = variables.find(
        (variable) => !previousVariableIds.has(variable.variableId),
      );
      if (addedVariable) {
        setEditingVariableId(addedVariable.variableId);
      }
    }
    previousVariableIdsRef.current = new Set(
      variables.map((variable) => variable.variableId),
    );
  }, [snapshot, variables]);

  const getVariableDraft = (variable: DocumentVariableRecord) =>
    variableDrafts[variable.variableId] ?? {
      name: variable.name,
      valueText: variable.valueText,
    };

  const patchVariableDraft = (
    variable: DocumentVariableRecord,
    patch: Partial<Pick<DocumentVariableRecord, "name" | "valueText">>,
  ) => {
    setVariableDrafts((current) => ({
      ...current,
      [variable.variableId]: { ...getVariableDraft(variable), ...patch },
    }));
  };

  const resetVariableDraft = (variable: DocumentVariableRecord) => {
    setVariableDrafts((current) => {
      const next = { ...current };
      delete next[variable.variableId];
      return next;
    });
  };

  const commitVariableDraft = (variable: DocumentVariableRecord) => {
    const draft = getVariableDraft(variable);
    if (
      draft.name !== variable.name ||
      draft.valueText !== variable.valueText
    ) {
      onUpdateVariable(variable, draft);
    }
    resetVariableDraft(variable);
  };

  const finishVariableEdit = (variable: DocumentVariableRecord) => {
    commitVariableDraft(variable);
    setEditingVariableId(null);
  };

  const cancelVariableEdit = (variable: DocumentVariableRecord) => {
    resetVariableDraft(variable);
    setEditingVariableId(null);
  };

  return (
    <aside
      aria-label="Variables"
      data-workbench-variables-panel
      style={PANEL_STYLE}
    >
      <header
        className="flex items-center justify-between px-4 pt-3.5 pb-2.5"
        style={{ borderBottom: "1px solid var(--workbench-glass-divider)" }}
      >
        <span
          className="text-[12.5px] font-semibold"
          style={{
            letterSpacing: "-0.005em",
            color: "var(--workbench-shell-text)",
          }}
        >
          Variables
        </span>
        <ActionIcon
          variant="subtle"
          color="gray"
          size={26}
          aria-label="Close variables"
          onClick={onClose}
        >
          <WorkbenchIcon name="close" className="h-4 w-4" />
        </ActionIcon>
      </header>
      <div className="flex-1 overflow-y-auto py-1.5">
        {variables.map((variable) => {
          const draft = getVariableDraft(variable);
          const accessibleVariableName =
            variable.name.trim() || "Unnamed variable";
          const variableResult = variableResultPresentations.get(
            variable.variableId,
          ) ?? {
            kind: "error" as const,
            text: "???" as const,
            message: "Variable expression result is unavailable.",
          };
          const isValueInvalid = variableResult.kind === "error";
          const isEditingVariable =
            editingVariableId === variable.variableId ||
            variable.valueText === "";
          const autoOpenErrorTooltip =
            variableResult.kind === "error" &&
            autoOpenedInvalidVariableId === variable.variableId;
          const variableResultChip = (
            <span
              className="inline-block max-w-full shrink-0 truncate rounded border px-2 py-1 text-right font-mono text-[12px] leading-4"
              data-variable-result={variable.variableId}
              data-result-state={variableResult.kind}
              aria-label={
                variableResult.kind === "error"
                  ? `Variable result error: ${variableResult.message}`
                  : `Variable result: ${variableResult.text}`
              }
              style={{
                backgroundColor:
                  variableResult.kind === "error"
                    ? "var(--workbench-shell-danger-surface)"
                    : "var(--workbench-shell-success-surface)",
                borderColor:
                  variableResult.kind === "error"
                    ? "var(--workbench-shell-danger-border)"
                    : "var(--workbench-shell-success-border)",
                color:
                  variableResult.kind === "error"
                    ? "var(--workbench-shell-danger-text)"
                    : "var(--workbench-shell-success-text)",
              }}
            >
              {variableResult.text}
            </span>
          );

          return (
            <div
              key={variable.variableId}
              data-variable-row={variable.variableId}
              data-invalid-value={isValueInvalid ? "true" : undefined}
              data-variable-editing={isEditingVariable ? "true" : undefined}
              className="px-4 py-1"
            >
              {isEditingVariable ? (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,0.75fr)] gap-2 px-2 py-1.5 rounded-md"
                  onBlur={(event) => {
                    const nextFocusTarget = event.relatedTarget;
                    if (
                      nextFocusTarget instanceof Node &&
                      event.currentTarget.contains(nextFocusTarget)
                    ) {
                      return;
                    }
                    finishVariableEdit(variable);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      finishVariableEdit(variable);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelVariableEdit(variable);
                    }
                  }}
                >
                  <input
                    aria-label={`Variable name ${variable.variableId}`}
                    autoFocus
                    className="h-7 min-w-0 rounded border bg-[var(--workbench-shell-overlay)] px-2 text-[13px] font-medium text-[var(--workbench-shell-text)] outline-none focus:border-[var(--workbench-shell-accent)]"
                    style={{ borderColor: "var(--workbench-shell-border)" }}
                    value={draft.name}
                    onChange={(event) =>
                      patchVariableDraft(variable, {
                        name: event.currentTarget.value,
                      })
                    }
                  />
                  <input
                    aria-label={`Variable value ${variable.variableId}`}
                    className="h-7 min-w-0 rounded border bg-[var(--workbench-shell-control-surface)] px-2 font-mono text-xs text-[var(--workbench-shell-text-muted)] outline-none focus:border-[var(--workbench-shell-accent)]"
                    style={{
                      borderColor: isValueInvalid
                        ? "var(--workbench-shell-danger-border)"
                        : "var(--workbench-shell-border)",
                    }}
                    value={draft.valueText}
                    onChange={(event) =>
                      patchVariableDraft(variable, {
                        valueText: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--workbench-shell-sidebar-item-hover)] focus:outline-none focus:ring-1 focus:ring-[var(--workbench-shell-accent)]"
                  style={{ background: "transparent", border: 0 }}
                  aria-label={`Edit variable ${accessibleVariableName}`}
                  aria-keyshortcuts="Enter Space F2"
                  title="Double-click to edit. Press Enter, Space, or F2 to edit from the keyboard."
                  onKeyDown={(event) => {
                    if (!shouldStartVariableKeyboardEdit(event.key)) return;
                    event.preventDefault();
                    setEditingVariableId(variable.variableId);
                  }}
                  onDoubleClick={() =>
                    setEditingVariableId(variable.variableId)
                  }
                >
                  <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-[var(--workbench-shell-text)]">
                    {accessibleVariableName}
                  </span>
                  <span className="ml-auto flex min-w-0 max-w-[68%] shrink-0 items-center justify-end gap-1.5">
                    <span
                      className="min-w-0 truncate rounded border bg-[var(--workbench-shell-control-surface)] px-2 py-1 text-right font-mono text-[12px] leading-4 text-[var(--workbench-shell-text-muted)]"
                      data-variable-expression={variable.variableId}
                      style={{ borderColor: "var(--workbench-shell-border)" }}
                    >
                      {variable.valueText}
                    </span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-[12px] leading-4 text-[var(--workbench-shell-text-dim)]"
                    >
                      =
                    </span>
                    {variableResult.kind === "error" ? (
                      <Tooltip
                        label={variableResult.message}
                        opened={autoOpenErrorTooltip ? true : undefined}
                        multiline
                        position="left"
                        w={240}
                      >
                        {variableResultChip}
                      </Tooltip>
                    ) : (
                      variableResultChip
                    )}
                  </span>
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAddVariable}
          aria-label="Add variable"
          className="mt-1 flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] font-medium leading-5 text-[var(--workbench-shell-text-dim)] transition hover:text-[var(--workbench-shell-text)] focus:outline-none focus:ring-1 focus:ring-[var(--workbench-shell-accent)]"
        >
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center"
            style={{ color: "var(--workbench-shell-accent)" }}
          >
            <WorkbenchIcon name="plus" className="h-3.5 w-3.5" />
          </span>
          <span>Add variable</span>
        </button>
      </div>
    </aside>
  );
}
