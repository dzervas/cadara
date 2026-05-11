import { NumberInput, Paper, Select, Switch, TextInput } from "@mantine/core";

import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_FLOATING_PANEL_TOP_STYLE,
} from "@/components/cad/viewport-overlay-layout";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import {
  SECTION_HEADER_CLASSES,
  compactInputStyles,
  compactSelectStyles,
  fieldSurfaceStyle,
} from "@/components/ui/workbench-panel-styles";

type SketchToolControl = NonNullable<
  SketchToolPresentationSchema["controls"]
>[number];

interface SketchToolPanelProps {
  schema: SketchToolPresentationSchema | null;
  onPatch: (patch: Record<string, unknown>) => void;
}

function formatNumber(value: number | null) {
  return value === null ? "n/a" : value.toFixed(2);
}

export function SketchToolPanel({ schema, onPatch }: SketchToolPanelProps) {
  if (!schema) {
    return null;
  }

  const validation = schema.validation ?? [];
  const controls = schema.controls ?? [];
  const controlGroups = schema.controlGroups?.length
    ? schema.controlGroups
    : controls.length > 0
      ? [{ id: "sketch-tool-controls", label: "Controls", controls }]
      : [];
  const measurements = schema.measurements ?? [];
  const hints = schema.completionHints ?? [];
  const hasViewportDrawingFeedback =
    !schema.selectionGuide &&
    (schema.overlays ?? []).some(
      (overlay) =>
        overlay.kind === "measurement" || overlay.kind === "completionCue",
    );
  const hasPanelContent =
    schema.prompts.length > 0 ||
    validation.length > 0 ||
    controlGroups.length > 0 ||
    measurements.length > 0 ||
    hints.length > 0 ||
    Boolean(schema.selectionGuide);

  if (hasViewportDrawingFeedback || !hasPanelContent) {
    return null;
  }

  const pointerEventsClassName =
    controlGroups.length > 0 ? "pointer-events-auto" : "pointer-events-none";

  return (
    <Paper
      component="div"
      className={`${pointerEventsClassName} absolute z-20 w-[260px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[6px] text-xs text-[var(--workbench-shell-text-muted)]`}
      style={{
        left: VIEWPORT_FLOATING_PANEL_LEFT_PX,
        top: VIEWPORT_FLOATING_PANEL_TOP_STYLE,
        background: "var(--workbench-shell-surface-panel-elev)",
        boxShadow: "var(--workbench-shell-elevation-md)",
      }}
    >
      <div className="grid gap-2 p-3">
        {schema.prompts.map((prompt) => (
          <div
            key={prompt.id}
            className="text-sm font-medium text-[var(--workbench-shell-text)]"
          >
            {prompt.text}
          </div>
        ))}
        {schema.cursor ? (
          <div className="text-[var(--workbench-shell-text-muted)]">
            Cursor:{" "}
            <span className="text-[var(--workbench-shell-text)]">
              {schema.cursor.label}
            </span>
          </div>
        ) : null}
        {schema.steps?.map((step) => (
          <div key={step.id}>
            Step:{" "}
            <span className="text-[var(--workbench-shell-text)]">
              {step.label}
            </span>
          </div>
        ))}
        {schema.selectionGuide ? (
          <div
            className="rounded-[3px] px-2 py-1"
            style={{
              background: "var(--workbench-shell-overlay-soft)",
              boxShadow: "0 0 0 1px var(--workbench-shell-border)",
            }}
          >
            <div className="text-[var(--workbench-shell-text)]">
              {schema.selectionGuide.label}
            </div>
            <div className="mt-1">
              Targets: {schema.selectionGuide.selectedCount}/
              {schema.selectionGuide.requiredCount}
            </div>
            {schema.selectionGuide.hoverLabel ? (
              <div>Hover: {schema.selectionGuide.hoverLabel}</div>
            ) : null}
          </div>
        ) : null}
        {validation.map((message) => (
          <div
            key={message.id}
            className="rounded-[3px] px-2 py-1"
            style={{
              background: "var(--workbench-shell-danger-surface)",
              boxShadow: "0 0 0 1px var(--workbench-shell-danger-border)",
              color: "var(--workbench-shell-danger-text)",
            }}
          >
            {message.message}
          </div>
        ))}
        {controlGroups.length > 0 ? (
          <div className="grid gap-3 border-t border-[var(--workbench-shell-border)] pt-2">
            {controlGroups.map((group) => (
              <div key={group.id} className="grid gap-0.5">
                <p className={SECTION_HEADER_CLASSES}>{group.label}</p>
                {group.controls.map((control) => (
                  <SketchToolControlField
                    key={control.id}
                    control={control}
                    onPatch={onPatch}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {measurements.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 border-t border-[var(--workbench-shell-border)] pt-2">
            {measurements.map((measurement) => (
              <div key={measurement.id}>
                <div>{measurement.label}</div>
                <div className="text-[var(--workbench-shell-text)]">
                  {formatNumber(measurement.value)} {measurement.unit ?? ""}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {hints.map((hint) => (
          <div
            key={hint.id}
            style={{
              color: hint.ready
                ? "var(--workbench-shell-success-text)"
                : "var(--workbench-shell-text-muted)",
            }}
          >
            {hint.text}
          </div>
        ))}
      </div>
    </Paper>
  );
}

function SketchToolControlField({
  control,
  onPatch,
}: {
  control: SketchToolControl;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const rowStyle = fieldSurfaceStyle({});

  return (
    <div
      className="flex min-h-7 items-stretch rounded-[3px] transition-colors hover:bg-[var(--workbench-shell-overlay)]"
      style={rowStyle}
    >
      <label
        className="flex w-[88px] shrink-0 items-center pl-2 pr-2 text-[11px] font-medium text-[var(--workbench-shell-text-dim)]"
        htmlFor={control.id}
      >
        {control.label}
      </label>
      <div className="min-w-0 flex-1">
        {control.kind === "text" ? (
          <TextInput
            id={control.id}
            disabled={control.disabled}
            placeholder={control.placeholder}
            value={control.value}
            size="xs"
            styles={compactInputStyles({ disabled: control.disabled })}
            onChange={(event) => {
              onPatch({
                ...control.action.patch,
                value: event.currentTarget.value,
              });
            }}
          />
        ) : control.kind === "numeric" ? (
          <NumberInput
            id={control.id}
            disabled={control.disabled}
            value={control.value ?? ""}
            size="xs"
            styles={compactInputStyles({ disabled: control.disabled })}
            onChange={(nextValue) => {
              const resolved =
                typeof nextValue === "number" && !Number.isNaN(nextValue)
                  ? nextValue
                  : null;
              onPatch({ ...control.action.patch, value: resolved });
            }}
          />
        ) : control.kind === "option" ? (
          <Select
            id={control.id}
            disabled={control.disabled}
            value={control.value ?? ""}
            data={control.options.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
            size="xs"
            styles={compactSelectStyles({ disabled: control.disabled })}
            onChange={(value) => {
              onPatch({ ...control.action.patch, value });
            }}
          />
        ) : control.kind === "toggle" ? (
          <div className="flex items-center pl-1">
            <Switch
              id={control.id}
              disabled={control.disabled}
              checked={control.value}
              size="xs"
              color="workbench"
              onChange={(event) => {
                onPatch({
                  ...control.action.patch,
                  value: event.currentTarget.checked,
                });
              }}
            />
          </div>
        ) : (
          /* color control — no Mantine equivalent */
          <input
            id={control.id}
            className="h-7 w-full cursor-pointer rounded-[3px] border-0 bg-transparent p-0.5"
            disabled={control.disabled}
            type="color"
            value={control.value}
            onChange={(event) => {
              onPatch({
                ...control.action.patch,
                value: event.currentTarget.value,
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
