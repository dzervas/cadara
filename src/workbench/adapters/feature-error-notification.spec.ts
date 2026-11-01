import { expect, test } from "vitest";

import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { DocumentId, FeatureId } from "@/contracts/shared/ids";
import {
  announceAcceptedDocumentMutation,
  findNewlyFailingFeatures,
  followFeatureErrorNotification,
} from "./feature-error-notification";

const PART = "doc_part" as DocumentId;
const OTHER_PART = "doc_other_part" as DocumentId;
const FILLET = "feature_fillet-1" as FeatureId;
const EXTRUDE = "feature_extrude-1" as FeatureId;

function featureError(
  featureId: FeatureId,
  severity: ModelingDiagnostic["severity"] = "error",
): ModelingDiagnostic {
  return {
    code: "feature-reference-missing",
    severity,
    message: `${featureId} selection is incorrect.`,
    featureId,
    target: null,
    detail: null,
  };
}

function part(
  diagnostics: readonly ModelingDiagnostic[],
  documentId: DocumentId = PART,
) {
  return { documentId, diagnostics };
}

test("a feature error notification is outlived once the document stops reporting that feature's error", () => {
  const shown = { documentId: PART, featureIds: [FILLET], observed: false };

  const observed = followFeatureErrorNotification(
    shown,
    part([featureError(FILLET)]),
  );
  expect(observed, "The snapshot carrying the error marks it observed.").toEqual(
    { ...shown, observed: true },
  );

  // Undo of the breaking action, deleting the feature, or repairing it.
  expect(
    followFeatureErrorNotification({ ...shown, observed: true }, part([])),
  ).toBe("outlived");
  expect(
    followFeatureErrorNotification(
      { ...shown, observed: true },
      part([featureError(FILLET, "warning")]),
    ),
    "A remaining warning is not the reported error.",
  ).toBe("outlived");
});

test("a feature error notification survives snapshots that predate it or still report the error", () => {
  const shown = { documentId: PART, featureIds: [FILLET], observed: false };
  expect(
    followFeatureErrorNotification(shown, part([])),
    "The notification can arrive before the snapshot that carries its error.",
  ).toBe(shown);

  const observed = { ...shown, observed: true };
  expect(
    followFeatureErrorNotification(
      observed,
      part([featureError(EXTRUDE), featureError(FILLET)]),
    ),
    "The feature still has its error.",
  ).toBe(observed);
  expect(
    followFeatureErrorNotification(observed, part([featureError(EXTRUDE)])),
    "Another feature's error does not keep it alive.",
  ).toBe("outlived");
});

test("a feature error notification does not follow its feature id into another document", () => {
  const shown = { documentId: PART, featureIds: [FILLET], observed: true };
  expect(
    followFeatureErrorNotification(
      shown,
      part([featureError(FILLET)], OTHER_PART),
    ),
    "Feature ids are per document: another part's Fillet 1 is not this error.",
  ).toBe("outlived");
});

test("a warning about several features names them all and stays until none of them fails", () => {
  const CHAMFER = "feature_chamfer-2" as FeatureId;
  const warnings: { message: string; featureIds: readonly FeatureId[] }[] = [];
  announceAcceptedDocumentMutation({
    successMessage: null,
    newlyFailingFeatures: [
      { featureId: FILLET, label: "Fillet 1", blockedOnly: false },
      { featureId: CHAMFER, label: "Chamfer 2", blockedOnly: false },
    ],
    showWorkbenchInfo: () => {
      throw new Error("No info when features were left failing.");
    },
    showWorkbenchWarning: (message, featureIds) =>
      warnings.push({ message, featureIds }),
  });
  expect(warnings).toEqual([
    {
      message: "Fillet 1 and Chamfer 2 no longer rebuild: repair them or undo.",
      featureIds: [FILLET, CHAMFER],
    },
  ]);

  const shown = { documentId: PART, featureIds: [FILLET, CHAMFER], observed: true };
  expect(
    followFeatureErrorNotification(shown, part([featureError(CHAMFER)])),
    "Chamfer 2 still fails.",
  ).toBe(shown);
  expect(followFeatureErrorNotification(shown, part([]))).toBe("outlived");
});

test("a warning names the broken feature, not the later ones it only blocks, and is tied to both", () => {
  const SHELL = "feature_shell-3" as FeatureId;
  const blocked = (featureId: FeatureId): ModelingDiagnostic => ({
    ...featureError(featureId),
    code: "feature-dependency-blocked",
  });
  const after = [featureError(FILLET), blocked(SHELL)];
  const newlyFailing = findNewlyFailingFeatures(
    { diagnostics: [] },
    {
      diagnostics: after,
      features: [
        { featureId: FILLET, label: "Fillet 1" },
        { featureId: SHELL, label: "Shell 3" },
      ] as never,
    },
  );
  const warnings: { message: string; featureIds: readonly FeatureId[] }[] = [];
  const announce = (entries: typeof newlyFailing) =>
    announceAcceptedDocumentMutation({
      successMessage: "Deleted Extrude 1.",
      newlyFailingFeatures: entries,
      showWorkbenchInfo: () => {
        throw new Error("No info when features were left failing.");
      },
      showWorkbenchWarning: (message, featureIds) =>
        warnings.push({ message, featureIds }),
    });

  announce(newlyFailing);
  expect(warnings.at(-1)).toEqual({
    message: "Deleted Extrude 1. Fillet 1 no longer rebuilds: repair it or undo.",
    featureIds: [FILLET, SHELL],
  });

  announce(newlyFailing.filter((entry) => entry.featureId === SHELL));
  expect(
    warnings.at(-1)?.message,
    "A blocked feature is named when it is the only one left failing.",
  ).toBe("Deleted Extrude 1. Shell 3 no longer rebuilds: repair it or undo.");
});
