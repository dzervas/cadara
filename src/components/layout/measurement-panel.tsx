import { Button, Paper, Text } from "@mantine/core";
import type { Ref } from "react";

import type {
  MeasurementDistanceMode,
  MeasurementViewModel,
} from "@/core/measure/measurement";

interface MeasurementPanelProps {
  measurement: MeasurementViewModel | null;
  onDistanceModeChange: (mode: MeasurementDistanceMode) => void;
  ref?: Ref<HTMLDivElement>;
}

const DISTANCE_MODES = [
  { value: "minimum", label: "Min" },
  { value: "maximum", label: "Max" },
  { value: "center", label: "Center" },
] satisfies { value: MeasurementDistanceMode; label: string }[];

export function MeasurementPanel({
  measurement,
  onDistanceModeChange,
  ref,
}: MeasurementPanelProps) {
  if (!measurement || (measurement.rows.length === 0 && !measurement.note)) {
    return null;
  }

  return (
    <Paper
      radius="md"
      withBorder
      ref={ref}
      data-measurement-panel=""
      className="w-[240px] shrink-0 border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] px-3 py-2 text-xs shadow-[var(--cad-panel-shadow)]"
    >
      <Text
        size="11px"
        fw={600}
        tt="uppercase"
        c="var(--workbench-shell-text-dim)"
        className="tracking-[0.20em]"
      >
        Measure
      </Text>
      {measurement.targetLabels.map((label, index) => (
        <Text
          key={index}
          size="xs"
          fw={600}
          c="var(--cad-foreground)"
          className={index === 0 ? "mt-1 break-words" : "break-words"}
        >
          {label}
        </Text>
      ))}

      {measurement.distanceMode ? (
        // The readout passes pointer events through to the viewport; only
        // its distance switch takes them (cadara-h026.3). Buttons, not a
        // radio group: a clicked radio input would hold the keyboard
        // shortcuts (Escape clearing the selection) as a text field does.
        <Button.Group
          aria-label="Distance"
          className="pointer-events-auto mt-2"
        >
          {DISTANCE_MODES.map((mode) => {
            const active = mode.value === measurement.distanceMode;
            return (
              <Button
                key={mode.value}
                size="compact-xs"
                fullWidth
                variant={active ? "filled" : "default"}
                aria-pressed={active}
                onClick={() => onDistanceModeChange(mode.value)}
              >
                {mode.label}
              </Button>
            );
          })}
        </Button.Group>
      ) : null}

      {measurement.rows.length > 0 ? (
        <div className="mt-2 grid gap-1 border-t border-[var(--cad-border)] pt-2">
          {measurement.rows.map((row) => (
            <div
              key={row.id}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-[var(--cad-muted-foreground)]">
                {row.label}
              </span>
              <span className="text-right font-mono text-[12px] tabular-nums text-[var(--cad-foreground)]">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {measurement.note ? (
        <Text
          size="11px"
          c="var(--workbench-shell-text-muted)"
          className="mt-2"
        >
          {measurement.note}
        </Text>
      ) : null}
    </Paper>
  );
}
