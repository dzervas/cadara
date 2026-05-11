import { Paper, Text } from "@mantine/core";

import type { MeasurementViewModel } from "@/domain/measure/measurement";

interface MeasurementPanelProps {
  measurement: MeasurementViewModel | null;
}

export function MeasurementPanel({ measurement }: MeasurementPanelProps) {
  if (!measurement || (measurement.rows.length === 0 && !measurement.note)) {
    return null;
  }

  return (
    <Paper
      radius="md"
      withBorder
      className="w-[240px] border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] px-3 py-2 text-xs shadow-[var(--cad-panel-shadow)]"
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
      <Text size="sm" fw={600} c="var(--cad-foreground)" className="mt-1">
        {measurement.title}
      </Text>
      <Text
        size="11px"
        c="var(--workbench-shell-text-muted)"
        className="mt-0.5"
      >
        {measurement.subtitle}
      </Text>

      <div className="mt-3 grid gap-1.5">
        {measurement.rows.map((row) => (
          <div
            key={row.id}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="text-[var(--cad-muted-foreground)]">
              {row.label}
            </span>
            <span className="text-right font-mono text-[12px] text-[var(--cad-foreground)]">
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {measurement.note ? (
        <Text
          size="11px"
          c="var(--workbench-shell-text-muted)"
          className={measurement.rows.length > 0 ? "mt-3" : "mt-2"}
        >
          {measurement.note}
        </Text>
      ) : null}
    </Paper>
  );
}
