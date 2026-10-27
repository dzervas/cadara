import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { ObjectExportModalState } from "@/core/export/object-export-state";

const EMPTY_RECORD: Record<string, never> = Object.freeze({});

/**
 * One record per document. CadWorkbench stays mounted across document tabs and
 * variable/target ids restart in every document (variable_1, feature_extrude-1...),
 * so unscoped records leaked one tab's state onto another's same-id items
 * (cadara-x4l). Returning to a tab restores its own record.
 */
function useDocumentScopedRecord<T>(documentId: string | null) {
  const [recordsByDocument, setRecordsByDocument] = useState<
    Record<string, Record<string, T>>
  >({});
  const scopeKey = documentId ?? "";
  const record: Record<string, T> =
    recordsByDocument[scopeKey] ?? EMPTY_RECORD;
  const setRecord: Dispatch<SetStateAction<Record<string, T>>> = useCallback(
    (action) => {
      setRecordsByDocument((current) => {
        const previous = current[scopeKey] ?? EMPTY_RECORD;
        return {
          ...current,
          [scopeKey]: action instanceof Function ? action(previous) : action,
        };
      });
    },
    [scopeKey],
  );

  return [record, setRecord] as const;
}

export function useWorkbenchDocumentPresentation(documentId: string | null) {
  const [rawExplicitHiddenTargetKeys, setRawExplicitHiddenTargetKeys] =
    useDocumentScopedRecord<boolean>(documentId);
  const [
    rawExplicitlyShownAutoHiddenTargetKeys,
    setRawExplicitlyShownAutoHiddenTargetKeys,
  ] = useDocumentScopedRecord<boolean>(documentId);
  const [objectLabelOverrides, setObjectLabelOverrides] =
    useDocumentScopedRecord<string>(documentId);
  const [invalidVariableValueMessages, setInvalidVariableValueMessages] =
    useDocumentScopedRecord<string>(documentId);
  const [objectExportModal, setObjectExportModal] =
    useState<ObjectExportModalState | null>(null);
  const [viewportFitRequestId, setViewportFitRequestId] = useState(0);

  const requestViewportFit = useCallback(() => {
    setViewportFitRequestId((current) => current + 1);
  }, []);

  return {
    invalidVariableValueMessages,
    objectExportModal,
    objectLabelOverrides,
    rawExplicitHiddenTargetKeys,
    rawExplicitlyShownAutoHiddenTargetKeys,
    requestViewportFit,
    setInvalidVariableValueMessages,
    setObjectExportModal,
    setObjectLabelOverrides,
    setRawExplicitHiddenTargetKeys,
    setRawExplicitlyShownAutoHiddenTargetKeys,
    viewportFitRequestId,
  };
}
