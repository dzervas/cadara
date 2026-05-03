import type {
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import type { DurableRef } from '@/contracts/shared/references'
import type { RevisionId } from '@/contracts/shared/ids'
import {
  appErrorToModelingDiagnostic,
  normalizeUnknownError,
  type AppError,
  type AppErrorContextEntry,
} from '@/contracts/errors'
import type { PrimitiveRef } from '@/core/editor/schema'
import type { EditorEffect, EditorEvent } from './types'

export function getEditorEffectContext(effect: EditorEffect): AppErrorContextEntry[] {
  const context: AppErrorContextEntry[] = [
    { key: 'operation', value: effect.type },
    { key: 'requestId', value: effect.requestId },
  ]

  if ('documentId' in effect) {
    context.push({ key: 'documentId', value: effect.documentId })
  }

  if ('revisionId' in effect) {
    context.push({ key: 'revisionId', value: effect.revisionId })
  }

  if ('baseRevisionId' in effect) {
    context.push({ key: 'baseRevisionId', value: effect.baseRevisionId })
  }

  if ('commandSessionId' in effect) {
    context.push({ key: 'commandSessionId', value: effect.commandSessionId })
  }

  if (effect.type === 'feature.hydrateFromSelection') {
    context.push({ key: 'featureId', value: effect.selectedFeatureId })
  }

  if (effect.type === 'feature.evaluatePreview' || effect.type === 'feature.commit') {
    context.push({ key: 'previewId', value: effect.featureSession.previewId })
    if (effect.featureSession.featureId) {
      context.push({ key: 'featureId', value: effect.featureSession.featureId })
    }
  }

  if (
    effect.type === 'sketch.commit'
    || effect.type === 'sketchPlane.commit'
    || effect.type === 'sketch.projectReferences'
    || effect.type === 'sketch.importReferenceImages'
  ) {
    context.push({ key: 'sketchId', value: effect.session.sketchId })
  }

  if (effect.type === 'sketch.specialModeEffect') {
    context.push({ key: 'modeId', value: effect.modeId })
    context.push({ key: 'effectId', value: effect.effectId })
    context.push({ key: 'effectKind', value: effect.kind })
  }

  return context
}

export function createEditorEffectFailureEvent(
  effect: EditorEffect,
  error: unknown,
  fallbackMessage: string,
): EditorEvent {
  const appError = normalizeUnknownError(error, {
    code: 'editor/effect-failed',
    fallbackMessage,
    requestId: effect.requestId,
    context: getEditorEffectContext(effect),
  })

  switch (effect.type) {
    case 'document.fetchSnapshot':
      return {
        type: 'effect.snapshotFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        revisionId: effect.revisionId,
        error: appError.message,
      }
    case 'sketch.openSession':
      return {
        type: 'effect.sketchSessionOpenFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        revisionId: effect.revisionId,
        commandSessionId: effect.commandSessionId,
        message: appError.message,
      }
    case 'feature.hydrateFromSelection':
      return {
        type: 'effect.featureSessionHydrationFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        revisionId: effect.revisionId,
        commandSessionId: effect.commandSessionId,
        message: appError.message,
      }
    case 'feature.evaluatePreview':
      return {
        type: 'effect.featurePreviewFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'feature.commit':
      return {
        type: 'effect.featureCommitFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketch.commit':
      return {
        type: 'effect.sketchCommitFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketchPlane.commit':
      return {
        type: 'effect.sketchPlaneCommitFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketch.projectReferences':
      return {
        type: 'effect.sketchReferenceProjectionFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketch.importReferenceImages':
      return {
        type: 'effect.sketchReferenceImageImportFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketch.specialModeEffect':
      return {
        type: 'effect.sketchSpecialModeEffectFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        effectId: effect.effectId,
        message: appError.message,
      }
    case 'document.moveHistoryCursor':
      return {
        type: 'effect.documentCursorMoveFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
  }
}

export function getAppErrorContextValue(appError: AppError, key: string) {
  return appError.context.find((entry) => entry.key === key)?.value
}

export function getAppErrorRevisionId(appError: AppError, key: string): RevisionId | undefined {
  const value = getAppErrorContextValue(appError, key)

  return typeof value === 'string' && value.startsWith('rev_') ? value as RevisionId : undefined
}

export function getAppErrorDiagnosticCode(appError: AppError) {
  const value = getAppErrorContextValue(appError, 'diagnosticCode')

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function isModelingMutationError(appError: AppError) {
  return appError.code === 'modeling/diagnostic' || appError.code === 'modeling/revision-rejected'
}

export function modelingMutationErrorToDiagnostic(appError: AppError, target?: DurableRef | null): ModelingDiagnostic {
  return appErrorToModelingDiagnostic(appError, {
    target,
    code: getAppErrorDiagnosticCode(appError),
  })
}

export function createPreviewFailedDiagnostics(
  message: string,
  target: PrimitiveRef | null,
): ModelingDiagnostic[] {
  return [
    {
      code: 'feature-preview-failed',
      severity: 'error',
      message,
      target: getDurableDiagnosticTarget(target),
      detail: null,
    },
  ]
}

export function getDurableDiagnosticTarget(target: PrimitiveRef | null): DurableRef | null {
  if (
    !target
    || target.kind === 'projectedReferenceGeometry'
    || target.kind === 'sketchDatumReference'
    || target.kind === 'sketchExternalReference'
  ) {
    return null
  }

  return target
}
