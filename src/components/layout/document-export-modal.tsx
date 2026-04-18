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
  Text,
} from '@mantine/core'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import type {
  DocumentExportFormat,
  DocumentExportSuccessResult,
} from '@/contracts/modeling/export'
import {
  appErrorFromModelingResult,
  err,
  ok,
  type ErrorReporter,
} from '@/contracts/errors'
import {
  getDefaultCadaraExportOptions,
  getDefaultStlExportOptions,
  getDefaultStepExportOptions,
  getDefaultThreeMfExportOptions,
} from '@/contracts/modeling/export.runtime-schema'
import type {
  ModelingExportDocumentInput,
  ModelingExportDocumentResult,
} from '@/domain/modeling/modeling-service'
import type { ObjectExportModalState } from '@/app/object-export-state'
import { runWorkbenchAction } from '@/app/workbench-action'
import { buildDocumentExportModalInput } from '@/components/layout/document-export-modal-input'

interface DocumentExportModalProps {
  exportDocument: (input: ModelingExportDocumentInput) => Promise<ModelingExportDocumentResult>
  errorReporter: ErrorReporter
  initialFormat?: DocumentExportFormat
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
  initialFormat: DocumentExportFormat
  onClose: DocumentExportModalProps['onClose']
  onDownload: DocumentExportModalProps['onDownload']
  target: ObjectExportModalState
}

function formatExportFailure(result: ModelingExportDocumentResult) {
  return result.diagnostics[0]?.message ?? 'Export failed.'
}

function DocumentExportModalContent({
  exportDocument,
  errorReporter,
  initialFormat,
  onClose,
  onDownload,
  target,
}: DocumentExportModalContentProps) {
  const [format, setFormat] = useState<DocumentExportFormat>(initialFormat)
  const [stlOptions, setStlOptions] = useState(getDefaultStlExportOptions)
  const [stepOptions, setStepOptions] = useState(getDefaultStepExportOptions)
  const [threeMfOptions, setThreeMfOptions] = useState(getDefaultThreeMfExportOptions)
  const [cadaraOptions, setCadaraOptions] = useState(getDefaultCadaraExportOptions)
  const [pending, setPending] = useState(false)
  const [failureMessage, setFailureMessage] = useState<string | null>(null)

  const handleSubmit = () => {
    if (pending) {
      return
    }

    const input =
      format === 'stl'
        ? buildDocumentExportModalInput(target, format, stlOptions)
        : format === 'step'
          ? buildDocumentExportModalInput(target, format, stepOptions)
          : format === '3mf'
            ? buildDocumentExportModalInput(target, format, threeMfOptions)
            : buildDocumentExportModalInput(target, format, cadaraOptions)

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

  return (
    <Stack gap="md">
      <SegmentedControl
        aria-label="Export file type"
        data={[
          { label: 'STL', value: 'stl' },
          { label: 'STEP', value: 'step' },
          { label: '3MF', value: '3mf' },
          { label: 'cadara', value: 'cadara' },
        ]}
        styles={{
          root: { isolation: 'isolate' },
          indicator: { zIndex: 0 },
          label: { position: 'relative', zIndex: 1 },
        }}
        value={format}
        onChange={(value) => setFormat(value as DocumentExportFormat)}
      />

      {format === 'stl' ? (
        <Stack gap="xs" data-export-option="mesh-accuracy">
          <Text size="sm" fw={600}>Mesh accuracy</Text>
            <NumberInput
              label="Chord tolerance"
              min={0.001}
              step={0.005}
              value={stlOptions.meshAccuracy.chordTolerance}
              onChange={(value) => setStlOptions((current) => ({
                ...current,
                meshAccuracy: {
                  ...current.meshAccuracy,
                  chordTolerance: toNumber(value, current.meshAccuracy.chordTolerance),
                },
              }))}
            />
            <NumberInput
              label="Angle tolerance"
              min={0.001}
              step={0.01}
              value={stlOptions.meshAccuracy.angleToleranceRadians}
              onChange={(value) => setStlOptions((current) => ({
                ...current,
                meshAccuracy: {
                  ...current.meshAccuracy,
                  angleToleranceRadians: toNumber(value, current.meshAccuracy.angleToleranceRadians),
                },
              }))}
            />
            <Select
              label="Encoding"
              data={[
                { label: 'Binary', value: 'binary' },
                { label: 'ASCII', value: 'ascii' },
              ]}
              value={stlOptions.encoding}
              onChange={(value) => setStlOptions((current) => ({
                ...current,
                encoding: value === 'ascii' ? 'ascii' : 'binary',
              }))}
            />
          </Stack>
        ) : null}

        {format === '3mf' ? (
          <Stack gap="xs" data-export-option="mesh-accuracy">
            <Text size="sm" fw={600}>Mesh accuracy</Text>
            <NumberInput
              label="Chord tolerance"
              min={0.001}
              step={0.005}
              value={threeMfOptions.meshAccuracy.chordTolerance}
              onChange={(value) => setThreeMfOptions((current) => ({
                ...current,
                meshAccuracy: {
                  ...current.meshAccuracy,
                  chordTolerance: toNumber(value, current.meshAccuracy.chordTolerance),
                },
              }))}
            />
            <NumberInput
              label="Angle tolerance"
              min={0.001}
              step={0.01}
              value={threeMfOptions.meshAccuracy.angleToleranceRadians}
              onChange={(value) => setThreeMfOptions((current) => ({
                ...current,
                meshAccuracy: {
                  ...current.meshAccuracy,
                  angleToleranceRadians: toNumber(value, current.meshAccuracy.angleToleranceRadians),
                },
              }))}
            />
            <Select label="Unit" data={[{ label: 'Millimeter', value: 'millimeter' }]} value={threeMfOptions.unit} />
            <Checkbox
              label="Include metadata"
              checked={threeMfOptions.includeMetadata}
              onChange={(event) => setThreeMfOptions((current) => ({
                ...current,
                includeMetadata: event.currentTarget.checked,
              }))}
            />
          </Stack>
        ) : null}

        {format === 'step' ? (
          <Stack gap="xs" data-export-option="step">
            <Text size="sm" fw={600}>STEP options</Text>
            <Select
              label="Schema"
              data={[
                { label: 'AP242', value: 'AP242' },
                { label: 'AP214', value: 'AP214' },
                { label: 'AP203', value: 'AP203' },
              ]}
              value={stepOptions.schema}
              onChange={(value) => setStepOptions((current) => ({
                ...current,
                schema: value === 'AP203' || value === 'AP214' ? value : 'AP242',
              }))}
            />
            <Select label="Unit" data={[{ label: 'Millimeter', value: 'millimeter' }]} value={stepOptions.unit} />
          </Stack>
        ) : null}

        {format === 'cadara' ? (
          <Stack gap="xs" data-export-option="cadara-json">
            <Text size="sm" fw={600}>cadara JSON</Text>
            <Checkbox
              label="Readable formatting"
              checked={cadaraOptions.pretty}
              onChange={(event) => setCadaraOptions({ pretty: event.currentTarget.checked })}
            />
          </Stack>
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
