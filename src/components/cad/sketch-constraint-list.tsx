import { SvgIcon } from "@/components/ui/svg-icon";
import { ActionIcon, Paper, Switch } from "@mantine/core";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import { primitiveRefEquals, type PrimitiveRef } from "@/core/editor/schema";
import type { SketchAnnotationListRow } from "@/core/editor/sketch-session";
import {
  getAnnotationConstraintColor,
  getAnnotationGlyphIconFileName,
} from "@/components/cad/sketch-annotation-glyph";
import { getSketchRenderingPaletteToken } from "@/components/cad/sketch-rendering-palette";
import { SECTION_HEADER_CLASSES } from "@/components/ui/workbench-panel-styles";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";

type AnnotationTarget = SketchConstraintRef | SketchDimensionRef;

export interface SketchConstraintListProps {
  rows: readonly SketchAnnotationListRow[];
  selection: readonly PrimitiveRef[];
  hoverTarget: PrimitiveRef | null;
  showAll: boolean;
  /**
   * T14g (T-10): the radial wheel's "More…": only these annotations are
   * listed (the panel expands) until the wheel closes or the filter is
   * cleared. Null: every row.
   */
  filter?: readonly AnnotationTarget[] | null;
  onClearFilter?: () => void;
  /**
   * The list starts collapsed (the header and Show all stay visible). Only
   * the static-markup UI lane passes it (no clicks there); the workbench
   * starts expanded.
   */
  defaultCollapsed?: boolean;
  className?: string;
  onShowAllChange: (showAll: boolean) => void;
  onHover: (target: AnnotationTarget) => void;
  onClearHover: () => void;
  onSelect: (target: AnnotationTarget) => void;
  onDelete: (target: AnnotationTarget) => void;
}

const PROBLEM_COLOR = `var(${getSketchRenderingPaletteToken("overconstrained")})`;

/**
 * T14e (T-11/T-12, T-17, Q1/A-9): the sketch's Constraints panel, the
 * complete selectable list and the visible Show all switch (issue 06/10).
 * The header (title, problem count, Show all) stays visible when the list is
 * collapsed. Rows are native buttons in focus order: a row selects its
 * annotation, hovering it highlights the affected geometry, and every row but
 * an arc's own end binding has a delete button.
 */
