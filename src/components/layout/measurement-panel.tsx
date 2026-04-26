import { Paper, Text } from '@mantine/core'

import type { MeasurementViewModel } from '@/domain/measure/measurement'

interface MeasurementPanelProps {
  measurement: MeasurementViewModel | null
}

export function MeasurementPanel({ measurement }: MeasurementPanelProps) {
  if (!measurement || (measurement.rows.length === 0 && !measurement.note)) {
    return null
  }

  return (
    <Paper
      radius="md"
      withBorder
      className="w-[240px] border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] px-3 py-2 text-xs shadow-[var(--cad-panel-shadow)]"
    >
      <Text size="10px" fw={700} tt="uppercase" c="dimmed" className="tracking-[0.22em]">
        Measure
      </Text>
      <Text size="sm" fw={600} c="var(--cad-foreground)" className="mt-1">
        {measurement.title}
      </Text>
      <Text size="10px" c="dimmed" className="mt-0.5">
        {measurement.subtitle}
      </Text>

      <div className="mt-3 grid gap-1.5">
        {measurement.rows.map((row) => (
          <div key={row.id} className="flex items-baseline justify-between gap-3">
            <span className="text-[var(--cad-muted-foreground)]">{row.label}</span>
            <span className="text-right text-[var(--cad-foreground)]">{row.value}</span>
          </div>
        ))}
      </div>

      {measurement.note ? (
        <Text size="10px" c="dimmed" className={measurement.rows.length > 0 ? 'mt-3' : 'mt-2'}>
          {measurement.note}
        </Text>
      ) : null}
    </Paper>
  )
}
