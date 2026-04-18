import type { SketchToolPresentationSchema } from '@/domain/sketch-tools/editor-schema'

interface SketchToolPanelProps {
  schema: SketchToolPresentationSchema | null
  onPatch: (patch: Record<string, unknown>) => void
}

function formatNumber(value: number | null) {
  return value === null ? 'n/a' : value.toFixed(2)
}

export function SketchToolPanel({ schema, onPatch }: SketchToolPanelProps) {
  if (!schema) {
    return null
  }

  const validation = schema.validation ?? []
  const controls = schema.controls ?? []
  const measurements = schema.measurements ?? []
  const hints = schema.completionHints ?? []
  const hasViewportDrawingFeedback = !schema.selectionGuide && (schema.overlays ?? []).some(
    (overlay) => overlay.kind === 'measurement' || overlay.kind === 'completionCue',
  )

  if (hasViewportDrawingFeedback) {
    return null
  }

  return (
    <div className="pointer-events-auto absolute left-4 top-4 w-[260px] rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-3 text-xs text-[var(--cad-muted-foreground)] shadow-[var(--cad-panel-shadow)]">
      <div className="grid gap-2">
        {schema.prompts.map((prompt) => (
          <div key={prompt.id} className="text-sm font-medium text-[var(--cad-foreground)]">
            {prompt.text}
          </div>
        ))}
        {schema.cursor ? (
          <div className="text-[var(--cad-muted-foreground)]">
            Cursor: <span className="text-[var(--cad-foreground)]">{schema.cursor.label}</span>
          </div>
        ) : null}
        {schema.steps?.map((step) => (
          <div key={step.id}>
            Step: <span className="text-[var(--cad-foreground)]">{step.label}</span>
          </div>
        ))}
        {schema.selectionGuide ? (
          <div className="rounded-md border border-[var(--cad-border)] px-2 py-1">
            <div className="text-[var(--cad-foreground)]">{schema.selectionGuide.label}</div>
            <div className="mt-1">
              Targets: {schema.selectionGuide.selectedCount}/{schema.selectionGuide.requiredCount}
            </div>
            {schema.selectionGuide.hoverLabel ? (
              <div>Hover: {schema.selectionGuide.hoverLabel}</div>
            ) : null}
          </div>
        ) : null}
        {validation.map((message) => (
          <div
            key={message.id}
            className="rounded-md border border-[var(--workbench-shell-danger-border)] bg-[var(--workbench-shell-danger-surface)] px-2 py-1 text-[var(--workbench-shell-danger-text)]"
          >
            {message.message}
          </div>
        ))}
        {controls.length > 0 ? (
          <div className="grid gap-2 border-t border-[var(--cad-border)] pt-2">
            {controls.map((control) => (
              <label key={control.id} className="grid gap-1">
                <span>{control.label}</span>
                {control.kind === 'numeric' ? (
                  <input
                    className="h-8 rounded-md border border-[var(--cad-border)] bg-[var(--cad-surface)] px-2 text-[var(--cad-foreground)] outline-none"
                    disabled={control.disabled}
                    type="number"
                    value={control.value ?? ''}
                    onChange={(event) => {
                      const nextValue = Number(event.currentTarget.value)
                      onPatch({
                        ...control.action.patch,
                        value: Number.isNaN(nextValue) ? null : nextValue,
                      })
                    }}
                  />
                ) : control.kind === 'option' ? (
                  <select
                    className="h-8 rounded-md border border-[var(--cad-border)] bg-[var(--cad-surface)] px-2 text-[var(--cad-foreground)] outline-none"
                    disabled={control.disabled}
                    value={control.value ?? ''}
                    onChange={(event) => {
                      onPatch({
                        ...control.action.patch,
                        value: event.currentTarget.value,
                      })
                    }}
                  >
                    {control.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : control.kind === 'toggle' ? (
                  <input
                    className="h-4 w-4 rounded border border-[var(--cad-border)] bg-[var(--cad-surface)] text-[var(--cad-foreground)] outline-none"
                    disabled={control.disabled}
                    type="checkbox"
                    checked={control.value}
                    onChange={(event) => {
                      onPatch({
                        ...control.action.patch,
                        value: event.currentTarget.checked,
                      })
                    }}
                  />
                ) : (
                  <input
                    className="h-8 rounded-md border border-[var(--cad-border)] bg-[var(--cad-surface)] px-2 text-[var(--cad-foreground)] outline-none"
                    disabled={control.disabled}
                    type="color"
                    value={control.value}
                    onChange={(event) => {
                      onPatch({
                        ...control.action.patch,
                        value: event.currentTarget.value,
                      })
                    }}
                  />
                )}
              </label>
            ))}
          </div>
        ) : null}
        {measurements.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 border-t border-[var(--cad-border)] pt-2">
            {measurements.map((measurement) => (
              <div key={measurement.id}>
                <div>{measurement.label}</div>
                <div className="text-[var(--cad-foreground)]">
                  {formatNumber(measurement.value)} {measurement.unit ?? ''}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {hints.map((hint) => (
          <div
            key={hint.id}
            className={hint.ready ? 'text-[var(--workbench-shell-success-text)]' : 'text-[var(--cad-muted-foreground)]'}
          >
            {hint.text}
          </div>
        ))}
      </div>
    </div>
  )
}
