import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'

import {
  buildSketchPlaneCommitRequest,
  canReassignCommittedSketchPlane,
  getSketchPlaneEditFormSchema,
  hasSketchPlaneEditChanges,
  hydrateSketchPlaneEditSession,
  patchSketchPlaneEditSession,
} from './sketch-plane-editing'

test('sketch-plane-editing.ts hydrates ordered origin-plane options and builds the form schema', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const session = hydrateSketchPlaneEditSession(snapshot, sketchId)

  expectTrue(session, 'Seed snapshot should expose a committed origin-backed sketch plane edit session.')
  expectTrue(
    session?.currentPlaneKey === 'xy'
      && session.options.map((option) => option.key).join('|') === 'xy|yz|xz'
      && session.options.map((option) => option.label).join('|') === 'Top Plane|Right Plane|Front Plane',
    'Sketch-plane editing should resolve the supported origin planes in the stable XY/YZ/XZ order.',
  )

  const schema = session ? getSketchPlaneEditFormSchema(session) : null
  const planeField = schema?.sections[0]?.fields[0]

  expectTrue(
    planeField?.kind === 'enum'
      && planeField.label === 'Origin plane'
      && planeField.options.map((option) => option.value).join('|') === 'xy|yz|xz',
    'Sketch-plane editing should expose the origin-plane selector through the shared enum form schema.',
  )
})

test('sketch-plane-editing.ts applies supported plane patches and builds recommit payloads from the selected origin plane', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const session = hydrateSketchPlaneEditSession(snapshot, sketchId)

  expectTrue(session, 'Seed snapshot should expose a sketch-plane edit session for patch coverage.')

  const patched = session
    ? patchSketchPlaneEditSession(session, { selectedPlaneKey: 'yz' })
    : null
  const ignored = patched
    ? patchSketchPlaneEditSession(patched, { selectedPlaneKey: 'unsupported' })
    : null
  const request = patched ? buildSketchPlaneCommitRequest(patched) : null

  expectTrue(
    patched?.draft.selectedPlaneKey === 'yz'
      && hasSketchPlaneEditChanges(patched)
      && ignored?.draft.selectedPlaneKey === 'yz',
    'Sketch-plane editing should accept supported origin-plane patches and ignore unsupported patch values.',
  )
  expectTrue(
    request?.plane.support.kind === 'construction'
      && request.plane.support.constructionId === 'construction_plane-yz'
      && request.sketchId === sketchId,
    'Sketch-plane recommits should preserve the authored sketch identity while swapping only the selected origin plane.',
  )
})

test('sketch-plane-editing.ts omits the flow when a committed sketch no longer has multiple supported origin planes', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const singlePlaneSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      constructions: [snapshot.document.constructions[0]!],
    },
  }

  expectTrue(
    canReassignCommittedSketchPlane(snapshot, sketchId)
      && hydrateSketchPlaneEditSession(singlePlaneSnapshot, sketchId) === null
      && !canReassignCommittedSketchPlane(singlePlaneSnapshot, sketchId),
    'Sketch-plane editing should stay unavailable when the snapshot cannot offer a safe origin-plane alternative.',
  )
})
