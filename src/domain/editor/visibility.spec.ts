import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import {
  getAutoHiddenSketchTargetKeys,
  getSketchEditingOriginPlaneTargetKeys,
  getWorkbenchVisibilityState,
  reconcileVisibilityIntentKeys,
  toggleWorkbenchTargetVisibility,
} from "@/domain/editor/visibility";
import { getPrimitiveRefKey } from "@/core/editor/schema";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { OCC_KERNEL_CONSTRUCTION_IDS } from "@/domain/modeling/opencascade-kernel-seed";

test("src/domain/editor/visibility.spec.ts", async () => {
  const adapter = new MockKernelAdapter();
  const response = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const snapshot = response.snapshot;
  const sketchTarget = snapshot.presentation.objects.find(
    (item) =>
      item.target.kind === "sketch" &&
      item.target.sketchId === "sketch_primary",
  )?.target;

  expectTrue(
    sketchTarget?.kind === "sketch",
    "Visibility fixture should expose the consumed primary sketch row.",
  );

  const sketchKey = getPrimitiveRefKey(sketchTarget);
  const autoHiddenSketchTargetKeys = getAutoHiddenSketchTargetKeys(snapshot);

  expectTrue(
    autoHiddenSketchTargetKeys[sketchKey] === true,
    "Consumed sketch rows should derive auto-hidden state from snapshot consumption metadata.",
  );

  const initialVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
  });

  expectTrue(
    initialVisibility.effectiveHiddenTargetKeys[sketchKey] === true,
    "Consumed sketch rows should start hidden when no explicit show override exists.",
  );

  const originPlaneKeys = Object.values(OCC_KERNEL_CONSTRUCTION_IDS).map(
    (constructionId) =>
      getPrimitiveRefKey({ kind: "construction", constructionId }),
  );
  const originPlaneVisibility = getSketchEditingOriginPlaneTargetKeys(true);

  expectTrue(
    originPlaneKeys.every((key) => originPlaneVisibility[key] === true),
    "Sketch editing should derive temporary hidden state for every origin plane.",
  );

  const sketchEditingVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
    isSketchEditing: true,
  });

  expectTrue(
    originPlaneKeys.every(
      (key) => sketchEditingVisibility.effectiveHiddenTargetKeys[key] === true,
    ),
    "Sketch editing should hide all origin planes without a user visibility toggle.",
  );

  const exitedSketchVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
    isSketchEditing: false,
  });

  expectTrue(
    originPlaneKeys.every(
      (key) => exitedSketchVisibility.effectiveHiddenTargetKeys[key] !== true,
    ),
    "Leaving sketch editing should restore origin-plane visibility when the user had not hidden them.",
  );

  const explicitlyHiddenPlaneKey = originPlaneKeys[1];
  expectTrue(
    explicitlyHiddenPlaneKey != null,
    "Origin-plane visibility fixture should include a YZ plane key.",
  );

  const exitedWithPreviousPlaneHiddenVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: { [explicitlyHiddenPlaneKey]: true },
    explicitlyShownAutoHiddenTargetKeys: {},
    isSketchEditing: false,
  });

  expectTrue(
    exitedWithPreviousPlaneHiddenVisibility.effectiveHiddenTargetKeys[
      explicitlyHiddenPlaneKey
    ] === true,
    "Leaving sketch editing should preserve an origin plane that was already hidden.",
  );

  const shownOverride = toggleWorkbenchTargetVisibility({
    target: sketchTarget,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
    effectiveHiddenTargetKeys: initialVisibility.effectiveHiddenTargetKeys,
    autoHiddenSketchTargetKeys: initialVisibility.autoHiddenSketchTargetKeys,
  });
  const shownVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: shownOverride.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys:
      shownOverride.explicitlyShownAutoHiddenTargetKeys,
  });

  expectTrue(
    shownVisibility.effectiveHiddenTargetKeys[sketchKey] !== true,
    "Toggling an auto-hidden sketch should create a session-local show override.",
  );

  const hiddenAgain = toggleWorkbenchTargetVisibility({
    target: sketchTarget,
    explicitHiddenTargetKeys: shownOverride.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys:
      shownOverride.explicitlyShownAutoHiddenTargetKeys,
    effectiveHiddenTargetKeys: shownVisibility.effectiveHiddenTargetKeys,
    autoHiddenSketchTargetKeys: shownVisibility.autoHiddenSketchTargetKeys,
  });
  const hiddenAgainVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: hiddenAgain.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys:
      hiddenAgain.explicitlyShownAutoHiddenTargetKeys,
  });

  expectTrue(
    hiddenAgainVisibility.effectiveHiddenTargetKeys[sketchKey] === true,
    "Toggling a shown consumed sketch again should fall back to the derived auto-hidden state.",
  );

  const reconciled = reconcileVisibilityIntentKeys(
    {
      [sketchKey]: true,
      "sketch:stale": true,
    },
    new Set([sketchKey]),
  );

  expectTrue(
    reconciled[sketchKey] === true && reconciled["sketch:stale"] !== true,
    "Visibility intent reconciliation should drop stale target keys after snapshot updates.",
  );
});
