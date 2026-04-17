import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { evaluateDocumentVariableExpressions } from '@/domain/modeling/document-variable-expressions'

export const COLLABORATIVE_MERGE_DIAGNOSTIC_CODES = {
  invalidFeatureOrder: 'merge-invalid-feature-order',
  missingCursorTarget: 'merge-missing-cursor-target',
  invalidDurableReference: 'merge-invalid-durable-reference',
  unresolvedVariableCycle: 'merge-unresolved-variable-cycle',
  concurrentVariableConflict: 'merge-concurrent-variable-conflict',
  concurrentLabelConflict: 'merge-concurrent-label-conflict',
} as const

export function normalizeCollaborativeAuthoredModelDocument(document: AuthoredModelDocument): {
  document: AuthoredModelDocument
  diagnostics: ModelingDiagnostic[]
} {
  const diagnostics: ModelingDiagnostic[] = []
  const featureIds = new Set(document.features.map((feature) => feature.featureId))
  const sketchIds = new Set(document.sketches.map((sketch) => sketch.sketchId))
  const bodyIds = new Set(document.bodyLabels.map((label) => label.bodyId))
  const featureOrder = normalizeFeatureOrder(document, featureIds, diagnostics)
  const cursor = normalizeCursor(document, featureIds, sketchIds, diagnostics)

  diagnostics.push(...collectScalarDiagnostics(document))
  diagnostics.push(...collectInvalidReferenceDiagnostics(document, featureIds, sketchIds, bodyIds))

  return {
    document: {
      ...document,
      featureOrder,
      cursor,
    },
    diagnostics,
  }
}

function normalizeFeatureOrder(
  document: AuthoredModelDocument,
  featureIds: ReadonlySet<AuthoredModelDocument['features'][number]['featureId']>,
  diagnostics: ModelingDiagnostic[],
) {
  const seen = new Set<string>()
  const normalized = document.featureOrder.filter((featureId) => {
    if (!featureIds.has(featureId) || seen.has(featureId)) {
      diagnostics.push(createMergeDiagnostic(
        COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidFeatureOrder,
        `Merged feature order contained invalid or duplicate feature ${featureId}.`,
        { kind: 'feature', featureId },
      ))
      return false
    }

    seen.add(featureId)
    return true
  })
  const missingFeatureIds = [...featureIds].filter((featureId) => !seen.has(featureId)).sort()
  if (missingFeatureIds.length > 0) {
    diagnostics.push(createMergeDiagnostic(
      COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidFeatureOrder,
      `Merged feature order omitted ${missingFeatureIds.join(', ')}; appended deterministically by durable ID.`,
      null,
    ))
  }

  return [...normalized, ...missingFeatureIds]
}

function normalizeCursor(
  document: AuthoredModelDocument,
  featureIds: ReadonlySet<AuthoredModelDocument['features'][number]['featureId']>,
  sketchIds: ReadonlySet<AuthoredModelDocument['sketches'][number]['sketchId']>,
  diagnostics: ModelingDiagnostic[],
): AuthoredModelDocument['cursor'] {
  if (document.cursor.kind === 'feature' && !featureIds.has(document.cursor.featureId)) {
    diagnostics.push(createMergeDiagnostic(
      COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.missingCursorTarget,
      `Merged feature cursor referenced missing feature ${document.cursor.featureId}.`,
      { kind: 'feature', featureId: document.cursor.featureId },
    ))
    return { kind: 'empty' }
  }

  if (document.cursor.kind === 'sketch' && !sketchIds.has(document.cursor.sketchId)) {
    diagnostics.push(createMergeDiagnostic(
      COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.missingCursorTarget,
      `Merged feature cursor referenced missing sketch ${document.cursor.sketchId}.`,
      { kind: 'sketch', sketchId: document.cursor.sketchId },
    ))
    return { kind: 'empty' }
  }

  return structuredClone(document.cursor)
}

