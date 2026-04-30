import type { ChangeEvent } from 'react'

import {
  Alert,
  Button,
  Code,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core'

import type {
  SketchSpecialModePanelAction,
  SketchSpecialModePanelButton,
  SketchSpecialModePanelField,
  SketchSpecialModePanelSchema,
} from '@/core/sketch-special-modes/schema'
import {
  SECTION_HEADER_CLASSES,
  compactInputStyles,
  compactSelectStyles,
  fieldSurfaceStyle,
} from '@/components/ui/workbench-panel-styles'

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
    <Paper
      component="aside"
      className="pointer-events-auto absolute left-4 top-4 z-20 flex max-h-[70vh] w-[320px] max-w-[calc(100vw-32px)] min-w-0 flex-col overflow-hidden rounded-[6px]"
      style={{
        background: 'var(--workbench-shell-surface-panel-elev)',
        boxShadow: 'var(--workbench-shell-elevation-md)',
      }}
    >
      <header className="px-3 pb-2.5 pt-3">
        <Stack gap={4}>
          <p className={SECTION_HEADER_CLASSES}>Special mode</p>
          <Text size="13px" fw={500} c="dark.0">
            {schema.title}
          </Text>
          {schema.subtitle ? (
            <Text size="11px" c="dimmed">
              {schema.subtitle}
            </Text>
          ) : null}
        </Stack>
      </header>

      <div className="flex-1 overflow-y-auto pb-1">
        {schema.prompts?.length ? (
          <div className="px-3 pb-2">
            <Stack gap="xs">
              {schema.prompts.map((prompt) => (
                <Alert
                  key={prompt.id}
                  variant="light"
                  color={prompt.tone === 'success' ? 'teal' : prompt.tone === 'warning' ? 'yellow' : 'gray'}
                  styles={{
                    root: {
                      background: 'var(--workbench-shell-overlay-soft)',
                      border: '1px solid var(--workbench-shell-border)',
                    },
                    body: {
                      color: 'var(--workbench-shell-text)',
                    },
                  }}
                >
                  {prompt.text}
                </Alert>
              ))}
            </Stack>
          </div>
        ) : null}

        {schema.sections.map((section) => (
          <section key={section.id} className="pb-1">
            <div className="flex items-center justify-between px-3 pb-1 pt-3">
              <p className={SECTION_HEADER_CLASSES}>{section.title}</p>
            </div>
            <div className="space-y-0.5 px-2">
              <div
                className="rounded-[6px] px-3 py-3"
                style={{
                  background: 'var(--workbench-shell-overlay-soft)',
                  border: '1px solid var(--workbench-shell-border)',
                }}
              >
                <Stack gap="sm">
                  {section.description ? (
                    <Text size="11px" c="dimmed">
                      {section.description}
                    </Text>
                  ) : null}
                  {section.fields?.map((field) => (
                    <SpecialModePanelField key={field.id} field={field} onAction={onAction} />
                  ))}
                  {section.diagnostics?.map((diagnostic) => (
                    <Alert
                      key={diagnostic.id}
                      variant="light"
                      color={diagnostic.severity === 'error' ? 'red' : diagnostic.severity === 'warning' ? 'yellow' : 'blue'}
                      styles={{
                        root: {
                          background:
                            diagnostic.severity === 'error'
                              ? 'var(--workbench-shell-danger-surface)'
                              : 'var(--workbench-shell-overlay)',
                          border:
                            diagnostic.severity === 'error'
                              ? '1px solid var(--workbench-shell-danger-border)'
                              : '1px solid var(--workbench-shell-border)',
                        },
                        body: {
                          color:
                            diagnostic.severity === 'error'
                              ? 'var(--workbench-shell-danger-text)'
                              : 'var(--workbench-shell-text)',
                        },
                      }}
                    >
                      {diagnostic.message}
                    </Alert>
                  ))}
                  {section.buttons && section.buttons.length > 0 ? (
                    <Group gap="xs" justify="flex-start">
                      {section.buttons.map((button) => (
                        <PanelButton key={button.id} button={button} onAction={onAction} />
                      ))}
                    </Group>
                  ) : null}
                </Stack>
              </div>
            </div>
          </section>
        ))}
      </div>

      {schema.footerButtons && schema.footerButtons.length > 0 ? (
        <>
          <div className="border-t border-[var(--workbench-shell-border)]" />
          <footer className="flex items-center justify-end gap-2 px-3 py-2.5">
            {schema.footerButtons.map((button) => (
              <PanelButton key={button.id} button={button} onAction={onAction} />
            ))}
          </footer>
        </>
      ) : null}
    </Paper>
  )
}

