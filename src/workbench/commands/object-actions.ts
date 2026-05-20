import type { Dispatch, SetStateAction } from "react";

import {
  getPrimitiveRefKey,
  isDurablePrimitiveRef,
  type PrimitiveRef,
} from "@/core/editor/schema";
import type {
  DocumentHistoryItemRecord,
  WorkspaceSnapshot,
} from "@/contracts/modeling/schema";
import { ok, type ErrorReporter } from "@/contracts/errors";
import { runReportedAction as runWorkbenchAction } from "@/lib/reported-action";
import type { createWorkbenchDocumentOwner } from "@/workbench/document/document-owner";

type WorkbenchDocumentOwner = ReturnType<typeof createWorkbenchDocumentOwner>;
type FeatureHistoryItem = Extract<
  DocumentHistoryItemRecord,
  { kind: "feature" }
>;

interface WorkbenchObjectActionContext {
  documentOwner: WorkbenchDocumentOwner;
  errorReporter: ErrorReporter;
  snapshot: WorkspaceSnapshot | null;
  showWorkbenchError: (message: string) => void;
  showWorkbenchInfo: (message: string) => void;
}

export function requestWorkbenchRenameLabel(input: {
  currentLabel: string;
  showWorkbenchError: (message: string) => void;
}) {
  const nextLabel = window.prompt("Rename", input.currentLabel)?.trim();

  if (nextLabel === undefined) {
    return null;
  }

  if (!nextLabel) {
    input.showWorkbenchError("Name cannot be empty.");
    return null;
  }

  if (nextLabel === input.currentLabel) {
    return null;
  }

  return nextLabel;
}

export function deleteWorkbenchTarget({
  documentOwner,
  errorReporter,
  label,
  showWorkbenchError,
  showWorkbenchInfo,
  snapshot,
  target,
}: WorkbenchObjectActionContext & {
  target: PrimitiveRef;
  label: string;
}) {
  if (!snapshot) {
    return;
  }

  if (!isDurablePrimitiveRef(target)) {
    showWorkbenchError(`Delete ${label} failed.`);
    return;
  }

  void runWorkbenchAction({
    operation: `Delete ${label}`,
    reporter: errorReporter,
    reporting: { mappedFailure: "expected" },
    context: [
      { key: "baseRevisionId", value: snapshot.document.revisionId },
      { key: "target", value: getPrimitiveRefKey(target) },
    ],
    action: () =>
      documentOwner.deleteTarget(target, {
        operation: `Delete ${label}`,
        fallbackMessage: `Delete ${label} failed.`,
        context: [
          { key: "baseRevisionId", value: snapshot.document.revisionId },
          { key: "target", value: getPrimitiveRefKey(target) },
        ],
      }),
    mapSuccess: (result) => ok(result),
    onError: (error) => showWorkbenchError(error.message),
  }).then((result) => {
    if (result.isErr()) {
      return;
    }

    showWorkbenchInfo(`Deleted ${label}.`);
  });
}

export function addWorkbenchVariable({
  documentOwner,
  errorReporter,
  showWorkbenchError,
  snapshot,
}: WorkbenchObjectActionContext) {
  if (!snapshot) {
    return;
  }

  void runWorkbenchAction({
    operation: "Add variable",
    reporter: errorReporter,
    reporting: { mappedFailure: "expected" },
    context: [{ key: "baseRevisionId", value: snapshot.document.revisionId }],
    action: () =>
      documentOwner.addDocumentVariable({
        operation: "Add variable",
        fallbackMessage: "Add variable failed.",
        context: [
          { key: "baseRevisionId", value: snapshot.document.revisionId },
        ],
      }),
    mapSuccess: (result) => ok(result),
    onError: (error) => showWorkbenchError(error.message),
  });
}

export function setWorkbenchFeatureSuppression({
  documentOwner,
  errorReporter,
  item,
  showWorkbenchError,
  showWorkbenchInfo,
  snapshot,
}: WorkbenchObjectActionContext & {
  item: FeatureHistoryItem;
}) {
  if (!snapshot) {
    return;
  }

  const nextSuppressed = !item.suppressed;
  const operation = nextSuppressed
    ? `Suppress ${item.label}`
    : `Unsuppress ${item.label}`;

  void runWorkbenchAction({
    operation,
    reporter: errorReporter,
    reporting: { mappedFailure: "expected" },
    context: [
      { key: "baseRevisionId", value: snapshot.document.revisionId },
      { key: "featureId", value: item.featureId },
    ],
    action: () =>
      documentOwner.setFeatureSuppression(item.featureId, nextSuppressed, {
        operation,
        fallbackMessage: `${operation} failed.`,
        context: [
          { key: "baseRevisionId", value: snapshot.document.revisionId },
          { key: "featureId", value: item.featureId },
        ],
      }),
    mapSuccess: (result) => ok(result),
    onError: (error) => showWorkbenchError(error.message),
  }).then((result) => {
    if (result.isErr()) {
      return;
    }

    showWorkbenchInfo(
      nextSuppressed
        ? `Suppressed ${item.label}.`
        : `Unsuppressed ${item.label}.`,
    );
  });
}

export function renameWorkbenchTarget({
  documentOwner,
  errorReporter,
  label,
  setObjectLabelOverrides,
  showWorkbenchError,
  showWorkbenchInfo,
  snapshot,
  target,
}: WorkbenchObjectActionContext & {
  target: PrimitiveRef;
  label: string;
  setObjectLabelOverrides: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const nextLabel = requestWorkbenchRenameLabel({
    currentLabel: label,
    showWorkbenchError,
  });
  if (!nextLabel) {
    return;
  }

  if (!snapshot || !isDurablePrimitiveRef(target)) {
    setObjectLabelOverrides((current) => ({
      ...current,
      [getPrimitiveRefKey(target)]: nextLabel,
    }));
    showWorkbenchInfo(`Renamed ${label} to ${nextLabel}.`);
    return;
  }

  const targetContext =
    target.kind === "body"
      ? { key: "bodyId", value: target.bodyId }
      : target.kind === "feature"
        ? { key: "featureId", value: target.featureId }
        : target.kind === "sketch"
          ? { key: "sketchId", value: target.sketchId }
          : { key: "target", value: getPrimitiveRefKey(target) };

  void runWorkbenchAction({
    operation: `Rename ${label}`,
    reporter: errorReporter,
    reporting: { mappedFailure: "expected" },
    context: [
      { key: "baseRevisionId", value: snapshot.document.revisionId },
      targetContext,
    ],
    action: () =>
      documentOwner.renameTarget(target, nextLabel, {
        operation: `Rename ${label}`,
        fallbackMessage: `Rename ${label} failed.`,
        context: [
          { key: "baseRevisionId", value: snapshot.document.revisionId },
          targetContext,
        ],
      }),
    mapSuccess: (result) => ok(result),
    onError: (error) => showWorkbenchError(error.message),
  }).then((result) => {
    if (result.isErr()) {
      return;
    }

    setObjectLabelOverrides((current) => {
      const next = { ...current };
      delete next[getPrimitiveRefKey(target)];
      return next;
    });
    showWorkbenchInfo(`Renamed ${label} to ${nextLabel}.`);
  });
}
