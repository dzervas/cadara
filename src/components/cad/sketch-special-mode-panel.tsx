import type { ChangeEvent } from 'react'

import {
  Alert,
  Button,
  Code,
  Divider,
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
          <Text size="10px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.2em' }}>
            Special mode
          </Text>
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
                      border: '1px solid var(--cad-border)',
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
              <Text size="10px" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.2em' }}>
                {section.title}
              </Text>
            </div>
            <div className="space-y-2 px-2">
              <Paper
                withBorder
                className="rounded-[6px] px-3 py-3"
                style={{
                  background: 'var(--workbench-shell-overlay-soft)',
                  borderColor: 'var(--cad-border)',
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
                              : '1px solid var(--cad-border)',
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
              </Paper>
            </div>
          </section>
        ))}
      </div>

      {schema.footerButtons && schema.footerButtons.length > 0 ? (
        <>
          <Divider color="var(--cad-border)" />
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
  if (field.kind === 'text') {
    return (
      <TextInput
        label={field.label}
        value={field.value}
        placeholder={field.placeholder}
        description={field.helper}
        error={field.error}
        disabled={field.disabled}
        size="xs"
        styles={fieldStyles}
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
    )
  }

  if (field.kind === 'numeric') {
    return (
      <NumberInput
        label={field.label}
        value={field.value ?? ''}
        suffix={field.unit ? ` ${field.unit}` : undefined}
        description={field.helper}
        error={field.error}
        disabled={field.disabled}
        size="xs"
        styles={fieldStyles}
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
    )
  }

  if (field.kind === 'toggle') {
    return (
      <Switch
        label={field.label}
        checked={field.value}
        description={field.helper}
        disabled={field.disabled}
        size="xs"
        color="teal"
        styles={{
          ...fieldStyles,
          label: {
            color: 'var(--workbench-shell-text)',
            fontSize: '12px',
          },
          description: {
            color: 'var(--workbench-shell-text-dim)',
            fontSize: '11px',
          },
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onAction({
            kind: 'patch',
            patch: {
              ...field.action.patch,
              value: event.currentTarget.checked,
            },
          })
        }}
      />
    )
  }

  if (field.kind === 'option') {
    return (
      <Select
        label={field.label}
        value={field.value}
        data={field.options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        description={field.helper}
        error={field.error}
        disabled={field.disabled}
        size="xs"
        styles={fieldStyles}
        onChange={(value) => {
          onAction({
            kind: 'patch',
            patch: {
              ...field.action.patch,
              value,
            },
          })
        }}
      />
    )
  }

  return (
    <div>
      <Text size="12px" fw={500} c="dark.1" mb={4}>
        {field.label}
      </Text>
      <Code
        block
        className="rounded-[6px] px-2 py-2 text-[12px]"
        style={{
          background: 'var(--workbench-shell-overlay-strong)',
          border: '1px solid var(--cad-border)',
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

const fieldStyles = {
  label: {
    color: 'var(--workbench-shell-text)',
    fontSize: '12px',
    marginBottom: 4,
  },
  input: {
    background: 'var(--workbench-shell-overlay-strong)',
    borderColor: 'var(--cad-border)',
    color: 'var(--workbench-shell-text)',
  },
  description: {
    color: 'var(--workbench-shell-text-dim)',
    fontSize: '11px',
  },
  error: {
    fontSize: '11px',
  },
  dropdown: {
    background: 'var(--workbench-shell-surface-panel-elev)',
    borderColor: 'var(--cad-border)',
  },
  option: {
    color: 'var(--workbench-shell-text)',
  },
} as const
