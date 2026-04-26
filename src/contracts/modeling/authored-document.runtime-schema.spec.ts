import { test } from 'bun:test'

import {
  createAuthoredModelDocumentFromSnapshot,
} from '@/contracts/modeling/authored-document'
import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/contracts/modeling/authored-document.runtime-schema.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const adapter = new MockKernelAdapter()
  const snapshot = (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId: 'doc_workspace',
  })).snapshot

  const authoredDocument = createAuthoredModelDocumentFromSnapshot(snapshot)
  const parsed = parseAuthoredModelDocument(authoredDocument)
  assert(parsed.ok, 'Authored documents derived from snapshots should validate.')
  assert(parsed.ok && parsed.document.assets.records.length === 0, 'Authored documents should default to an empty geometry asset manifest.')
  assert(parsed.ok && parsed.document.embeddedBinaryAssets.length === 0, 'Authored documents should default to an empty embedded binary asset list.')
})
