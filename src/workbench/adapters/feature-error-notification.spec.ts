import { expect, test } from "vitest";

import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { DocumentId, FeatureId } from "@/contracts/shared/ids";
import { followFeatureErrorNotification } from "./feature-error-notification";

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
  const shown = { documentId: PART, featureId: FILLET, observed: false };

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
  const shown = { documentId: PART, featureId: FILLET, observed: false };
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
  const shown = { documentId: PART, featureId: FILLET, observed: true };
  expect(
    followFeatureErrorNotification(
      shown,
      part([featureError(FILLET)], OTHER_PART),
    ),
    "Feature ids are per document: another part's Fillet 1 is not this error.",
  ).toBe("outlived");
});
