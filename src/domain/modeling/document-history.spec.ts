import { test, expect } from "vitest";

import {
  getAppliedDocumentHistoryItemsForDocumentCursor,
  getDocumentHistoryCursorBeforeTarget,
  getDocumentHistoryCursorIndex,
  getNextDocumentHistoryCursor,
  getPreviousDocumentHistoryCursor,
  getAppliedFeatureIdsForDocumentCursor,
  getAppliedSketchIdsForDocumentCursor,
  insertDocumentHistoryOrderEntryAfterCursor,
} from "@/domain/modeling/document-history";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import { SKETCH_SCHEMA_VERSION } from "@/contracts/sketch/schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/domain/modeling/document-history.spec.ts", async () => {
  const adapter = new MockKernelAdapter();
  const snapshot = (
    await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    })
  ).snapshot;
  const items = snapshot.presentation.documentHistory;

  expect(
    items.length >= 2,
    "Seed document should expose multiple document history items.",
  ).toBeTruthy();
  const firstItem = items[0];
  const seedSketchItem = items.find((item) => item.kind === "sketch");
  const seedFeatureItem = items.find((item) => item.kind === "feature");

  expect(
    firstItem,
    "Seed document should expose a first document history item.",
  ).toBeTruthy();
  expect(
    seedSketchItem?.kind,
    "Seed document should expose a sketch history item.",
  ).toBe("sketch");
  expect(
    seedFeatureItem?.kind,
    "Seed document should expose a feature history item.",
  ).toBe("feature");

  const featureRollback = getDocumentHistoryCursorBeforeTarget(items, {
    kind: "feature",
    featureId: seedFeatureItem.featureId,
  });
  expect(
    featureRollback,
    "Feature targets should resolve to a rollback cursor.",
  ).not.toBe(null);
  expect(
    getDocumentHistoryCursorIndex(items, featureRollback),
    "Feature rollback cursor should point immediately before the target feature.",
  ).toBe(
    getDocumentHistoryCursorIndex(items, {
      kind: "feature",
      featureId: seedFeatureItem.featureId,
    }) - 1,
  );

  const sketchRollback = getDocumentHistoryCursorBeforeTarget(items, {
    kind: "sketch",
    sketchId: seedSketchItem.sketchId,
  });
  expect(
    sketchRollback,
    "Sketch targets should resolve to a rollback cursor.",
  ).not.toBe(null);
  expect(
    getDocumentHistoryCursorIndex(items, sketchRollback),
    "Sketch rollback cursor should point immediately before the target sketch.",
  ).toBe(
    getDocumentHistoryCursorIndex(items, {
      kind: "sketch",
      sketchId: seedSketchItem.sketchId,
    }) - 1,
  );

  const firstRollback = getDocumentHistoryCursorBeforeTarget(
    items,
    firstItem.kind === "sketch"
      ? { kind: "sketch", sketchId: firstItem.sketchId }
      : { kind: "feature", featureId: firstItem.featureId },
  );
  expect(
    firstRollback?.kind,
    "The first history item should roll back to the empty cursor.",
  ).toBe("empty");
  expect(
    getDocumentHistoryCursorBeforeTarget(items, {
      kind: "feature",
      featureId: "feature_missing",
    }),
    "Missing feature targets should not resolve to a rollback cursor.",
  ).toBe(null);
  expect(
    getDocumentHistoryCursorBeforeTarget(items, {
      kind: "sketch",
      sketchId: "sketch_missing",
    }),
    "Missing sketch targets should not resolve to a rollback cursor.",
  ).toBe(null);

  expect(
    getDocumentHistoryCursorIndex(items, snapshot.document.cursor),
    "Seed document cursor should start at the document history tail.",
  ).toBe(items.length - 1);
  expect(
    getAppliedDocumentHistoryItemsForDocumentCursor(items, { kind: "empty" })
      .length,
    "Applied document history before the first item should be empty.",
  ).toBe(0);
  expect(
    getAppliedSketchIdsForDocumentCursor(items, {
      kind: "sketch",
      sketchId: seedSketchItem.sketchId,
    }).has(seedSketchItem.sketchId),
    "Applied sketch ids should include a sketch cursor target.",
  ).toBeTruthy();
  expect(
    getAppliedFeatureIdsForDocumentCursor(items, {
      kind: "sketch",
      sketchId: seedSketchItem.sketchId,
    }).size,
    "A cursor on the seed sketch should not include later feature ids.",
  ).toBe(0);
  expect(
    getAppliedFeatureIdsForDocumentCursor(items, {
      kind: "feature",
      featureId: seedFeatureItem.featureId,
    }).has(seedFeatureItem.featureId),
    "Applied feature ids should include a feature cursor target.",
  ).toBeTruthy();

  const previous = getPreviousDocumentHistoryCursor(snapshot);
  expect(
    previous,
    "Undo should be available at the document history tail.",
  ).not.toBe(null);
  expect(
    getDocumentHistoryCursorIndex(items, previous),
    "Previous document cursor should step back one history item.",
  ).toBe(items.length - 2);
  expect(
    getNextDocumentHistoryCursor(snapshot),
    "Redo should be unavailable at the document history tail.",
  ).toBe(null);

  const rolledBackSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: previous,
    },
    cursor: previous,
  };
  const next = getNextDocumentHistoryCursor(rolledBackSnapshot);

  expect(
    next,
    "Redo should be available after a document cursor rollback.",
  ).not.toBe(null);
  expect(
    getDocumentHistoryCursorIndex(items, next),
    "Next document cursor should step forward one history item.",
  ).toBe(items.length - 1);

  const beforeFirstSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: { kind: "empty" as const },
    },
    cursor: { kind: "empty" as const },
  };

  expect(
    getPreviousDocumentHistoryCursor(beforeFirstSnapshot),
    "Undo should be unavailable before the first document history item.",
  ).toBe(null);
  expect(
    getNextDocumentHistoryCursor(beforeFirstSnapshot)?.kind,
    "Redo should be available from the before-first document cursor position.",
  ).toBe(items[0]?.kind);

  const insertedBeforeFirst = insertDocumentHistoryOrderEntryAfterCursor(
    items,
    { kind: "empty" },
    { kind: "sketch", sketchId: "sketch_before_first" },
  );
  expect(
    insertedBeforeFirst[0]?.kind === "sketch" &&
      insertedBeforeFirst[0].sketchId === "sketch_before_first",
    "New document-history entries inserted after the empty cursor should become the first item.",
  ).toBeTruthy();

  const committed = await adapter.commitSketch({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
    baseRevisionId: snapshot.document.revisionId,
    sketchId: "sketch_after_seed_feature",
    sketchLabel: "Sketch After Seed Feature",
    plane: snapshot.document.sketches[0]!.plane,
    planeTarget: snapshot.document.sketches[0]!.planeTarget,
    planeKey: snapshot.document.sketches[0]!.planeKey,
    solverCorrelation: {
      requestId: "request_history_order_sketch",
      projectionRequestId: "request_history_order_sketch:project",
      validationRequestId: "request_history_order_sketch:validate",
      solveRequestId: "request_history_order_sketch:solve",
      regionRequestId: "request_history_order_sketch:regions",
    },
    definition: {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: [],
      points: [],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    },
  });
  expect(
    committed.revisionState.kind,
    "History-order sketch commit should be accepted.",
  ).toBe("accepted");

  const interleaved = (
    await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    })
  ).snapshot;
  const order = interleaved.presentation.documentHistory.map((item) =>
    item.kind === "sketch" ? item.sketchId : item.featureId,
  );
  expect(
    order.indexOf("feature_extrude-1") <
      order.indexOf("sketch_after_seed_feature"),
    "Sketches committed after a feature must remain after that feature in document history.",
  ).toBeTruthy();

  const authored = createAuthoredModelDocumentFromSnapshot(interleaved);
  const authoredOrder =
    authored.historyOrder?.map((item) =>
      item.kind === "sketch" ? item.sketchId : item.featureId,
    ) ?? [];
  expect(
    authoredOrder.indexOf("feature_extrude-1") <
      authoredOrder.indexOf("sketch_after_seed_feature"),
    "Authored document persistence must preserve interleaved sketch/feature history order.",
  ).toBeTruthy();
});
