import { useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
} from '@mantine/core'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { SECTION_HEADER_CLASSES, compactInputStyles, compactSelectStyles } from '@/components/ui/workbench-panel-styles'
import type { DocumentExportSuccessResult } from '@/contracts/modeling/export'
import {
  appErrorFromModelingResult,
  err,
  ok,
  type ErrorReporter,
} from '@/contracts/errors'
import type {
  ModelingExportDocumentInput,
  ModelingExportDocumentResult,
} from '@/domain/modeling/modeling-service'
import type { ObjectExportModalState } from '@/domain/export/object-export-state'
import { runReportedAction as runWorkbenchAction } from '@/lib/reported-action'
import type { ExportProvider } from '@/contracts/export/provider'
import type { FeatureEditorFormField, FeatureEditorFormSection } from '@/core/feature-authoring/form-schema'
import { useRuntimeExtensionRegistry } from '@/hooks/use-runtime-extension-registry'

interface DocumentExportModalProps {
  exportDocument: (input: ModelingExportDocumentInput) => Promise<ModelingExportDocumentResult>
  errorReporter: ErrorReporter
  initialFormat?: string
  onClose: () => void
  onDownload: (result: DocumentExportSuccessResult) => void
  opened: boolean
  target: ObjectExportModalState | null
  withinPortal?: boolean
}

