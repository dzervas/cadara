import { Paper, Text } from "@mantine/core";
import type { Ref } from "react";

import type { MeasurementViewModel } from "@/domain/measure/measurement";

interface MeasurementPanelProps {
  measurement: MeasurementViewModel | null;
  ref?: Ref<HTMLDivElement>;
}

export function MeasurementPanel({ measurement, ref }: MeasurementPanelProps) {
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
