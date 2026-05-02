import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createModelingServiceEditorEffectRuntime, runEditorEffect } from '@/application/editor/effect-registry'
import { createAppError, err, ok, type AppErrorContextEntry } from '@/contracts/errors'
import type { EditorEffect, EditorEffectRuntime } from '@/core/editor/state-machine'
import { createFeatureEditSession } from '@/domain/editor/feature-editing'
import { hydrateFeatureSessionFromSnapshot } from '@/core/editor/state-machine'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'

test('editor effect runtime covers snapshot, sketch-open, and feature-hydration contracts', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const feature = snapshot.document.features[0]!
  const sketch = snapshot.document.sketches[0]!
  const snapshotEffect: EditorEffect = {
    type: 'document.fetchSnapshot',
    requestId: 'request_editor_snapshot' as EditorEffect['requestId'],
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
    commandSessionId: null,
    preserveRenderRecordsOnFeatureDiagnostics: true,
  }

  const loaded = await runEditorEffect(snapshotEffect, {
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
  } as EditorEffectRuntime)
  expectTrue(loaded.type === 'effect.snapshotLoaded', 'Snapshot fetch effects should resolve through the snapshot-loaded event seam.')
  expectTrue(
    loaded.type === 'effect.snapshotLoaded'
      && loaded.payload.snapshot === snapshot
      && loaded.payload.documentId === snapshot.document.documentId
      && loaded.payload.revisionId === snapshot.document.revisionId
      && loaded.payload.preserveRenderRecordsOnFeatureDiagnostics === true
      && loaded.payload.selectionCatalog.selectableTargetKeys.length > 0,
    'Successful snapshot fetches should hand off the loaded snapshot and derived selection catalog.',
  )

  const failed = await runEditorEffect(snapshotEffect, {
    async getCurrentDocumentSnapshot() {
      throw new Error('Repository offline.')
    },
  } as EditorEffectRuntime)
  expectTrue(failed.type === 'effect.snapshotFailed', 'Snapshot fetch failures should re-enter the state machine as typed failure events.')
  expectTrue(
    failed.type === 'effect.snapshotFailed'
      && failed.requestId === snapshotEffect.requestId
      && failed.documentId === snapshotEffect.documentId
      && failed.error === 'Repository offline.',
    'Snapshot fetch failures should preserve correlation ids and normalized error messages.',
  )

  const openEffect: EditorEffect = {
    type: 'sketch.openSession',
    requestId: 'request_editor_open_sketch' as EditorEffect['requestId'],
    commandSessionId: 'command_open_sketch' as EditorEffect['commandSessionId'],
    selection: [{ kind: 'sketch', sketchId: sketch.sketchId }],
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
  }
  const opened = await runEditorEffect(openEffect, {
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
  } as EditorEffectRuntime)
  expectTrue(opened.type === 'effect.sketchSessionOpened', 'Supported sketch-open selections should create a sketch session event.')
  expectTrue(
    opened.type === 'effect.sketchSessionOpened'
      && opened.session.sketchId === sketch.sketchId,
    'Sketch-open success should return the reopened sketch session.',
  )

  const unsupportedSelection = await runEditorEffect({
    ...openEffect,
    selection: [{ kind: 'body', bodyId: snapshot.document.bodies[0]!.bodyId }],
  }, {
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
  } as EditorEffectRuntime)
  expectTrue(
    unsupportedSelection.type === 'effect.sketchSessionOpenFailed'
      && unsupportedSelection.message.includes('existing sketch, construction plane, or planar face'),
    'Unsupported sketch-open selections should surface the user-facing guidance message.',
  )

  const hydrateEffect: EditorEffect = {
    type: 'feature.hydrateFromSelection',
    requestId: 'request_editor_hydrate_feature' as EditorEffect['requestId'],
    commandSessionId: 'command_hydrate_feature' as EditorEffect['commandSessionId'],
    documentId: snapshot.document.documentId,
    revisionId: snapshot.document.revisionId,
    selectedFeatureId: feature.featureId,
  }
  const hydrated = await runEditorEffect(hydrateEffect, {
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
  } as EditorEffectRuntime)
  expectTrue(hydrated.type === 'effect.featureSessionHydrated', 'Editable features should hydrate into feature sessions.')
  expectTrue(
    hydrated.type === 'effect.featureSessionHydrated'
      && hydrated.session.featureId === feature.featureId,
    'Feature hydration should return the selected feature session.',
  )

  const hydrateMissing = await runEditorEffect({
    ...hydrateEffect,
    selectedFeatureId: 'feature_missing' as typeof feature.featureId,
  }, {
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
  } as EditorEffectRuntime)
  expectTrue(
    hydrateMissing.type === 'effect.featureSessionHydrationFailed'
      && hydrateMissing.message === 'Feature feature_missing cannot be edited in the current feature session flow.',
    'Missing feature hydration should fail with the feature-specific message.',
  )
})

