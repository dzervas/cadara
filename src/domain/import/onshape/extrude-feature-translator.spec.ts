import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import { validateOnshapeCaptureBundle } from "@/contracts/import/onshape-capture-bundle";
import { readPartStudio } from "@/domain/import/onshape/bundle-reader";
import { planStudioFidelity } from "@/domain/import/onshape/fidelity-planner";

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

    const plan = planStudioFidelity(readPartStudio(validation.data, ELEMENT_ID));
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
