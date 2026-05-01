import { createAuthoredModelDocumentFromSnapshot, type AuthoredModelDocument } from '@/contracts/modeling/authored-document'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import { CONTRACT_VERSION } from '@/contracts/shared/versioning'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

export async function createSeedDocumentSnapshot(documentId: WorkspaceSnapshot['document']['documentId'] = 'doc_workspace') {
  const adapter = new MockKernelAdapter()
  return (await adapter.getDocumentSnapshot({
    contractVersion: CONTRACT_VERSION,
    documentId,
  })).snapshot
}

export async function createSeedAuthoredModelDocument(documentId: AuthoredModelDocument['documentId'] = 'doc_workspace') {
  return createAuthoredModelDocumentFromSnapshot(await createSeedDocumentSnapshot(documentId))
}