function toNumber(value: string | number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function DocumentExportModal({
  exportDocument,
  errorReporter,
  initialFormat = 'stl',
  onClose,
  onDownload,
  opened,
  target,
  withinPortal = true,
}: DocumentExportModalProps) {
  return (
    <Modal
      centered
      opened={opened}
      onClose={onClose}
      title={`Export ${target?.label ?? 'selection'}`}
      withinPortal={withinPortal}
    >
      {target ? (
        <DocumentExportModalContent
          key={`${target.baseRevisionId}:${target.label}:${initialFormat}`}
          exportDocument={exportDocument}
          errorReporter={errorReporter}
          initialFormat={initialFormat}
          onClose={onClose}
          onDownload={onDownload}
          target={target}
        />
      ) : null}
    </Modal>
  )
}

interface DocumentExportModalContentProps {
  exportDocument: DocumentExportModalProps['exportDocument']
  errorReporter: DocumentExportModalProps['errorReporter']
  initialFormat: string
  onClose: DocumentExportModalProps['onClose']
  onDownload: DocumentExportModalProps['onDownload']
  target: ObjectExportModalState
}

function formatExportFailure(result: ModelingExportDocumentResult) {
  return result.diagnostics[0]?.message ?? 'Export failed.'
}

function buildExportInput(
  target: ObjectExportModalState,
  format: string,
  providerOptions: Record<string, unknown>,
): ModelingExportDocumentInput {
  return {
    baseRevisionId: target.baseRevisionId,
    target: target.target,
    targetLabel: target.label,
    format,
    options: providerOptions[format] ?? {},
  }
}

function renderFormField(
  field: FeatureEditorFormField,
  onPatch: (patch: Record<string, unknown>) => void,
): React.ReactNode {
  if (field.hidden) {
    return null
  }

  if (field.kind === 'numeric') {
    return (
      <NumberInput
        key={field.id}
        label={field.label}
        min={0.001}
        step={field.step}
        value={typeof field.value === 'number' ? field.value : undefined}
        styles={compactInputStyles()}
        onChange={(value) => onPatch({ [field.patch.patchKey]: toNumber(value, typeof field.value === 'number' ? field.value : 0) })}
      />
    )
  }

  if (field.kind === 'enum') {
    return (
      <Select
        key={field.id}
        label={field.label}
        data={field.options.map((opt) => ({ label: opt.label, value: opt.value }))}
        value={field.value}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
        styles={compactSelectStyles()}
        onChange={(value) => { if (value !== null) { onPatch({ [field.patch.patchKey]: value }) } }}
      />
    )
  }

  if (field.kind === 'custom' && field.rendererId === 'checkbox') {
    const payload = field.payload as { checked: boolean; patchKey: string }
    return (
      <Checkbox
        key={field.id}
        label={field.label}
        checked={payload.checked}
        onChange={(event) => onPatch({ [payload.patchKey]: event.currentTarget.checked })}
      />
    )
  }

  return null
}

function renderFormSection(
  section: FeatureEditorFormSection,
  onPatch: (patch: Record<string, unknown>) => void,
): React.ReactNode {
  return (
    <Stack key={section.id} gap="xs">
      <p className={SECTION_HEADER_CLASSES}>{section.title}</p>
      {section.fields.map((field) => renderFormField(field, onPatch))}
    </Stack>
  )
}

function ProviderOptionsForm({
  provider,
  options,
  onPatch,
}: {
  provider: ExportProvider<unknown>
  options: unknown
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const schema = provider.getOptionFormSchema(options) as {
    sections: readonly FeatureEditorFormSection[]
  }

  return (
    <>
      {schema.sections.map((section) => renderFormSection(section, onPatch))}
    </>
  )
}

function DocumentExportModalContent({
  exportDocument,
  errorReporter,
  initialFormat,
  onClose,
  onDownload,
  target,
}: DocumentExportModalContentProps) {
  const { exportProviders } = useRuntimeExtensionRegistry()
  const providers = exportProviders.getAll()
  const [format, setFormat] = useState(() =>
    providers.some((provider) => provider.formatId === initialFormat)
      ? initialFormat
      : (providers[0]?.formatId ?? initialFormat)
  )
  const [providerOptions, setProviderOptions] = useState<Record<string, unknown>>(() => {
    const map: Record<string, unknown> = {}
    for (const provider of providers) {
      map[provider.formatId] = provider.getDefaultOptions()
    }
    return map
  })
  const [pending, setPending] = useState(false)
  const [failureMessage, setFailureMessage] = useState<string | null>(null)

  const activeProvider = providers.find((p) => p.formatId === format)

  const handlePatch = (patch: Record<string, unknown>) => {
    if (!activeProvider) {
      return
    }

    const currentOptions = providerOptions[format]
    const updated = activeProvider.applyOptionPatch(currentOptions, patch)

    setProviderOptions((current) => ({ ...current, [format]: updated }))
  }

  const handleSubmit = () => {
    if (pending) {
      return
    }

    const input = buildExportInput(target, format, providerOptions)

    setPending(true)
    setFailureMessage(null)
    void runWorkbenchAction({
      operation: `Export ${target.label}`,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: target.baseRevisionId },
        { key: 'format', value: input.format },
      ],
      action: async () => {
        const result = await exportDocument(input)
        if (result.ok) {
          onDownload(result)
        }
        return result
      },
      mapSuccess: (result) => {
        if (result.ok) {
          return ok(result)
        }

        return err(appErrorFromModelingResult({
          operation: `Export ${target.label}`,
          fallbackMessage: formatExportFailure(result),
          diagnostics: result.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            detail: null,
          })),
          context: [
            { key: 'baseRevisionId', value: target.baseRevisionId },
            { key: 'format', value: input.format },
          ],
        }))
      },
      onError: (error) => setFailureMessage(error.message),
    })
      .then((result) => {
        if (result.isErr()) {
          return
        }
        onClose()
      })
      .finally(() => setPending(false))
  }

  const formatData = providers.map((p) => ({ label: p.label, value: p.formatId }))

  return (
    <Stack gap="md">
      <SegmentedControl
        aria-label="Export file type"
        data={formatData}
        styles={{
          root: { isolation: 'isolate' },
          indicator: { zIndex: 0 },
          label: { position: 'relative', zIndex: 1 },
        }}
        value={format}
        onChange={setFormat}
      />

      {activeProvider ? (
        <ProviderOptionsForm
          provider={activeProvider}
          options={providerOptions[format]}
          onPatch={handlePatch}
        />
      ) : null}

      {failureMessage ? (
        <Alert color="red" variant="light" title="Export failed">
          {failureMessage}
        </Alert>
      ) : null}

      <Group justify="flex-end" gap="xs">
        <Button variant="subtle" leftSection={<WorkbenchIcon name="close" size={14} />} onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button leftSection={<WorkbenchIcon name="download" size={14} />} onClick={handleSubmit} loading={pending} disabled={!target}>
          Export
        </Button>
      </Group>
    </Stack>
  )
}
