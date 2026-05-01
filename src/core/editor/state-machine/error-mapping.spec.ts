import { test } from 'bun:test'

import { createAppError } from '@/contracts/errors'
import { createNewSketchSessionFromSupport } from '@/domain/editor/sketch-session'
import { createFeatureEditSession } from '@/domain/editor/feature-editing'
import type { EditorEffect, EditorEvent } from './types'
import {
  createEditorEffectFailureEvent,
  getAppErrorDiagnosticCode,
  getAppErrorRevisionId,
  getDurableDiagnosticTarget,
  getEditorEffectContext,
  isModelingMutationError,
  modelingMutationErrorToDiagnostic,
} from './error-mapping'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function makeFeatureSession() {
  return createFeatureEditSession({
    featureType: 'extrude',
    featureId: 'feature_fixture' as const,
  })
}

function makeSketchSession() {
  return createNewSketchSessionFromSupport({
    kind: 'construction',
    constructionId: 'construction_plane-xy',
  })
}

test('error-mapping.ts extracts effect context for feature, sketch, and special-mode effects', () => {
  const featureSession = makeFeatureSession()
  const sketchSession = makeSketchSession()

  const featureContext = getEditorEffectContext({
    type: 'feature.commit',
    requestId: 'request_feature-commit-1',
    commandSessionId: 'command_feature-1',
    documentId: 'doc_fixture',
    baseRevisionId: 'rev_fixture',
    mutationBasis: { baseRevisionId: 'rev_fixture', baseRepositoryHeads: ['head_1'] },
    featureSession,
  } satisfies EditorEffect)
  const sketchContext = getEditorEffectContext({
    type: 'sketch.importReferenceImages',
    requestId: 'request_sketch-import-1',
    commandSessionId: 'command_sketch-1',
    documentId: 'doc_fixture',
    baseRevisionId: 'rev_fixture',
    mutationBasis: { baseRevisionId: 'rev_fixture' },
    session: sketchSession,
    payloads: [],
  } satisfies EditorEffect)
  const specialModeContext = getEditorEffectContext({
    type: 'sketch.specialModeEffect',
    requestId: 'request_special-mode-1',
    commandSessionId: 'command_sketch-1',
    documentId: 'doc_fixture',
    baseRevisionId: 'rev_fixture',
    modeId: 'fixture.mode',
    effectId: 'replace-image',
    kind: 'reference-image-replace-image',
    payload: {},
  } satisfies EditorEffect)

  assert(
    featureContext.some((entry) => entry.key === 'previewId' && entry.value === featureSession.previewId)
      && featureContext.some((entry) => entry.key === 'featureId' && entry.value === featureSession.featureId)
      && featureContext.some((entry) => entry.key === 'baseRevisionId' && entry.value === 'rev_fixture'),
    'Feature effect context should include the preview, feature, and revision correlation fields needed for error reporting.',
  )
  assert(
    sketchContext.some((entry) => entry.key === 'sketchId' && entry.value === sketchSession.sketchId),
    'Sketch effect context should include the active sketch id when the effect is sketch-scoped.',
  )
  assert(
    specialModeContext.some((entry) => entry.key === 'modeId' && entry.value === 'fixture.mode')
      && specialModeContext.some((entry) => entry.key === 'effectId' && entry.value === 'replace-image')
      && specialModeContext.some((entry) => entry.key === 'effectKind' && entry.value === 'reference-image-replace-image'),
    'Sketch special-mode errors should preserve the mode and effect identity in their context.',
  )
})

