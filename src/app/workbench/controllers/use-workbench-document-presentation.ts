import { useCallback, useState } from 'react'

import type { ObjectExportModalState } from '@/domain/export/object-export-state'

export function useWorkbenchDocumentPresentation() {
  const [rawExplicitHiddenTargetKeys, setRawExplicitHiddenTargetKeys] = useState<Record<string, boolean>>({})
  const [rawExplicitlyShownAutoHiddenTargetKeys, setRawExplicitlyShownAutoHiddenTargetKeys] = useState<Record<string, boolean>>({})
  const [objectLabelOverrides, setObjectLabelOverrides] = useState<Record<string, string>>({})
  const [invalidVariableValueMessages, setInvalidVariableValueMessages] = useState<Record<string, string>>({})
  const [objectExportModal, setObjectExportModal] = useState<ObjectExportModalState | null>(null)
  const [viewportFitRequestId, setViewportFitRequestId] = useState(0)

  const resetForDocumentReplacement = useCallback(() => {
    setRawExplicitHiddenTargetKeys({})
    setRawExplicitlyShownAutoHiddenTargetKeys({})
    setObjectLabelOverrides({})
    setInvalidVariableValueMessages({})
    setObjectExportModal(null)
  }, [])

  const requestViewportFit = useCallback(() => {
    setViewportFitRequestId((current) => current + 1)
  }, [])

  return {
    invalidVariableValueMessages,
    objectExportModal,
    objectLabelOverrides,
    rawExplicitHiddenTargetKeys,
    rawExplicitlyShownAutoHiddenTargetKeys,
    requestViewportFit,
    resetForDocumentReplacement,
    setInvalidVariableValueMessages,
    setObjectExportModal,
    setObjectLabelOverrides,
    setRawExplicitHiddenTargetKeys,
    setRawExplicitlyShownAutoHiddenTargetKeys,
    viewportFitRequestId,
  }
}