export function SketchConstraintList({
  rows,
  selection,
  hoverTarget,
  showAll,
  filter = null,
  onClearFilter,
  defaultCollapsed = false,
  className,
  onShowAllChange,
  onHover,
  onClearHover,
  onSelect,
  onDelete,
}: SketchConstraintListProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // T14g: a new "More…" filter expands a collapsed panel (adjusted while
  // rendering; the user can collapse it again).
  const [expandedForFilter, setExpandedForFilter] =
    useState<typeof filter>(null);
  if (expandedForFilter !== filter) {
    setExpandedForFilter(filter);
    if (filter) {
      setCollapsed(false);
    }
  }
  const problemCount = rows.filter((row) => row.problemText !== null).length;
  const shownRows = filter
    ? rows.filter((row) =>
        filter.some((target) =>
          primitiveRefEquals(target, row.annotation.target),
        ),
      )
    : rows;
  const listId = "sketch-constraint-list-rows";
  const panelRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // Review A-3: after a Delete, focus moves to the row that took its place
  // (or the one before it, or the panel), never to the page body.
  const focusAfterDeleteRef = useRef<string | null | undefined>(undefined);
  // Review A-7 (plan A2): a selection made elsewhere (the viewport) scrolls
  // its row into the list's view; a row clicked here is already visible.
  const listSelectedIdRef = useRef<string | null>(null);
  const selectedId =
    rows.find((row) =>
      selection.some((target) =>
        primitiveRefEquals(target, row.annotation.target),
      ),
    )?.annotation.id ?? null;

  useEffect(() => {
    const pending = focusAfterDeleteRef.current;
    if (pending === undefined) return;
    focusAfterDeleteRef.current = undefined;
    const button = pending
      ? listRef.current?.querySelector<HTMLButtonElement>(
          `[data-sketch-constraint-row="${CSS.escape(pending)}"] button`,
        )
      : null;
    (button ?? panelRef.current)?.focus();
  }, [rows]);

  useEffect(() => {
    const list = listRef.current;
    // The marker of a list click is used once (re-review AR-1): a later
    // viewport selection of the same annotation (A→B→A) still scrolls.
    const clickedInList = listSelectedIdRef.current;
    listSelectedIdRef.current = null;
    if (!selectedId || !list || selectedId === clickedInList) {
      return;
    }
    const row = list.querySelector<HTMLElement>(
      `[data-sketch-constraint-row="${CSS.escape(selectedId)}"]`,
    );
    if (!row) return;
    // Scroll the list only (`scrollIntoView` could scroll the workbench).
    if (row.offsetTop < list.scrollTop) {
      list.scrollTop = row.offsetTop;
    } else if (
      row.offsetTop + row.offsetHeight >
      list.scrollTop + list.clientHeight
    ) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }, [selectedId]);

  // Stable row callbacks (review A-2) reading the latest props.
  const latestRef = useRef({ rows: shownRows, onSelect, onDelete });
  useEffect(() => {
    latestRef.current = { rows: shownRows, onSelect, onDelete };
  });
  const selectFromList = useCallback((target: AnnotationTarget, id: string) => {
    listSelectedIdRef.current = id;
    latestRef.current.onSelect(target);
  }, []);
  const deleteFromList = useCallback((target: AnnotationTarget, id: string) => {
    const current = latestRef.current.rows;
    const index = current.findIndex((row) => row.annotation.id === id);
    focusAfterDeleteRef.current =
      current[index + 1]?.annotation.id ??
      current[index - 1]?.annotation.id ??
      null;
    latestRef.current.onDelete(target);
  }, []);

  return (
    <Paper
      ref={panelRef}
      component="section"
      tabIndex={-1}
      aria-label="Constraints"
      data-sketch-constraint-list=""
      data-collapsed={collapsed ? "true" : "false"}
      className={`pointer-events-auto flex min-h-0 max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[6px] text-xs text-[var(--workbench-shell-text-muted)] ${className ?? ""}`}
      style={{
        // Review B-1: a flex column (inline, over Mantine's own display) so
        // the list shrinks to the height the column leaves and scrolls.
        display: "flex",
        flexDirection: "column",
        width: 280,
        background: "var(--workbench-shell-surface-panel-elev)",
        boxShadow: "var(--workbench-shell-elevation-md)",
      }}
      // T-18: entering the panel ends any canvas hover; a row's enter (an
      // inner element, dispatched after this) then owns the editor hover.
      onPointerEnter={onClearHover}
    >
      <div className="grid shrink-0 gap-1.5 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <ActionIcon
            type="button"
            size={18}
            variant="subtle"
            color="gray"
            aria-expanded={!collapsed}
            aria-controls={listId}
            aria-label={
              collapsed
                ? "Expand the constraints list"
                : "Collapse the constraints list"
            }
            onClick={() => setCollapsed((current) => !current)}
          >
            <WorkbenchIcon
              name={collapsed ? "chevronRight" : "chevronDown"}
              className="h-3 w-3"
            />
          </ActionIcon>
          <span className={SECTION_HEADER_CLASSES}>Constraints</span>
          <span data-sketch-constraint-count="">{rows.length}</span>
          {problemCount > 0 ? (
            <span
              className="ml-auto flex items-center gap-1 font-medium"
              data-sketch-constraint-problem-count={problemCount}
              style={{ color: PROBLEM_COLOR }}
            >
              <WorkbenchIcon name="error" className="h-3.5 w-3.5" />
              {problemCount === 1 ? "1 problem" : `${problemCount} problems`}
            </span>
          ) : null}
        </div>
        <Switch
          size="xs"
          label="Show all constraints"
          checked={showAll}
          onChange={(event) => onShowAllChange(event.currentTarget.checked)}
          data-sketch-constraint-show-all=""
        />
        {filter ? (
          <div
            className="flex items-center gap-2"
            data-sketch-constraint-filter={shownRows.length}
          >
            <span>
              {shownRows.length === 1
                ? "1 nearby constraint"
                : `${shownRows.length} nearby constraints`}
            </span>
            <button
              type="button"
              className="ml-auto rounded px-1 text-[var(--cad-accent)] hover:underline"
              onClick={onClearFilter}
            >
              Show every constraint
            </button>
          </div>
        ) : null}
      </div>
      {collapsed ? null : (
        // Review B-1: the list takes the height the column leaves and
        // scrolls (no fixed cap).
        <ul
          ref={listRef}
          id={listId}
          className="relative min-h-0 flex-1 overflow-y-auto border-t border-[var(--cad-border)] py-1"
        >
          {shownRows.length === 0 ? (
            <li className="px-3 py-2 text-[var(--cad-muted-foreground)]">
              No constraints or dimensions.
            </li>
          ) : null}
          {shownRows.map((row, index) => (
            <SketchConstraintListRow
              key={row.annotation.id}
              row={row}
              // Review A-5: a problem binding (listed first) names its arc
              // inline; the header heads the arc's quiet bindings only.
              groupHeader={
                row.group !== null &&
                row.problemText === null &&
                (row.group.key !== shownRows[index - 1]?.group?.key ||
                  shownRows[index - 1]?.problemText !== null)
                  ? row.group.label
                  : null
              }
              selected={selection.some((target) =>
                primitiveRefEquals(target, row.annotation.target),
              )}
              hovered={
                hoverTarget !== null &&
                primitiveRefEquals(hoverTarget, row.annotation.target)
              }
              onHover={onHover}
              onClearHover={onClearHover}
              onSelect={selectFromList}
              onDelete={deleteFromList}
            />
          ))}
        </ul>
      )}
    </Paper>
  );
}