function collectScalarDiagnostics(document: AuthoredModelDocument) {
  const diagnostics: ModelingDiagnostic[] = []
  const variableEvaluation = evaluateDocumentVariableExpressions(document.variables)
  if (!variableEvaluation.ok) {
    diagnostics.push(...variableEvaluation.diagnostics.map((diagnostic) =>
      createMergeDiagnostic(
        diagnostic.code === 'document-variable-cycle'
          ? COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.unresolvedVariableCycle
          : COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.concurrentVariableConflict,
        diagnostic.message,
        null,
      ),
    ))
  }

  const labelsByFeature = new Map<string, string>()
  for (const feature of document.features) {
    const existing = labelsByFeature.get(feature.label)
    if (existing && existing !== feature.featureId) {
      diagnostics.push(createMergeDiagnostic(
        COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.concurrentLabelConflict,
        `Merged feature label "${feature.label}" is shared by ${existing} and ${feature.featureId}.`,
        { kind: 'feature', featureId: feature.featureId },
      ))
    }
    labelsByFeature.set(feature.label, feature.featureId)
  }

  return diagnostics
}

function collectInvalidReferenceDiagnostics(
  document: AuthoredModelDocument,
  featureIds: ReadonlySet<AuthoredModelDocument['features'][number]['featureId']>,
  sketchIds: ReadonlySet<AuthoredModelDocument['sketches'][number]['sketchId']>,
  bodyIds: ReadonlySet<AuthoredModelDocument['bodyLabels'][number]['bodyId']>,
) {
  const diagnostics: ModelingDiagnostic[] = []
  for (const feature of document.features) {
    for (const target of collectPrimitiveRefs(feature.definition)) {
      if (!primitiveRefExists(target, featureIds, sketchIds, bodyIds)) {
        diagnostics.push(createMergeDiagnostic(
          COLLABORATIVE_MERGE_DIAGNOSTIC_CODES.invalidDurableReference,
          `Merged feature ${feature.featureId} references missing ${target.kind}.`,
          target,
        ))
      }
    }
  }

  return diagnostics
}

function collectPrimitiveRefs(value: unknown): PrimitiveRef[] {
  if (!isRecord(value)) {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => collectPrimitiveRefs(entry))
    }
    return []
  }

  const refs = isPrimitiveRef(value) ? [value] : []
  return [
    ...refs,
    ...Object.values(value).flatMap((entry) => collectPrimitiveRefs(entry)),
  ]
}

function primitiveRefExists(
  target: PrimitiveRef,
  featureIds: ReadonlySet<AuthoredModelDocument['features'][number]['featureId']>,
  sketchIds: ReadonlySet<AuthoredModelDocument['sketches'][number]['sketchId']>,
  bodyIds: ReadonlySet<AuthoredModelDocument['bodyLabels'][number]['bodyId']>,
) {
  switch (target.kind) {
    case 'feature':
      return featureIds.has(target.featureId)
    case 'sketch':
    case 'sketchEntity':
    case 'sketchPoint':
    case 'constraint':
    case 'dimension':
    case 'region':
      return sketchIds.has(target.sketchId)
    case 'body':
    case 'face':
    case 'edge':
    case 'vertex':
    case 'loop':
      return bodyIds.has(target.bodyId)
    default:
      return true
  }
}

function isPrimitiveRef(value: Record<string, unknown>): value is Record<string, unknown> & PrimitiveRef {
  return typeof value.kind === 'string'
    && (
      ('featureId' in value && typeof value.featureId === 'string')
      || ('sketchId' in value && typeof value.sketchId === 'string')
      || ('bodyId' in value && typeof value.bodyId === 'string')
      || ('constructionId' in value && typeof value.constructionId === 'string')
    )
}

function createMergeDiagnostic(
  code: string,
  message: string,
  target: PrimitiveRef | null,
): ModelingDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    target,
    detail: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
