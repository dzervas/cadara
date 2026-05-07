import type { AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import { stableJsonValue } from '@/contracts/modeling/authored-document-serialization'
import type { DocumentId } from '@/contracts/shared/ids'

export function normalizeAuthoredDocumentId(
  document: AuthoredModelDocument,
  documentId: DocumentId,
): AuthoredModelDocument {
  return {
    ...document,
    documentId,
  }
}

export function authoredModelDocumentsEqual(
  left: AuthoredModelDocument,
  right: AuthoredModelDocument,
) {
  return JSON.stringify(stableJsonValue(left)) === JSON.stringify(stableJsonValue(right))
}