/** Review A-2: memoized; a hover change re-renders only the rows it touches. */
const SketchConstraintListRow = memo(function SketchConstraintListRow({
  row,
  groupHeader,
  selected,
  hovered,
  onHover,
  onClearHover,
  onSelect,
  onDelete,
}: {
  row: SketchAnnotationListRow;
  groupHeader: string | null;
  selected: boolean;
  hovered: boolean;
  onHover: (target: AnnotationTarget) => void;
  onClearHover: () => void;
  onSelect: (target: AnnotationTarget, id: string) => void;
  onDelete: (target: AnnotationTarget, id: string) => void;
}) {
  const { annotation, problemText, deletable } = row;
  // Review A-5: a problem binding names its arc inline (no header).
  const detail =
    row.group && problemText !== null
      ? `${row.group.label} · ${annotation.detail}`
      : annotation.detail;
  const value =
    annotation.status === "dimension" ? annotation.visibleLabel : undefined;
  const accessibleName = `${annotation.label}: ${annotation.detail}${
    problemText ? `. ${problemText}` : ""
  }`;

  return (
    <>
      {groupHeader !== null ? (
        <li
          className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium text-[var(--cad-muted-foreground)]"
          data-sketch-constraint-group=""
        >
          {groupHeader}
        </li>
      ) : null}
      <li
        className={`flex items-start gap-1 px-1.5 ${row.group ? "pl-4" : ""} ${
          selected
            ? "bg-[var(--cad-surface-elevated)]"
            : hovered
              ? "bg-[var(--cad-surface-overlay)]"
              : ""
        }`}
        data-sketch-constraint-row={annotation.id}
        data-sketch-constraint-problem={problemText !== null ? "" : undefined}
        data-sketch-constraint-selected={selected ? "" : undefined}
        onPointerEnter={() => onHover(annotation.target)}
        onPointerLeave={onClearHover}
      >
        <button
          type="button"
          aria-label={accessibleName}
          aria-pressed={selected}
          className={`flex min-w-0 flex-1 items-start gap-2 rounded border px-1.5 py-1 text-left ${
            selected
              ? "border-[var(--cad-accent)]"
              : "border-transparent hover:border-[var(--cad-border-strong)]"
          }`}
          onClick={() => onSelect(annotation.target, annotation.id)}
        >
          <SvgIcon
            className="mt-0.5 h-4 w-4 shrink-0"
            draggable={false}
            fileName={getAnnotationGlyphIconFileName(annotation.glyphKind)}
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-[var(--workbench-shell-text)]">
                {annotation.label}
              </span>
              {value !== undefined ? (
                <span
                  className="shrink-0 font-mono text-[11px]"
                  style={{ color: getAnnotationConstraintColor(annotation) }}
                >
                  {value}
                </span>
              ) : null}
            </span>
            <span className="truncate text-[11px] text-[var(--cad-muted-foreground)]">
              {detail}
            </span>
            {problemText !== null ? (
              <span
                className="flex items-start gap-1 text-[11px]"
                data-sketch-constraint-problem-text=""
                style={{ color: PROBLEM_COLOR }}
              >
                <WorkbenchIcon
                  name="error"
                  className="mt-px h-3 w-3 shrink-0"
                />
                <span>{problemText}</span>
              </span>
            ) : null}
          </span>
        </button>
        {deletable ? (
          <ActionIcon
            type="button"
            size={24}
            variant="subtle"
            color="gray"
            className="mt-0.5 shrink-0"
            aria-label={`Delete ${annotation.label}`}
            onClick={() => onDelete(annotation.target, annotation.id)}
          >
            <WorkbenchIcon name="trash" className="h-3.5 w-3.5" />
          </ActionIcon>
        ) : null}
      </li>
    </>
  );
});
