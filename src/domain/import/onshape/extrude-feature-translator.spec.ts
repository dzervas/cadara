import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import { validateOnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import { planStudioFidelity } from "@/domain/import/onshape/fidelity-planner";
import {
  IMPORT_VERIFICATION_DOCUMENT_ID,
  IMPORT_VERIFICATION_REVISION_ID,
} from "@/domain/import/onshape/profile-resolver";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const profileVerifier = {
  sketchSolver: new SketchConstraintSolverAdapter({
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    documentId: IMPORT_VERIFICATION_DOCUMENT_ID,
    revisionId: IMPORT_VERIFICATION_REVISION_ID,
  }),
  modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
  angularToleranceRadians: OCC_KERNEL_SETTINGS.angularToleranceRadians,
};

const BUNDLE_PATH =
  "test/fixtures/onshape-captures/405fa226bb150016d09afc09.onshape-capture.json";
const ELEMENT_ID = "6869c89206c7a4bb97bd9129";

test.skipIf(!existsSync(BUNDLE_PATH))(
  "real Wave-T extent studio resolves every certified profile witness",
  async () => {
    const validation = validateOnshapeCaptureBundle(
      JSON.parse(await readFile(BUNDLE_PATH, "utf8")),
    );
    expect(validation.success).toBe(true);
    if (!validation.success) return;

    const plan = await planStudioFidelity(readPartStudio(validation.data, ELEMENT_ID), { profileVerifier });
    expect(plan.tierCounts).toEqual({ parametric: 6, baked: 0, geometryOnly: 0 });

    const twoSide = plan.featurePlans.find(
      (feature) => feature.label === "Two side extrude",
    );
    expect(twoSide).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
    });

    const upToNext = plan.featurePlans.find(
      (feature) => feature.label === "Up to next extrude",
    );
    expect(upToNext).toMatchObject({
      tier: "parametric",
      reasonCodes: [],
    });
  },
);
