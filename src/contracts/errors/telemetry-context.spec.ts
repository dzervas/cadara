import { test } from 'bun:test'

import {
  clearActiveDocumentTelemetryContext,
  createActiveDocumentTelemetryContext,
  getErrorReporterTelemetryContext,
  publishActiveDocumentTelemetryContext,
} from '@/contracts/errors/telemetry-context'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/contracts/errors/telemetry-context.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  clearActiveDocumentTelemetryContext()
  assert(
    getErrorReporterTelemetryContext().activeDocument.availability === 'unavailable',
    'Telemetry context should start unavailable.',
  )

  const adapter = new MockKernelAdapter()
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
  })).snapshot
  const context = createActiveDocumentTelemetryContext(snapshot)

  assert(context.availability === 'loaded', 'Snapshot telemetry context should be loaded.')
  assert(context.documentId === snapshot.document.documentId, 'Snapshot telemetry should include document id.')
  assert(context.revisionId === snapshot.document.revisionId, 'Snapshot telemetry should include revision id.')
  assert(context.counts.sketches === snapshot.document.sketches.length, 'Snapshot telemetry should include sketch count.')
  assert(context.counts.features === snapshot.document.features.length, 'Snapshot telemetry should include feature count.')
  assert(context.payloadStatus === 'attached', 'Small durable authored document payloads should be attached.')
  assert(context.document.documentId === snapshot.document.documentId, 'Attached payload should be the durable authored document.')
  assert(!('render' in context.document), 'Attached payload should exclude render exports.')
  assert(!('presentation' in context.document), 'Attached payload should exclude presentation state.')

  publishActiveDocumentTelemetryContext(context)
  assert(
    getErrorReporterTelemetryContext().activeDocument.availability === 'loaded',
    'Published telemetry context should be readable by reporters.',
  )

  const omittedContext = createActiveDocumentTelemetryContext(snapshot, { payloadByteLimit: 1 })
  assert(omittedContext.availability === 'loaded', 'Oversized document telemetry should still carry identity.')
  assert(omittedContext.payloadStatus === 'omitted-too-large', 'Oversized payloads should be omitted explicitly.')
  assert(omittedContext.documentId === snapshot.document.documentId, 'Oversized fallback should keep document id.')
  assert(omittedContext.revisionId === snapshot.document.revisionId, 'Oversized fallback should keep revision id.')
  assert('omittedReason' in omittedContext, 'Oversized fallback should explain why the payload is absent.')
  assert(!('document' in omittedContext), 'Oversized fallback should not attach the full document.')

  clearActiveDocumentTelemetryContext()
  assert(
    getErrorReporterTelemetryContext().activeDocument.availability === 'unavailable',
    'Clearing telemetry context should mark the active document unavailable.',
  )
})