test('error-mapping.ts maps each editor effect type to its typed failure event seam', () => {
  const featureSession = makeFeatureSession()
  const sketchSession = makeSketchSession()
  const failureCases: Array<{
    effect: EditorEffect
    expectedType: EditorEvent['type']
    assertResult: (event: EditorEvent) => void
  }> = [
    {
      effect: {
        type: 'document.fetchSnapshot',
        requestId: 'request_snapshot-1',
        documentId: 'doc_fixture',
        revisionId: 'rev_fixture',
        commandSessionId: null,
      },
      expectedType: 'effect.snapshotFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.snapshotFailed' && event.revisionId === 'rev_fixture',
          'Snapshot failures should preserve the document revision context.',
        )
      },
    },
    {
      effect: {
        type: 'sketch.openSession',
        requestId: 'request_sketch-open-1',
        commandSessionId: 'command_sketch-1',
        selection: [{ kind: 'construction', constructionId: 'construction_plane-xy' }],
        documentId: 'doc_fixture',
        revisionId: 'rev_fixture',
      },
      expectedType: 'effect.sketchSessionOpenFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.sketchSessionOpenFailed' && event.commandSessionId === 'command_sketch-1',
          'Sketch-open failures should preserve the command session correlation.',
        )
      },
    },
    {
      effect: {
        type: 'feature.hydrateFromSelection',
        requestId: 'request_feature-hydrate-1',
        commandSessionId: 'command_feature-1',
        documentId: 'doc_fixture',
        revisionId: 'rev_fixture',
        selectedFeatureId: 'feature_fixture',
      },
      expectedType: 'effect.featureSessionHydrationFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.featureSessionHydrationFailed' && event.commandSessionId === 'command_feature-1',
          'Feature hydration failures should preserve the originating command session.',
        )
      },
    },
    {
      effect: {
        type: 'feature.evaluatePreview',
        requestId: 'request_feature-preview-1',
        commandSessionId: 'command_feature-1',
        documentId: 'doc_fixture',
        baseRevisionId: 'rev_fixture',
        featureSession,
      },
      expectedType: 'effect.featurePreviewFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.featurePreviewFailed' && event.baseRevisionId === 'rev_fixture',
          'Preview failures should preserve the base revision they were evaluated against.',
        )
      },
    },
    {
      effect: {
        type: 'feature.commit',
        requestId: 'request_feature-commit-1',
        commandSessionId: 'command_feature-1',
        documentId: 'doc_fixture',
        baseRevisionId: 'rev_fixture',
        mutationBasis: { baseRevisionId: 'rev_fixture' },
        featureSession,
      },
      expectedType: 'effect.featureCommitFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.featureCommitFailed' && event.baseRevisionId === 'rev_fixture',
          'Feature-commit failures should preserve the mutation basis revision.',
        )
      },
    },
    {
      effect: {
        type: 'sketch.commit',
        requestId: 'request_sketch-commit-1',
        commandSessionId: 'command_sketch-1',
        documentId: 'doc_fixture',
        baseRevisionId: 'rev_fixture',
        mutationBasis: { baseRevisionId: 'rev_fixture' },
        session: sketchSession,
      },
      expectedType: 'effect.sketchCommitFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.sketchCommitFailed' && event.commandSessionId === 'command_sketch-1',
          'Sketch-commit failures should preserve the command session correlation.',
        )
      },
    },
    {
      effect: {
        type: 'sketch.projectReferences',
        requestId: 'request_sketch-project-1',
        commandSessionId: 'command_sketch-1',
        documentId: 'doc_fixture',
        baseRevisionId: 'rev_fixture',
        session: sketchSession,
      },
      expectedType: 'effect.sketchReferenceProjectionFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.sketchReferenceProjectionFailed' && event.baseRevisionId === 'rev_fixture',
          'Reference-projection failures should preserve the base revision context.',
        )
      },
    },
    {
      effect: {
        type: 'sketch.importReferenceImages',
        requestId: 'request_sketch-import-1',
        commandSessionId: 'command_sketch-1',
        documentId: 'doc_fixture',
        baseRevisionId: 'rev_fixture',
        mutationBasis: { baseRevisionId: 'rev_fixture' },
        session: sketchSession,
        payloads: [],
      },
      expectedType: 'effect.sketchReferenceImageImportFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.sketchReferenceImageImportFailed' && event.commandSessionId === 'command_sketch-1',
          'Reference-image import failures should map back into the dedicated image-import failure event.',
        )
      },
    },
    {
      effect: {
        type: 'sketch.specialModeEffect',
        requestId: 'request_special-mode-1',
        commandSessionId: 'command_sketch-1',
        documentId: 'doc_fixture',
        baseRevisionId: 'rev_fixture',
        modeId: 'fixture.mode',
        effectId: 'replace-image',
        kind: 'reference-image-replace-image',
        payload: {},
      },
      expectedType: 'effect.sketchSpecialModeEffectFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.sketchSpecialModeEffectFailed' && event.effectId === 'replace-image',
          'Special-mode failures should preserve the effect id so the reducer can reconcile the pending mode request.',
        )
      },
    },
    {
      effect: {
        type: 'document.moveHistoryCursor',
        requestId: 'request_cursor-1',
        documentId: 'doc_fixture',
        baseRevisionId: 'rev_fixture',
        mutationBasis: { baseRevisionId: 'rev_fixture' },
        cursor: { kind: 'feature', featureId: 'feature_fixture' },
        transient: true,
      },
      expectedType: 'effect.documentCursorMoveFailed',
      assertResult: (event) => {
        assert(
          event.type === 'effect.documentCursorMoveFailed' && event.baseRevisionId === 'rev_fixture',
          'Cursor-move failures should preserve the base revision used for the history mutation.',
        )
      },
    },
  ]

  for (const { effect, expectedType, assertResult } of failureCases) {
    const event = createEditorEffectFailureEvent(effect, new Error('Effect boom.'), 'Fallback.')
    assert(event.type === expectedType, `Expected ${effect.type} failures to map to ${expectedType}.`)
    assertResult(event)
    assert(
      'message' in event ? event.message === 'Effect boom.' : event.error === 'Effect boom.',
      `${effect.type} failures should preserve the normalized error message on the mapped event.`,
    )
  }
})

