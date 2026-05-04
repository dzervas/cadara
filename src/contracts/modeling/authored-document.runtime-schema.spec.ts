import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  createAuthoredModelDocumentFromSnapshot,
} from '@/contracts/modeling/authored-document'
import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/contracts/modeling/authored-document.runtime-schema.spec.ts', async () => {  const adapter = new MockKernelAdapter()
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
  })).snapshot

  const authoredDocument = createAuthoredModelDocumentFromSnapshot(snapshot)
  const parsed = parseAuthoredModelDocument(authoredDocument)
  expectTrue(parsed.ok, 'Authored documents derived from snapshots should validate.')
  expectTrue(
    parsed.ok && parsed.document.features.every((feature) => feature.suppressed === false),
    'Authored documents derived from active snapshot features should persist explicit unsuppressed state.',
  )
  expectTrue(parsed.ok && parsed.document.name === snapshot.document.name, 'Authored documents should preserve the durable document name.')
  expectTrue(parsed.ok && parsed.document.assets.records.length === 0, 'Authored documents should default to an empty geometry asset manifest.')
  expectTrue(parsed.ok && parsed.document.embeddedBinaryAssets.length === 0, 'Authored documents should default to an empty embedded binary asset list.')

  const missingSuppression = structuredClone(authoredDocument) as unknown as {
    features: Array<Record<string, unknown>>
  }
  delete missingSuppression.features[0]!.suppressed

  const rejected = parseAuthoredModelDocument(missingSuppression)
  expectTrue(!rejected.ok, 'Authored feature records without explicit suppression state should be rejected.')
})
