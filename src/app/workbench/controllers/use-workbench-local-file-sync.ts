import { useEffect, useState } from 'react'

import type { ModelingService } from '@/domain/modeling/modeling-service'
import type { DocumentSyncWriteStatus } from '@/domain/modeling/document-sync-worker-protocol'

function isLocalFileSyncEnabledStatus(status: DocumentSyncWriteStatus) {
  return status.kind === 'binding-restored'
    || status.kind === 'syncing'
    || status.kind === 'synced'
    || status.kind === 'persistent-binding-unavailable'
}

interface WorkbenchLocalFileSyncInput {
  modelingService: Pick<ModelingService, 'restoreLocalFileBinding' | 'subscribeToLocalFileSyncStatus'>
  reportDocumentFileActionFailure: (source: string, message: string, error: unknown) => void
  showWorkbenchError: (message: string) => void
  showWorkbenchInfo: (message: string) => void
}

export function useWorkbenchLocalFileSync({
  modelingService,
  reportDocumentFileActionFailure,
  showWorkbenchError,
  showWorkbenchInfo,
}: WorkbenchLocalFileSyncInput) {
  const [localFileSyncEnabled, setLocalFileSyncEnabled] = useState(false)

  useEffect(() => {
    return modelingService.subscribeToLocalFileSyncStatus((status) => {
      setLocalFileSyncEnabled(isLocalFileSyncEnabledStatus(status))

      switch (status.kind) {
        case 'binding-restored':
          showWorkbenchInfo(`Restored local file sync for ${status.metadata.fileName}.`)
          return
        case 'syncing':
          showWorkbenchInfo(`Syncing ${status.metadata.fileName}.`)
          return
        case 'synced':
          showWorkbenchInfo(`Synced ${status.metadata.fileName}.`)
          return
        case 'persistent-binding-unavailable':
          showWorkbenchInfo(status.message)
          return
        case 'permission-required':
          showWorkbenchError(`Local file sync needs write permission for ${status.metadata.fileName}.`)
          return
        case 'permission-denied':
          showWorkbenchError(status.message)
          return
        case 'failed':
          showWorkbenchError(status.message)
          return
        case 'idle':
          return
      }
    })
  }, [modelingService, showWorkbenchError, showWorkbenchInfo])

  useEffect(() => {
    let disposed = false

    void modelingService.restoreLocalFileBinding().then((metadata) => {
      if (!disposed && metadata) {
        showWorkbenchInfo(`Restored local file sync for ${metadata.fileName}.`)
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        reportDocumentFileActionFailure('workbench.file.restoreLocalBinding', 'Local file sync restore failed.', error)
      }
    })

    return () => {
      disposed = true
    }
  }, [modelingService, reportDocumentFileActionFailure, showWorkbenchInfo])

  return {
    localFileSyncEnabled,
  }
}
