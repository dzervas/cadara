import { test } from 'bun:test'

import {
  createAuthoredModelDocumentFromSnapshot,
} from '@/contracts/modeling/authored-document'
import { parseAuthoredModelDocument } from '@/contracts/modeling/authored-document.runtime-schema'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import type { BodyId } from '@/contracts/shared/ids'
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

  authoredSketch.definition.styleIds = ['sketch_style_seed']
  authoredSketch.definition.styles = [
    {
      styleId: 'sketch_style_seed',
      label: 'Seed style',
      target: { kind: 'entity', entityId: authoredSketch.definition.entityIds[0]! },
      fill: {
        kind: 'solid',
        color: '#60a5fa',
        opacity: 0.4,
      },
      stroke: {
        color: '#dbeafe',
        opacity: 1,
        width: 1.25,
        lineCap: 'round',
        lineJoin: 'round',
        miterLimit: 4,
      },
    },
  ]
  const withStyles = parseAuthoredModelDocument(authoredDocument)
  assert(withStyles.ok, 'Authored documents should persist sketch style records.')
  assert(withStyles.document.sketches[0]?.definition.styles?.length === 1, 'Parsed authored documents should preserve style records.')

  authoredSketch.definition.derivedRelationships = [{
    derivationId: 'sketch_derivation_seed_linear',
    label: 'Seed linear pattern',
    kind: 'linearPattern',
    seedEntityIds: [authoredSketch.definition.entityIds[0]!],
    vector: [2, 0],
    instanceCount: 2,
    outputs: [{
      seedEntityId: authoredSketch.definition.entityIds[0]!,
      outputEntityId: authoredSketch.definition.entityIds[0]!,
      instanceIndex: 1,
      seedPointIds: authoredSketch.definition.pointIds.slice(0, 1),
      outputPointIds: authoredSketch.definition.pointIds.slice(0, 1),
    }],
  }]
  const withDerivedRelationships = parseAuthoredModelDocument(authoredDocument)
  assert(withDerivedRelationships.ok, 'Authored documents should persist sketch derived relationship records.')
  assert(
    withDerivedRelationships.document.sketches[0]?.definition.derivedRelationships?.[0]?.kind === 'linearPattern',
    'Parsed authored documents should preserve derived sketch relationship records.',
  )

  const extrudeFeature = authoredDocument.features.find((feature) => feature.definition.kind === 'extrude')
  assert(extrudeFeature?.definition.kind === 'extrude', 'Seed document should include an extrude for repairable reference validation.')
  const repairableBrokenDocument = parseAuthoredModelDocument({
    ...authoredDocument,
    features: authoredDocument.features.map((feature) =>
      feature.featureId === extrudeFeature.featureId && feature.definition.kind === 'extrude'
        ? {
            ...feature,
            definition: {
              ...feature.definition,
              parameters: {
                ...feature.definition.parameters,
                operation: 'join',
                booleanScope: { kind: 'targetBody', bodyId: 'body_missing_for_repair' as BodyId },
              },
            },
          }
        : feature,
    ),
  })
  assert(repairableBrokenDocument.ok, 'Authored validation should accept structurally valid features with repairable broken references.')
  assert(
    repairableBrokenDocument.ok
      && repairableBrokenDocument.document.features.some((feature) => feature.featureId === extrudeFeature.featureId),
    'Repairable broken features should remain in authored history for editing.',
  )

  const withoutStylesField = parseAuthoredModelDocument({
    ...authoredDocument,
    sketches: authoredDocument.sketches.map((sketch) => ({
      ...sketch,
      definition: {
        ...sketch.definition,
        styleIds: undefined,
        styles: undefined,
      },
    })),
  })
  assert(withoutStylesField.ok, 'Authored document migration should accept older sketches without style fields.')
  assert(
    withoutStylesField.document.sketches.every((sketch) => sketch.definition.styleIds?.length === 0),
    'Older sketches should migrate with an empty styleIds list.',
  )
  assert(
    withoutStylesField.document.sketches.every((sketch) => sketch.definition.styles?.length === 0),
    'Older sketches should migrate with an empty styles list.',
  )

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
