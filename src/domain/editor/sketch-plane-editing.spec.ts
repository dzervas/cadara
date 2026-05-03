import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

import {
  applySelectionToSketchPlaneEditSession,
  buildSketchPlaneCommitRequest,
  canReassignCommittedSketchPlane,
  getSketchPlaneEditFormSchema,
  hasSketchPlaneEditChanges,
  hydrateSketchPlaneEditSession,
  patchSketchPlaneEditSession,
} from './sketch-plane-editing'

test('sketch-plane-editing.ts hydrates the current support target and exposes a shared reference-picker field', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const session = hydrateSketchPlaneEditSession(snapshot, sketchId)

  expectTrue(session, 'Seed snapshot should expose a committed sketch plane edit session.')
  expectTrue(
    session?.currentPlaneTarget.kind === 'construction'
      && session.currentPlaneTarget.constructionId === 'construction_plane-xy'
      && session.draft.selectedPlaneTarget?.kind === 'construction'
      && session.draft.selectedPlaneTarget.constructionId === 'construction_plane-xy',
    'Sketch-plane editing should hydrate the committed support target as the initial picker selection.',
  )

  const schema = session ? getSketchPlaneEditFormSchema(session) : null
  const planeField = schema?.sections[0]?.fields[0]

  expectTrue(
    planeField?.kind === 'referencePicker'
      && planeField.label === 'Support plane'
      && planeField.patch.patchKey === 'selectedPlaneTarget'
      && planeField.picker.selectionFilter.kind === 'planeReferences',
    'Sketch-plane editing should expose the plane reassignment field through the shared reference-picker schema.',
  )
})

test('sketch-plane-editing.ts applies construction-plane picks and builds recommit payloads from the selected support', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const session = hydrateSketchPlaneEditSession(snapshot, sketchId)

  expectTrue(session, 'Seed snapshot should expose a sketch-plane edit session for patch coverage.')

  const patched = session
    ? applySelectionToSketchPlaneEditSession(session, { kind: 'construction', constructionId: 'construction_plane-yz' }, snapshot)
    : null
  const ignored = patched
    ? patchSketchPlaneEditSession(patched, { selectedPlaneTarget: 'unsupported' })
    : null
  const request = patched ? buildSketchPlaneCommitRequest(patched) : null

  expectTrue(
    patched?.draft.selectedPlaneTarget?.kind === 'construction'
      && patched.draft.selectedPlaneTarget.constructionId === 'construction_plane-yz'
      && hasSketchPlaneEditChanges(patched)
      && ignored?.draft.selectedPlaneTarget?.kind === 'construction'
      && ignored.draft.selectedPlaneTarget.constructionId === 'construction_plane-yz',
    'Sketch-plane editing should accept valid picked supports and ignore malformed direct patches.',
  )
  expectTrue(
    request?.plane.support.kind === 'construction'
      && request.plane.support.constructionId === 'construction_plane-yz'
      && request.sketchId === sketchId,
    'Sketch-plane recommits should preserve the authored sketch identity while swapping only the selected support plane.',
  )
})

test('sketch-plane-editing.ts resolves planar face picks into face-backed sketch planes', async () => {
  const adapter = new MockKernelAdapter()
  const { snapshot } = await adapter.getDocumentSnapshot({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
  })
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const session = hydrateSketchPlaneEditSession(snapshot, sketchId)
  const faceTarget = snapshot.presentation.entities.find(
    (entity) => entity.target.kind === 'face' && entity.selectionSemantics.includes('planarFace'),
  )?.target

  expectTrue(session && faceTarget?.kind === 'face', 'Planar face coverage needs a committed sketch session and a planar face target.')

  const patched = session && faceTarget?.kind === 'face'
    ? applySelectionToSketchPlaneEditSession(session, faceTarget, snapshot)
    : null
  const request = patched ? buildSketchPlaneCommitRequest(patched) : null

  expectTrue(
    patched?.draft.selectedPlaneTarget?.kind === 'face'
      && patched.draft.selectedPlane?.support.kind === 'face',
    'Sketch-plane editing should resolve planar face picks into a face-backed sketch plane draft.',
  )
  expectTrue(
    request?.plane.support.kind === 'face',
    'Face-backed plane picks should recommit through the same sketch-plane request seam.',
  )
})

test('sketch-plane-editing.ts omits the flow when a committed sketch no longer has a supported support target', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const unsupportedSupportSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      sketches: snapshot.document.sketches.map((entry, index) => index === 0
        ? {
            ...entry,
            plane: {
              ...entry.plane,
              support: { kind: 'body' as const, bodyId: 'body_unsupported' },
            },
          }
        : entry),
    },
  }

  expectTrue(
    canReassignCommittedSketchPlane(snapshot, sketchId)
      && hydrateSketchPlaneEditSession(unsupportedSupportSnapshot, sketchId) === null
      && !canReassignCommittedSketchPlane(unsupportedSupportSnapshot, sketchId),
    'Sketch-plane editing should stay unavailable when the committed sketch no longer has a supported construction or planar-face support.',
  )
})