test('error-mapping.ts extracts revision ids and diagnostic codes only from valid app-error context entries', () => {
  const appError = createAppError({
    code: 'modeling/revision-rejected',
    message: 'Revision conflict.',
    context: [
      { key: 'actualRevisionId', value: 'rev_actual' },
      { key: 'invalidRevision', value: 'draft_123' },
      { key: 'diagnosticCode', value: 'repository-head-conflict' },
      { key: 'emptyDiagnosticCode', value: '' },
    ],
  })

  assert(
    getAppErrorRevisionId(appError, 'actualRevisionId') === 'rev_actual'
      && getAppErrorRevisionId(appError, 'invalidRevision') === undefined,
    'Revision extraction should only accept revision-shaped context values.',
  )
  assert(
    getAppErrorDiagnosticCode(appError) === 'repository-head-conflict',
    'Diagnostic-code extraction should return the non-empty diagnostic code from app-error context.',
  )
})

test('error-mapping.ts filters non-durable targets and converts modeling mutation app errors into diagnostics', () => {
  const modelingError = createAppError({
    code: 'modeling/diagnostic',
    message: 'Face selection is stale.',
    context: [{ key: 'diagnosticCode', value: 'stale-face' }],
  })

  const durableTarget = { kind: 'face', bodyId: 'body_fixture', faceId: 'face_fixture' } as const
  const projectedTarget = {
    kind: 'projectedReferenceGeometry',
    referenceId: 'reference_fixture',
    geometryId: 'projected_geometry_fixture',
    geometryKind: 'lineSegment',
  } as const

  const diagnostic = modelingMutationErrorToDiagnostic(modelingError, durableTarget)

  assert(isModelingMutationError(modelingError), 'Modeling diagnostic app errors should be recognized as modeling-mutation failures.')
  assert(
    diagnostic.code === 'stale-face'
      && diagnostic.message === 'Face selection is stale.'
      && diagnostic.target === durableTarget,
    'Modeling mutation conversion should preserve the diagnostic code, message, and durable target.',
  )
  assert(
    getDurableDiagnosticTarget(durableTarget) === durableTarget
      && getDurableDiagnosticTarget(projectedTarget) === null,
    'Non-durable projected or sketch-only targets should be stripped before attaching diagnostics to modeling results.',
  )
})