test('editor effect runtime maps preview, commit, and sketch projection outcomes', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const featureSession = hydrateFeatureSessionFromSnapshot(snapshot, snapshot.document.features[0]!.featureId)
  const sketchSession = openSketchSessionFromSelection(
    [{ kind: 'sketch', sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  )

  expectTrue(featureSession, 'Seed snapshot should expose an editable feature for preview and commit coverage.')
  expectTrue(sketchSession, 'Seed snapshot should expose a sketch session for sketch effect coverage.')

  const previewEffect: EditorEffect = {
    type: 'feature.evaluatePreview',
    requestId: 'request_editor_preview' as EditorEffect['requestId'],
    commandSessionId: 'command_preview' as EditorEffect['commandSessionId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    featureSession,
  }
  const preview = await runEditorEffect(previewEffect, {
    async evaluatePreview() {
      return {
        revisionId: 'rev_preview' as typeof snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }
    },
  } as EditorEffectRuntime)
  expectTrue(preview.type === 'effect.featurePreviewCompleted', 'Feature preview should complete through the preview-completed event seam.')
  expectTrue(
    preview.type === 'effect.featurePreviewCompleted'
      && preview.revisionId === 'rev_preview'
      && preview.baseRevisionId === snapshot.document.revisionId
      && preview.stale === false,
    'Feature preview success should preserve the returned preview revision and stale flag.',
  )

  const previewFailure = await runEditorEffect(previewEffect, {
    async evaluatePreview() {
      throw new Error('Preview kernel unavailable.')
    },
  } as EditorEffectRuntime)
  expectTrue(
    previewFailure.type === 'effect.featurePreviewFailed'
      && previewFailure.message === 'Preview kernel unavailable.',
    'Feature preview failures should normalize into preview-failed events.',
  )

  const errorContext: AppErrorContextEntry[] = [{ key: 'revisionState', value: 'conflict' }]
  const commitEffect: EditorEffect = {
    type: 'feature.commit',
    requestId: 'request_editor_commit_feature' as EditorEffect['requestId'],
    commandSessionId: 'command_commit_feature' as EditorEffect['commandSessionId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    mutationBasis: { baseRepositoryHeads: ['head_feature_1'] },
    featureSession,
  }
  const committed = await runEditorEffect(commitEffect, {
    async commitFeature() {
      return {
        revisionId: 'rev_feature_commit' as typeof snapshot.document.revisionId,
        featureId: featureSession.featureId!,
        accepted: false,
        diagnostics: [],
        actualRevisionId: 'rev_feature_actual' as typeof snapshot.document.revisionId,
        errorContext,
      }
    },
  } as EditorEffectRuntime)
  expectTrue(committed.type === 'effect.featureCommitted', 'Feature commit should complete through the feature-committed event seam.')
  expectTrue(
    committed.type === 'effect.featureCommitted'
      && committed.accepted === false
      && committed.actualRevisionId === 'rev_feature_actual'
      && committed.errorContext === errorContext,
    'Feature commit should preserve accepted/conflict metadata from the runtime.',
  )

  const sketchCommitEffect: EditorEffect = {
    type: 'sketch.commit',
    requestId: 'request_editor_commit_sketch' as EditorEffect['requestId'],
    commandSessionId: 'command_commit_sketch' as EditorEffect['commandSessionId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    mutationBasis: { baseRepositoryHeads: ['head_sketch_1'] },
    session: sketchSession,
  }
  const noopSketchCommit = await runEditorEffect(sketchCommitEffect, {
    async commitSketch() {
      return null
    },
  } as EditorEffectRuntime)
  expectTrue(noopSketchCommit.type === 'effect.sketchCommitted', 'Sketch commit should still complete when the runtime reports no mutation.')
  expectTrue(
    noopSketchCommit.type === 'effect.sketchCommitted'
      && noopSketchCommit.revisionId === snapshot.document.revisionId
      && noopSketchCommit.accepted === true
      && noopSketchCommit.diagnostics.length === 0,
    'No-op sketch commits should map to an accepted event pinned to the base revision.',
  )

  const projected = await runEditorEffect({
    type: 'sketch.projectReferences',
    requestId: 'request_editor_project_refs' as EditorEffect['requestId'],
    commandSessionId: 'command_project_refs' as EditorEffect['commandSessionId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    session: sketchSession,
  }, {
    async projectSketchReferences() {
      return {
        projectedReferences: [],
        diagnostics: [],
      }
    },
  } as EditorEffectRuntime)
  expectTrue(projected.type === 'effect.sketchReferencesProjected', 'Sketch reference projection should complete through the projected event seam.')
  expectTrue(
    projected.type === 'effect.sketchReferencesProjected'
      && projected.projectedReferences.length === 0
      && projected.baseRevisionId === snapshot.document.revisionId,
    'Projected reference results should preserve the returned references and base revision.',
  )
})

test('editor effect runtime covers reference-image import, special modes, and history cursor movement', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchSession = openSketchSessionFromSelection(
    [{ kind: 'sketch', sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  )

  expectTrue(sketchSession, 'Seed snapshot should expose a sketch session for import and cursor coverage.')

  const importEffect: EditorEffect = {
    type: 'sketch.importReferenceImages',
    requestId: 'request_editor_import_images' as EditorEffect['requestId'],
    commandSessionId: 'command_import_images' as EditorEffect['commandSessionId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    mutationBasis: { baseRepositoryHeads: ['head_import_1'] },
    session: sketchSession,
    payloads: [],
  }

  const missingImportRuntime = await runEditorEffect(importEffect, {} as EditorEffectRuntime)
  expectTrue(
    missingImportRuntime.type === 'effect.sketchReferenceImageImportFailed'
      && missingImportRuntime.message === 'Sketch reference-image import runtime is not available.',
    'Reference-image import should fail explicitly when the runtime capability is unavailable.',
  )

  const imported = await runEditorEffect(importEffect, {
    async importSketchReferenceImages() {
      return {
        status: 'committed',
        revisionId: 'rev_imported_images' as typeof snapshot.document.revisionId,
        snapshot,
        selectionCatalog: {
          selectableTargetKeys: [],
          existingSketchKeys: [],
          constructionPlaneKeys: [],
          planarFaceKeys: [],
        },
        session: sketchSession,
        importedCount: 2,
      }
    },
  } as EditorEffectRuntime)
  expectTrue(imported.type === 'effect.sketchReferenceImageImportCompleted', 'Reference-image import should complete through the import-completed event seam.')
  expectTrue(
    imported.type === 'effect.sketchReferenceImageImportCompleted'
      && imported.status === 'committed'
      && imported.importedCount === 2
      && imported.snapshot === snapshot,
    'Reference-image import success should preserve the imported count and refreshed snapshot payload.',
  )

  const specialModeEffect: EditorEffect = {
    type: 'sketch.specialModeEffect',
    requestId: 'request_editor_special_mode' as EditorEffect['requestId'],
    commandSessionId: 'command_special_mode' as EditorEffect['commandSessionId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    modeId: 'reference-image-calibration' as EditorEffect['type'] extends never ? never : never,
    effectId: 'effect_calibrate',
    kind: 'measure',
    payload: { targetId: 'image_1' },
  }
  const specialMode = await runEditorEffect(specialModeEffect, {
    async runSketchSpecialModeEffect(input) {
      return {
        effectId: input.effectId,
        payload: { measuredLength: 42 },
      }
    },
  } as EditorEffectRuntime)
  expectTrue(specialMode.type === 'effect.sketchSpecialModeEffectCompleted', 'Special sketch mode effects should map to completed events.')
  expectTrue(
    specialMode.type === 'effect.sketchSpecialModeEffectCompleted'
      && specialMode.payload.measuredLength === 42,
    'Special sketch mode success should preserve the returned payload.',
  )

  const cursorEffect: EditorEffect = {
    type: 'document.moveHistoryCursor',
    requestId: 'request_editor_cursor' as EditorEffect['requestId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    mutationBasis: { baseRepositoryHeads: ['head_cursor_1'] },
    cursor: snapshot.document.cursor,
    transient: true,
  }
  const moved = await runEditorEffect(cursorEffect, {
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
    async setDocumentCursor() {
      return {
        revisionId: 'rev_cursor_moved' as typeof snapshot.document.revisionId,
        accepted: true,
        diagnostics: [],
      }
    },
  } as EditorEffectRuntime)
  expectTrue(moved.type === 'effect.documentCursorMoved', 'History cursor moves should complete through the cursor-moved event seam.')
  expectTrue(
    moved.type === 'effect.documentCursorMoved'
      && moved.accepted === true
      && moved.snapshot === snapshot,
    'Accepted history cursor moves should refresh and include the next snapshot.',
  )

  const rejectedMove = await runEditorEffect(cursorEffect, {
    async setDocumentCursor() {
      return {
        revisionId: 'rev_cursor_conflict' as typeof snapshot.document.revisionId,
        accepted: false,
        diagnostics: [],
        actualRevisionId: 'rev_cursor_actual' as typeof snapshot.document.revisionId,
      }
    },
  } as EditorEffectRuntime)
  expectTrue(
    rejectedMove.type === 'effect.documentCursorMoved'
      && rejectedMove.accepted === false
      && rejectedMove.snapshot === undefined
      && rejectedMove.actualRevisionId === 'rev_cursor_actual',
    'Rejected history cursor moves should preserve conflict metadata without fetching a refreshed snapshot.',
  )
})

test('modeling-service effect runtime adapts sketch, feature, projection, and cursor contracts', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const hydratedFeatureSession = hydrateFeatureSessionFromSnapshot(snapshot, snapshot.document.features[0]!.featureId)
  const planeCreateSession = createFeatureEditSession({
    featureType: 'plane',
    selectedTarget: { kind: 'construction', constructionId: snapshot.document.constructions[0]!.constructionId },
  })
  const incompleteFeatureSession = createFeatureEditSession({ featureType: 'extrude' })
  const sketchSession = openSketchSessionFromSelection(
    [{ kind: 'sketch', sketchId: snapshot.document.sketches[0]!.sketchId }],
    snapshot,
  )

  expectTrue(hydratedFeatureSession, 'Seed snapshot should expose an editable feature for runtime adapter coverage.')
  expectTrue(sketchSession, 'Seed snapshot should expose a sketch session for runtime adapter coverage.')

  const commitCalls: Array<{ sketchLabel: string; sketchId: string | null; planeKind: string; baseRepositoryHeads?: readonly string[] }> = []
  const createFeatureCalls: Array<{ definitionKind: string; baseRepositoryHeads?: readonly string[] }> = []
  const updateFeatureCalls: Array<{ featureId: string; definitionKind: string }> = []
  const cursorCalls: Array<{ persistHistory: boolean | undefined }> = []
  const projectionCalls: Array<{ sketchId: string; referenceCount: number }> = []
  const runtime = createModelingServiceEditorEffectRuntime({
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
    async commitSketch(input) {
      commitCalls.push({
        sketchLabel: input.sketchLabel,
        sketchId: input.sketchId,
        planeKind: input.plane.support.kind,
        baseRepositoryHeads: input.baseRepositoryHeads,
      })
      return ok({
        revisionId: 'rev_runtime_sketch' as typeof snapshot.document.revisionId,
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
    async projectSketchExternalReferences(input) {
      projectionCalls.push({ sketchId: input.sketchId, referenceCount: input.references.length })
      return {
        projectedReferences: [],
        diagnostics: [],
      }
    },
    sketchSolver: null,
    async evaluatePreview(input) {
      return {
        revisionId: `${input.previewId}_rev` as typeof snapshot.document.revisionId,
        stale: true,
        diagnostics: [],
        renderables: [],
      }
    },
    async createFeature(input) {
      createFeatureCalls.push({
        definitionKind: input.definition.kind,
        baseRepositoryHeads: input.baseRepositoryHeads,
      })
      return ok({
        revisionId: 'rev_feature_created' as typeof snapshot.document.revisionId,
        featureId: 'feature_plane_created' as typeof snapshot.document.features[number]['featureId'],
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
    async updateFeature(input) {
      updateFeatureCalls.push({
        featureId: input.featureId,
        definitionKind: input.definition.kind,
      })
      return ok({
        revisionId: 'rev_feature_updated' as typeof snapshot.document.revisionId,
        featureId: input.featureId,
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
    async setFeatureCursor(input) {
      cursorCalls.push({ persistHistory: input.persistHistory })
      return ok({
        revisionId: 'rev_cursor_runtime' as typeof snapshot.document.revisionId,
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
  })

  const committedSketch = await runtime.commitSketch({
    requestId: 'request_runtime_sketch' as EditorEffect['requestId'],
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ['head_runtime_sketch'],
    session: sketchSession,
  })
  expectTrue(
    committedSketch?.accepted === true
      && committedSketch.revisionId === 'rev_runtime_sketch'
      && commitCalls[0]?.sketchId === sketchSession.sketchId
      && commitCalls[0]?.sketchLabel === sketchSession.sketchLabel
      && commitCalls[0]?.planeKind === 'construction'
      && commitCalls[0]?.baseRepositoryHeads?.[0] === 'head_runtime_sketch',
    'Sketch commit runtime adaptation should forward commit defaults and accepted results.',
  )

  const noReferenceProjection = await runtime.projectSketchReferences({
    requestId: 'request_runtime_projection_empty' as EditorEffect['requestId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    session: {
      ...sketchSession,
      definition: {
        ...sketchSession.definition,
        referenceIds: [],
        references: [],
      },
    },
  })
  expectTrue(
    noReferenceProjection.projectedReferences.length === 0 && projectionCalls.length === 0,
    'Sketch projection should short-circuit when the sketch has no external references.',
  )

  const projected = await runtime.projectSketchReferences({
    requestId: 'request_runtime_projection' as EditorEffect['requestId'],
    documentId: snapshot.document.documentId,
    baseRevisionId: snapshot.document.revisionId,
    session: sketchSession,
  })
  expectTrue(
    projected.projectedReferences.length === 0
      && projectionCalls[0]?.sketchId === sketchSession.sketchId
      && projectionCalls[0]?.referenceCount === sketchSession.definition.references.length,
    'Sketch projection should forward authored references and sketch identity to the modeling service.',
  )

  const preview = await runtime.evaluatePreview({
    baseRevisionId: snapshot.document.revisionId,
    featureSession: hydratedFeatureSession,
  })
  expectTrue(
    preview.revisionId === `${hydratedFeatureSession.previewId}_rev` && preview.stale === true,
    'Preview adaptation should forward the built definition and map the preview payload.',
  )

  const createdFeature = await runtime.commitFeature({
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ['head_feature_create'],
    featureSession: planeCreateSession,
  })
  const updatedFeature = await runtime.commitFeature({
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ['head_feature_edit'],
    featureSession: hydratedFeatureSession,
  })
  expectTrue(
    createdFeature.accepted === true
      && createdFeature.featureId === 'feature_plane_created'
      && createFeatureCalls[0]?.definitionKind === 'plane'
      && createFeatureCalls[0]?.baseRepositoryHeads?.[0] === 'head_feature_create',
    'Create-mode feature commits should route through createFeature with the built definition.',
  )
  expectTrue(
    updatedFeature.accepted === true
      && updatedFeature.featureId === hydratedFeatureSession.featureId
      && updateFeatureCalls[0]?.featureId === hydratedFeatureSession.featureId
      && updateFeatureCalls[0]?.definitionKind === hydratedFeatureSession.featureType,
    'Edit-mode feature commits should route through updateFeature with the hydrated feature id and definition.',
  )

  const movedCursor = await runtime.setDocumentCursor({
    baseRevisionId: snapshot.document.revisionId,
    baseRepositoryHeads: ['head_cursor_runtime'],
    cursor: snapshot.document.cursor,
    transient: true,
  })
  expectTrue(
    movedCursor.accepted === true
      && movedCursor.revisionId === 'rev_cursor_runtime'
      && cursorCalls[0]?.persistHistory === false,
    'Transient cursor moves should disable persisted history while preserving accepted cursor results.',
  )

  let specialModeMessage: string | null = null
  try {
    await runtime.runSketchSpecialModeEffect?.({
      requestId: 'request_runtime_special_mode' as EditorEffect['requestId'],
      documentId: snapshot.document.documentId,
      commandSessionId: 'command_runtime_special_mode' as EditorEffect['commandSessionId'],
      baseRevisionId: snapshot.document.revisionId,
      modeId: 'reference-image-calibration' as never,
      effectId: 'effect_runtime_special_mode',
      kind: 'measure',
      payload: {},
    })
  } catch (error: unknown) {
    specialModeMessage = error instanceof Error ? error.message : String(error)
  }
  expectTrue(
    specialModeMessage === 'No sketch special mode runtime has been registered.',
    'Runtime adapter should surface the default special-mode registration error.',
  )

  const errorRuntime = createModelingServiceEditorEffectRuntime({
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
    async commitSketch() {
      return ok({
        revisionId: snapshot.document.revisionId,
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
    async projectSketchExternalReferences() {
      return {
        projectedReferences: [],
        diagnostics: [],
      }
    },
    sketchSolver: null,
    async evaluatePreview() {
      return {
        revisionId: snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }
    },
    async createFeature() {
      return ok({
        revisionId: snapshot.document.revisionId,
        featureId: 'feature_create_ok' as typeof snapshot.document.features[number]['featureId'],
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
    async updateFeature() {
      return ok({
        revisionId: snapshot.document.revisionId,
        featureId: hydratedFeatureSession.featureId!,
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
    async setFeatureCursor() {
      return ok({
        revisionId: snapshot.document.revisionId,
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
  })

  let incompletePreviewMessage: string | null = null
  try {
    await errorRuntime.evaluatePreview({
      baseRevisionId: snapshot.document.revisionId,
      featureSession: incompleteFeatureSession,
    })
  } catch (error: unknown) {
    incompletePreviewMessage = error instanceof Error ? error.message : String(error)
  }
  expectTrue(
    incompletePreviewMessage === 'Feature preview failed because the draft is incomplete.',
    'Preview adaptation should reject incomplete drafts before reaching the modeling service.',
  )

  let incompleteCommitMessage: string | null = null
  try {
    await errorRuntime.commitFeature({
      baseRevisionId: snapshot.document.revisionId,
      featureSession: incompleteFeatureSession,
    })
  } catch (error: unknown) {
    incompleteCommitMessage = error instanceof Error ? error.message : String(error)
  }
  expectTrue(
    incompleteCommitMessage === 'Feature commit failed because the draft is incomplete.',
    'Feature commit adaptation should reject incomplete drafts before reaching the modeling service.',
  )

  const rejectedRuntime = createModelingServiceEditorEffectRuntime({
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
    async commitSketch() {
      return err(createAppError({
        code: 'modeling/revision-rejected',
        message: 'conflict',
        context: [{ key: 'actualRevisionId', value: 'rev_sketch_actual' }],
      }))
    },
    async projectSketchExternalReferences() {
      return {
        projectedReferences: [],
        diagnostics: [],
      }
    },
    sketchSolver: null,
    async evaluatePreview() {
      return {
        revisionId: snapshot.document.revisionId,
        stale: false,
        diagnostics: [],
        renderables: [],
      }
    },
    async createFeature() {
      return ok({
        revisionId: snapshot.document.revisionId,
        featureId: 'feature_create_ok' as typeof snapshot.document.features[number]['featureId'],
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      })
    },
    async updateFeature() {
      return err(createAppError({
        code: 'modeling/diagnostic',
        message: 'Feature conflict.',
        context: [{ key: 'actualRevisionId', value: 'rev_feature_actual' }],
      }))
    },
    async setFeatureCursor() {
      return err(createAppError({
        code: 'modeling/revision-rejected',
        message: 'Cursor conflict.',
        context: [{ key: 'actualRevisionId', value: 'rev_cursor_actual' }],
      }))
    },
  } as never)

  const rejectedFeature = await rejectedRuntime.commitFeature({
    baseRevisionId: snapshot.document.revisionId,
    featureSession: hydratedFeatureSession,
  })
  const rejectedCursor = await rejectedRuntime.setDocumentCursor({
    baseRevisionId: snapshot.document.revisionId,
    cursor: snapshot.document.cursor,
  })
  expectTrue(
    rejectedFeature.accepted === false
      && rejectedFeature.actualRevisionId === 'rev_feature_actual'
      && rejectedFeature.diagnostics[0]?.message === 'Feature conflict.',
    'Feature commit adapter should map modeling mutation errors into rejected feature results.',
  )
  expectTrue(
    rejectedCursor.accepted === false
      && rejectedCursor.actualRevisionId === 'rev_cursor_actual'
      && rejectedCursor.diagnostics[0]?.message === 'Cursor conflict.',
    'Cursor adapter should map modeling mutation errors into rejected cursor results.',
  )
})
