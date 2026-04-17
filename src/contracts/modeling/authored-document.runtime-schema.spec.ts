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

  assert(authoredDocument.sketches.length > 0, 'Authored document should include sketch rebuild inputs.')
  assert(authoredDocument.features.length > 0, 'Authored document should include feature rebuild inputs.')
  assert(authoredDocument.featureOrder.length === authoredDocument.features.length, 'Authored document should include feature order.')
  assert(authoredDocument.variables.length === snapshot.document.variables.length, 'Authored document should include variables.')
  const authoredSketch = authoredDocument.sketches[0]
  assert(authoredSketch, 'Authored document should include an authored sketch record.')
  assert('definition' in authoredSketch, 'Authored sketches should include the user-authored sketch definition.')
  assert(!('sketch' in authoredSketch), 'Authored sketches should not persist full sketch records.')
  assert(!('solvedSnapshot' in authoredSketch), 'Authored sketches should exclude solved sketch output.')
  assert(!('regions' in authoredSketch), 'Authored sketches should exclude derived sketch regions.')
  assert(!('render' in authoredDocument), 'Authored document should exclude render exports.')
  assert(!('presentation' in authoredDocument), 'Authored document should exclude workspace presentation.')
  assert(!('diagnostics' in authoredDocument), 'Authored document should exclude diagnostics.')
  assert(!('preview' in authoredDocument), 'Authored document should exclude preview state.')
  assert(!('runtimeState' in authoredDocument), 'Authored document should exclude runtime state.')

  const withDerivedField = {
    ...authoredDocument,
    render: snapshot.document.render,
  }
  const rejected = parseAuthoredModelDocument(withDerivedField)
  assert(!rejected.ok, 'Authored document validation should reject derived render fields.')
  assert(rejected.diagnostic.reasonCode === 'derived-field-leak', 'Derived field rejection should report an explicit diagnostic.')

  const rejectedSketchRecord = parseAuthoredModelDocument({
    ...authoredDocument,
    sketches: [
      {
        ...authoredSketch,
        sketch: snapshot.document.sketches[0]?.sketch,
      },
      ...authoredDocument.sketches.slice(1),
    ],
  })
  assert(!rejectedSketchRecord.ok, 'Authored document validation should reject persisted full sketch records.')
  assert(rejectedSketchRecord.diagnostic.reasonCode === 'derived-field-leak', 'Full sketch record rejection should report derived leakage.')

  const unsupported = parseAuthoredModelDocument({
    ...authoredDocument,
    schemaVersion: 'authored-model-document/v9',
  })
  assert(!unsupported.ok, 'Unsupported authored schema versions should be rejected.')
  assert(
    unsupported.diagnostic.reasonCode === 'unsupported-schema-version',
    'Unsupported authored schema versions should report an explicit migration diagnostic.',
  )
})
