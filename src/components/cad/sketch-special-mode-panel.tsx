import type { ChangeEvent } from 'react'

import type {
  SketchSpecialModePanelAction,
  SketchSpecialModePanelButton,
  SketchSpecialModePanelField,
  SketchSpecialModePanelSchema,
} from '@/domain/sketch-special-modes/schema'

interface SketchSpecialModePanelProps {
  schema: SketchSpecialModePanelSchema | null
  onAction: (action: SketchSpecialModePanelAction) => void
}

export function SketchSpecialModePanel({
  schema,
  onAction,
}: SketchSpecialModePanelProps) {
  if (!schema) {
    return null
  }

  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-20 w-[320px] max-w-[calc(100vw-32px)] rounded-xl border border-[var(--workbench-shell-border)] bg-[var(--workbench-shell-overlay-strong)] p-3 text-[12px] text-[var(--workbench-shell-text)] shadow-[var(--workbench-panel-shadow)]">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--mantine-color-dark-3)]">Special mode</p>
          <h2 className="text-sm font-semibold text-[var(--mantine-color-dark-0)]">{schema.title}</h2>
          {schema.subtitle ? (
            <p className="text-xs text-[var(--mantine-color-dark-2)]">{schema.subtitle}</p>
          ) : null}
        </div>
        {schema.prompts?.map((prompt) => (
          <div
            key={prompt.id}
            className="rounded-md border border-[var(--cad-border)] bg-[var(--workbench-shell-overlay-soft)] px-3 py-2 text-xs text-[var(--mantine-color-dark-1)]"
          >
            {prompt.text}
          </div>
        ))}
        {schema.sections.map((section) => (
          <section
            key={section.id}
            className="space-y-2 rounded-lg border border-[var(--cad-border)] bg-[var(--workbench-shell-overlay-soft)] px-3 py-3"
          >
            <div className="space-y-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--mantine-color-dark-3)]">
                {section.title}
              </h3>
              {section.description ? (
                <p className="text-xs text-[var(--mantine-color-dark-2)]">{section.description}</p>
              ) : null}
            </div>
            {section.fields?.map((field) => (
              <SpecialModePanelField key={field.id} field={field} onAction={onAction} />
            ))}
            {section.diagnostics?.map((diagnostic) => (
              <div
                key={diagnostic.id}
                className="rounded-md border border-[var(--workbench-shell-danger-border)] bg-[var(--workbench-shell-danger-surface)] px-3 py-2 text-xs text-[var(--workbench-shell-danger-text)]"
              >
                {diagnostic.message}
              </div>
            ))}
            {section.buttons && section.buttons.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {section.buttons.map((button) => (
                  <PanelButton key={button.id} button={button} onAction={onAction} />
                ))}
              </div>
            ) : null}
          </section>
        ))}
        {schema.footerButtons && schema.footerButtons.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--cad-border)] pt-3">
            {schema.footerButtons.map((button) => (
              <PanelButton key={button.id} button={button} onAction={onAction} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SpecialModePanelField({
  field,
  onAction,
}: {
  field: SketchSpecialModePanelField
  onAction: (action: SketchSpecialModePanelAction) => void
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--mantine-color-dark-1)]">{field.label}</span>
        {'unit' in field && field.unit ? (
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--mantine-color-dark-3)]">{field.unit}</span>
        ) : null}
      </div>
      {field.kind === 'text' ? (
        <input
          className={`mt-1 w-full rounded-md border border-[var(--cad-border)] bg-[var(--workbench-shell-overlay-strong)] px-2 py-1.5 text-[12px] text-[var(--workbench-shell-text)] outline-none ${field.disabled ? 'opacity-60' : ''}`}
          disabled={field.disabled}
          placeholder={field.placeholder}
          type="text"
          value={field.value}
          onChange={(event) => {
            onAction({
              kind: 'patch',
              patch: {
                ...field.action.patch,
                value: event.currentTarget.value,
              },
            })
          }}
        />
      ) : field.kind === 'numeric' ? (
        <input
          className={`mt-1 w-full rounded-md border border-[var(--cad-border)] bg-[var(--workbench-shell-overlay-strong)] px-2 py-1.5 text-[12px] text-[var(--workbench-shell-text)] outline-none ${field.disabled ? 'opacity-60' : ''}`}
          disabled={field.disabled}
          type="number"
          value={field.value ?? ''}
          onChange={(event) => {
            const parsed = Number(event.currentTarget.value)
            onAction({
              kind: 'patch',
              patch: {
                ...field.action.patch,
                value: Number.isNaN(parsed) ? null : parsed,
              },
            })
          }}
        />
      ) : field.kind === 'toggle' ? (
        <input
          className="mt-2 h-4 w-4 rounded border border-[var(--cad-border)] bg-[var(--workbench-shell-overlay-strong)]"
          checked={field.value}
          disabled={field.disabled}
          type="checkbox"
          onChange={(event) => {
            onAction({
              kind: 'patch',
              patch: {
                ...field.action.patch,
                value: event.currentTarget.checked,
              },
            })
          }}
        />
      ) : field.kind === 'option' ? (
        <select
          className={`mt-1 w-full rounded-md border border-[var(--cad-border)] bg-[var(--workbench-shell-overlay-strong)] px-2 py-1.5 text-[12px] text-[var(--workbench-shell-text)] outline-none ${field.disabled ? 'opacity-60' : ''}`}
          disabled={field.disabled}
          value={field.value ?? ''}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            onAction({
              kind: 'patch',
              patch: {
                ...field.action.patch,
                value: event.currentTarget.value || null,
              },
            })
          }}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="mt-1 rounded-md border border-[var(--cad-border)] bg-[var(--workbench-shell-overlay-strong)] px-2 py-2 font-mono text-[12px] text-[var(--mantine-color-dark-0)]">
          {field.value}
        </div>
      )}
      {'helper' in field && field.helper ? (
        <p className="mt-1 text-[11px] text-[var(--mantine-color-dark-2)]">{field.helper}</p>
      ) : null}
      {'error' in field && field.error ? (
        <p className="mt-1 text-[11px] text-[var(--workbench-shell-danger-text)]">{field.error}</p>
      ) : null}
    </label>
  )
}

function PanelButton({
  button,
  onAction,
}: {
  button: SketchSpecialModePanelButton
  onAction: (action: SketchSpecialModePanelAction) => void
}) {
  const toneClassName =
    button.tone === 'primary'
      ? 'border-[var(--workbench-shell-accent)] text-[var(--workbench-shell-accent)]'
      : button.tone === 'danger'
        ? 'border-[var(--workbench-shell-danger-border)] text-[var(--workbench-shell-danger-text)]'
        : 'border-[var(--cad-border)] text-[var(--workbench-shell-text)]'

  return (
    <button
      type="button"
      disabled={button.disabled}
      className={`rounded-md border bg-transparent px-3 py-1.5 text-xs ${toneClassName} ${button.disabled ? 'opacity-60' : ''}`}
      onClick={() => onAction(button.action)}
    >
      {button.label}
    </button>
  )
}