function SpecialModePanelField({
  field,
  onAction,
}: {
  field: SketchSpecialModePanelField
  onAction: (action: SketchSpecialModePanelAction) => void
}) {
  const fieldError = 'error' in field && field.error ? { message: field.error } : null
  const rowStyle = fieldSurfaceStyle({ error: fieldError })

  if (field.kind === 'text') {
    return (
      <div
        className="flex min-h-7 items-stretch rounded-[3px] transition-colors hover:bg-[var(--workbench-shell-overlay)]"
        style={rowStyle}
      >
        <label
          className="flex w-[88px] shrink-0 items-center pl-2 pr-2 text-[11px] font-medium text-[var(--workbench-shell-text-dim)]"
          htmlFor={field.id}
        >
          {field.label}
        </label>
        <div className="min-w-0 flex-1">
          <TextInput
            id={field.id}
            value={field.value}
            placeholder={field.placeholder}
            disabled={field.disabled}
            size="xs"
            styles={compactInputStyles({ disabled: field.disabled })}
            onChange={(event) => {
              onAction({
                kind: 'patch',
                patch: { ...field.action.patch, value: event.currentTarget.value },
              })
            }}
          />
        </div>
      </div>
    )
  }

  if (field.kind === 'numeric') {
    return (
      <div
        className="flex min-h-7 items-stretch rounded-[3px] transition-colors hover:bg-[var(--workbench-shell-overlay)]"
        style={rowStyle}
      >
        <label
          className="flex w-[88px] shrink-0 items-center pl-2 pr-2 text-[11px] font-medium text-[var(--workbench-shell-text-dim)]"
          htmlFor={field.id}
        >
          {field.label}
          {field.unit ? <span className="ml-1 font-mono text-[10px] opacity-60">{field.unit}</span> : null}
        </label>
        <div className="min-w-0 flex-1">
          <NumberInput
            id={field.id}
            value={field.value ?? ''}
            disabled={field.disabled}
            size="xs"
            styles={compactInputStyles({ disabled: field.disabled })}
            onChange={(nextValue) => {
              onAction({
                kind: 'patch',
                patch: {
                  ...field.action.patch,
                  value: typeof nextValue === 'number' && !Number.isNaN(nextValue) ? nextValue : null,
                },
              })
            }}
          />
        </div>
      </div>
    )
  }

  if (field.kind === 'toggle') {
    return (
      <div
        className="flex min-h-7 items-center rounded-[3px] px-2 transition-colors hover:bg-[var(--workbench-shell-overlay)]"
        style={rowStyle}
      >
        <Switch
          id={field.id}
          label={field.label}
          checked={field.value}
          disabled={field.disabled}
          size="xs"
          color="teal"
          styles={{
            label: {
              color: 'var(--workbench-shell-text)',
              fontSize: '12px',
            },
          }}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onAction({
              kind: 'patch',
              patch: { ...field.action.patch, value: event.currentTarget.checked },
            })
          }}
        />
      </div>
    )
  }

  if (field.kind === 'option') {
    return (
      <div
        className="flex min-h-7 items-stretch rounded-[3px] transition-colors hover:bg-[var(--workbench-shell-overlay)]"
        style={rowStyle}
      >
        <label
          className="flex w-[88px] shrink-0 items-center pl-2 pr-2 text-[11px] font-medium text-[var(--workbench-shell-text-dim)]"
          htmlFor={field.id}
        >
          {field.label}
        </label>
        <div className="min-w-0 flex-1">
          <Select
            id={field.id}
            value={field.value}
            data={field.options.map((option) => ({ value: option.value, label: option.label }))}
            disabled={field.disabled}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
            size="xs"
            styles={compactSelectStyles({ disabled: field.disabled })}
            onChange={(value) => {
              onAction({
                kind: 'patch',
                patch: { ...field.action.patch, value },
              })
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <p className={SECTION_HEADER_CLASSES}>{field.label}</p>
      <Code
        block
        className="rounded-[6px] px-2 py-2 text-[12px]"
        style={{
          background: 'var(--workbench-shell-overlay-strong)',
          border: '1px solid var(--workbench-shell-border)',
          color: 'var(--mantine-color-dark-0)',
        }}
      >
        {field.value}
      </Code>
      {field.helper ? (
        <Text size="11px" c="dimmed" mt={4}>
          {field.helper}
        </Text>
      ) : null}
    </div>
  )
}

function PanelButton({
  button,
  onAction,
}: {
  button: SketchSpecialModePanelButton
  onAction: (action: SketchSpecialModePanelAction) => void
}) {
  return (
    <Button
      type="button"
      size="xs"
      disabled={button.disabled}
      variant={button.tone === 'primary' ? 'filled' : button.tone === 'danger' ? 'light' : 'subtle'}
      color={button.tone === 'primary' ? 'teal' : button.tone === 'danger' ? 'red' : 'gray'}
      styles={{
        root: {
          backgroundColor:
            button.tone === 'primary'
              ? 'var(--workbench-shell-accent)'
              : undefined,
          color:
            button.tone === 'primary'
              ? 'var(--mantine-color-dark-9)'
              : button.tone === 'danger'
                ? 'var(--workbench-shell-danger-text)'
                : 'var(--workbench-shell-text-muted)',
        },
      }}
      onClick={() => onAction(button.action)}
    >
      {button.label}
    </Button>
  )
}
