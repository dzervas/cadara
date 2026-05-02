import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  clearActiveDocumentTelemetryContext,
  createActiveDocumentTelemetryContext,
  getErrorReporterTelemetryContext,
  publishActiveDocumentTelemetryContext,
} from '@/contracts/errors/telemetry-context'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { createGeometryAssetDiagnostic } from '@/contracts/modeling/geometry-assets'
import { createDeterministicGeometryAsset } from '@/domain/modeling/geometry-asset-test-helpers'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/contracts/errors/telemetry-context.spec.ts', async () => {  clearActiveDocumentTelemetryContext()
  expectTrue(
    getErrorReporterTelemetryContext().activeDocument.availability === 'unavailable',
    'Telemetry context should start unavailable.',
  )

  const adapter = new MockKernelAdapter()
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
  })).snapshot
  const context = createActiveDocumentTelemetryContext(snapshot)

  expectTrue(context.availability === 'loaded', 'Snapshot telemetry context should be loaded.')
  expectTrue(context.documentId === snapshot.document.documentId, 'Snapshot telemetry should include document id.')
  expectTrue(context.revisionId === snapshot.document.revisionId, 'Snapshot telemetry should include revision id.')
  expectTrue(context.counts.sketches === snapshot.document.sketches.length, 'Snapshot telemetry should include sketch count.')
  expectTrue(context.counts.features === snapshot.document.features.length, 'Snapshot telemetry should include feature count.')
  expectTrue(context.payloadStatus === 'attached', 'Small durable authored document payloads should be attached.')
  expectTrue(context.document.documentId === snapshot.document.documentId, 'Attached payload should be the durable authored document.')
  expectTrue(!('render' in context.document), 'Attached payload should exclude render exports.')
  expectTrue(!('presentation' in context.document), 'Attached payload should exclude presentation state.')

  const asset = await createDeterministicGeometryAsset({ ownerFeatureIds: [snapshot.document.features[0]!.featureId] })
  const diagnosticSnapshot = structuredClone(snapshot)
  diagnosticSnapshot.document.diagnostics = [
    createGeometryAssetDiagnostic('geometry-asset-missing', asset.asset, 'Referenced geometry asset bytes are missing.'),
  ]
  const assetContext = createActiveDocumentTelemetryContext(diagnosticSnapshot)
  expectTrue(
    assetContext.availability === 'loaded'
      && assetContext.assetDiagnostics[0]?.hashPrefix === asset.asset.hash.replace(/^sha256:/, '').slice(0, 12)
      && !('bytes' in assetContext.assetDiagnostics[0]),
    'Telemetry should summarize geometry asset diagnostics without raw bytes.',
  )

  publishActiveDocumentTelemetryContext(context)
  expectTrue(
    getErrorReporterTelemetryContext().activeDocument.availability === 'loaded',
    'Published telemetry context should be readable by reporters.',
  )

  const omittedContext = createActiveDocumentTelemetryContext(snapshot, { payloadByteLimit: 1 })
  expectTrue(omittedContext.availability === 'loaded', 'Oversized document telemetry should still carry identity.')
  expectTrue(omittedContext.payloadStatus === 'omitted-too-large', 'Oversized payloads should be omitted explicitly.')
  expectTrue(omittedContext.documentId === snapshot.document.documentId, 'Oversized fallback should keep document id.')
  expectTrue(omittedContext.revisionId === snapshot.document.revisionId, 'Oversized fallback should keep revision id.')
  expectTrue('omittedReason' in omittedContext, 'Oversized fallback should explain why the payload is absent.')
  expectTrue(!('document' in omittedContext), 'Oversized fallback should not attach the full document.')

  clearActiveDocumentTelemetryContext()
  expectTrue(
    getErrorReporterTelemetryContext().activeDocument.availability === 'unavailable',
    'Clearing telemetry context should mark the active document unavailable.',
  )
})
