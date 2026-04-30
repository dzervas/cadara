import { isValidAutomergeUrl } from '@automerge/automerge-repo/slim'
import type { AutomergeUrl } from '@automerge/automerge-repo/slim'

import { parseAutomergeDocumentUrlStorePayload } from '@/contracts/modeling/document-repository.runtime-schema'
import type { DocumentId } from '@/contracts/shared/ids'

export interface DocumentRepositoryUrlStore {
  get(documentId: DocumentId): AutomergeUrl | null
  set(documentId: DocumentId, url: AutomergeUrl): void
  delete(documentId: DocumentId): void
}

export class MemoryDocumentRepositoryUrlStore implements DocumentRepositoryUrlStore {
  private readonly urls = new Map<DocumentId, AutomergeUrl>()

  get(documentId: DocumentId) {
    return this.urls.get(documentId) ?? null
  }

  set(documentId: DocumentId, url: AutomergeUrl) {
    this.urls.set(documentId, url)
  }

  delete(documentId: DocumentId) {
    this.urls.delete(documentId)
  }
}

export function createLocalStorageDocumentRepositoryUrlStore(
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void },
  key = 'cad.documentRepository.automergeUrls.v1',
): DocumentRepositoryUrlStore {
  function read() {
    const serialized = storage.getItem(key)
    if (!serialized) {
      return {} as Record<string, string>
    }

    try {
      const parsed = JSON.parse(serialized) as unknown
      const validated = parseAutomergeDocumentUrlStorePayload(parsed, isValidAutomergeUrl)
      return validated.ok ? validated.urls : {}
    } catch {
      return {}
    }
  }

  function write(value: Record<string, string>) {
    storage.setItem(key, JSON.stringify(value))
  }

  return {
    get(documentId) {
      return (read()[documentId] ?? null) as AutomergeUrl | null
    },
    set(documentId, url) {
      write({ ...read(), [documentId]: url })
    },
    delete(documentId) {
      const next = read()
      delete next[documentId]
      if (Object.keys(next).length === 0) {
        storage.removeItem(key)
        return
      }
      write(next)
    },
  }
}
