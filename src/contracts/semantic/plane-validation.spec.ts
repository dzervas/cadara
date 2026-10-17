import { expect, test } from "vitest";
import { validateSemanticCommand } from "./runtime-schema";

test("planes accept only canonical coplanar and explicit-frame create/update contracts", () => {
  const frame = {
    linearUnit: "documentLength",
    handedness: "rightHanded",
    origin: [3, 4, 5],
    xAxis: [0, 1, 0],
    yAxis: [0, 0, 1],
    normal: [1, 0, 0],
  };
  for (const operation of ["plane.create", "plane.update"]) {
    const command = {
      version: 1,
      commandId: operation,
      operation,
      basis: {
        documentId: "doc_part",
        revisionId: "rev_1",
        repositoryHeads: [],
      },
      intent: "fulfill",
      ...(operation.endsWith("update") ? { featureId: "feature_plane" } : {}),
    };
    for (const parameters of [
      { mode: "explicitFrame", frame },
      {
        mode: "coplanar",
        reference: {
          target: {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
        },
      },
      {
        mode: "coplanar",
        reference: {
          target: { kind: "face", bodyId: "body_part", faceId: "face_top" },
        },
      },
    ])
      expect(validateSemanticCommand({ ...command, parameters }).success).toBe(
        true,
      );
    for (const parameters of [
      { mode: "offset", distance: 3 },
      { mode: "explicitFrame", frame: { ...frame, normal: [1, 0] } },
      {
        mode: "coplanar",
        reference: { target: { kind: "body", bodyId: "body_part" } },
      },
      {
        mode: "coplanar",
        reference: {
          target: {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
        },
        offset: 3,
      },
    ])
      expect(validateSemanticCommand({ ...command, parameters }).success).toBe(
        false,
      );
  }
});
