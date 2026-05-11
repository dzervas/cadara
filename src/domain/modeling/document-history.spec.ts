import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
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

  expectTrue(
    items.length >= 2,
    "Seed document should expose multiple document history items.",
  );
  const firstItem = items[0];
  const seedSketchItem = items.find((item) => item.kind === "sketch");
  const seedFeatureItem = items.find((item) => item.kind === "feature");

  expectTrue(
    firstItem,
    "Seed document should expose a first document history item.",
  );
  expectTrue(
    seedSketchItem?.kind === "sketch",
    "Seed document should expose a sketch history item.",
  );
  expectTrue(
    seedFeatureItem?.kind === "feature",
    "Seed document should expose a feature history item.",
  );

  const featureRollback = getDocumentHistoryCursorBeforeTarget(items, {
    kind: "feature",
    featureId: seedFeatureItem.featureId,
  });
  expectTrue(
    featureRollback !== null,
    "Feature targets should resolve to a rollback cursor.",
  );
  expectTrue(
    getDocumentHistoryCursorIndex(items, featureRollback) ===
      getDocumentHistoryCursorIndex(items, {
        kind: "feature",
        featureId: seedFeatureItem.featureId,
      }) -
        1,
    "Feature rollback cursor should point immediately before the target feature.",
  );

  const sketchRollback = getDocumentHistoryCursorBeforeTarget(items, {
    kind: "sketch",
    sketchId: seedSketchItem.sketchId,
  });
  expectTrue(
    sketchRollback !== null,
    "Sketch targets should resolve to a rollback cursor.",
  );
  expectTrue(
    getDocumentHistoryCursorIndex(items, sketchRollback) ===
      getDocumentHistoryCursorIndex(items, {
        kind: "sketch",
        sketchId: seedSketchItem.sketchId,
      }) -
        1,
    "Sketch rollback cursor should point immediately before the target sketch.",
  );

  const firstRollback = getDocumentHistoryCursorBeforeTarget(
    items,
    firstItem.kind === "sketch"
      ? { kind: "sketch", sketchId: firstItem.sketchId }
      : { kind: "feature", featureId: firstItem.featureId },
  );
  expectTrue(
    firstRollback?.kind === "empty",
    "The first history item should roll back to the empty cursor.",
  );
  expectTrue(
    getDocumentHistoryCursorBeforeTarget(items, {
      kind: "feature",
      featureId: "feature_missing",
    }) === null,
    "Missing feature targets should not resolve to a rollback cursor.",
  );
  expectTrue(
    getDocumentHistoryCursorBeforeTarget(items, {
      kind: "sketch",
      sketchId: "sketch_missing",
    }) === null,
    "Missing sketch targets should not resolve to a rollback cursor.",
  );

  expectTrue(
    getDocumentHistoryCursorIndex(items, snapshot.document.cursor) ===
      items.length - 1,
    "Seed document cursor should start at the document history tail.",
  );
  expectTrue(
    getAppliedDocumentHistoryItemsForDocumentCursor(items, { kind: "empty" })
      .length === 0,
    "Applied document history before the first item should be empty.",
  );
  expectTrue(
    getAppliedSketchIdsForDocumentCursor(items, {
      kind: "sketch",
      sketchId: seedSketchItem.sketchId,
    }).has(seedSketchItem.sketchId),
    "Applied sketch ids should include a sketch cursor target.",
  );
  expectTrue(
    getAppliedFeatureIdsForDocumentCursor(items, {
      kind: "sketch",
      sketchId: seedSketchItem.sketchId,
    }).size === 0,
    "A cursor on the seed sketch should not include later feature ids.",
  );
  expectTrue(
    getAppliedFeatureIdsForDocumentCursor(items, {
      kind: "feature",
      featureId: seedFeatureItem.featureId,
    }).has(seedFeatureItem.featureId),
    "Applied feature ids should include a feature cursor target.",
  );

  const previous = getPreviousDocumentHistoryCursor(snapshot);
  expectTrue(
    previous !== null,
    "Undo should be available at the document history tail.",
  );
  expectTrue(
    getDocumentHistoryCursorIndex(items, previous) === items.length - 2,
    "Previous document cursor should step back one history item.",
  );
  expectTrue(
    getNextDocumentHistoryCursor(snapshot) === null,
    "Redo should be unavailable at the document history tail.",
  );

  const rolledBackSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: previous,
    },
    cursor: previous,
  };
  const next = getNextDocumentHistoryCursor(rolledBackSnapshot);

  expectTrue(
    next !== null,
    "Redo should be available after a document cursor rollback.",
  );
  expectTrue(
    getDocumentHistoryCursorIndex(items, next) === items.length - 1,
    "Next document cursor should step forward one history item.",
  );

  const beforeFirstSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: { kind: "empty" as const },
    },
    cursor: { kind: "empty" as const },
  };

  expectTrue(
    getPreviousDocumentHistoryCursor(beforeFirstSnapshot) === null,
    "Undo should be unavailable before the first document history item.",
  );
  expectTrue(
    getNextDocumentHistoryCursor(beforeFirstSnapshot)?.kind === items[0]?.kind,
    "Redo should be available from the before-first document cursor position.",
  );

  const insertedBeforeFirst = insertDocumentHistoryOrderEntryAfterCursor(
    items,
    { kind: "empty" },
    { kind: "sketch", sketchId: "sketch_before_first" },
  );
  expectTrue(
    insertedBeforeFirst[0]?.kind === "sketch" &&
      insertedBeforeFirst[0].sketchId === "sketch_before_first",
    "New document-history entries inserted after the empty cursor should become the first item.",
  );

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
  expectTrue(
    committed.revisionState.kind === "accepted",
    "History-order sketch commit should be accepted.",
  );

  const interleaved = (
    await adapter.getDocumentSnapshot({
      contractVersion: "modeling-contract/v1alpha1",
      documentId: "doc_workspace",
    })
  ).snapshot;
  const order = interleaved.presentation.documentHistory.map((item) =>
    item.kind === "sketch" ? item.sketchId : item.featureId,
  );
  expectTrue(
    order.indexOf("feature_extrude-1") <
      order.indexOf("sketch_after_seed_feature"),
    "Sketches committed after a feature must remain after that feature in document history.",
  );

  const authored = createAuthoredModelDocumentFromSnapshot(interleaved);
  const authoredOrder =
    authored.historyOrder?.map((item) =>
      item.kind === "sketch" ? item.sketchId : item.featureId,
    ) ?? [];
  expectTrue(
    authoredOrder.indexOf("feature_extrude-1") <
      authoredOrder.indexOf("sketch_after_seed_feature"),
    "Authored document persistence must preserve interleaved sketch/feature history order.",
  );
});
