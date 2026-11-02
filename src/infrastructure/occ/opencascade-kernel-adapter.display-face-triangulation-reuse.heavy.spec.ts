// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing enclosure. Seam: evaluatePreview then
// createFeature of a chamfer or fillet at the history tail. The display
// payload of the previewed body puts back the display triangulations its
// parent's faces had, so only the faces the operation changed are meshed.
// The preview must equal the same preview on a session that never meshed the
// parent (every face meshed), and the committed model must equal a cold open,
// with exact topology tokens and identical render geometry.
import { expect, test, vi } from "vitest";

// Counts the faces whose display triangulation a payload build reused;
// `off` restores none, so a reference payload meshes every face.
const reusedFaces = vi.hoisted(() => ({ count: 0, off: false }));
vi.mock(
  "@/infrastructure/occ/display-face-triangulations",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/infrastructure/occ/display-face-triangulations")
      >();
    return {
      ...actual,
      restoreDisplayFaceTriangulations: (
        ...args: Parameters<typeof actual.restoreDisplayFaceTriangulations>
      ) => {
        if (reusedFaces.off) return 0;
        const restored = actual.restoreDisplayFaceTriangulations(...args);
        reusedFaces.count += restored;
        return restored;
      },
    };
  },
);

import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { BodyId, EdgeId } from "@/contracts/shared/ids";

import {
  expectColdEquivalent,
  loadLandingModel,
  open,
  previewModel,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

const edgeTarget = (bodyId: BodyId, edgeId: EdgeId) => ({
  kind: "edge" as const,
  bodyId,
  edgeId,
});
const definitions = {
  chamfer: (bodyId: BodyId, edgeId: EdgeId) =>
    ({
      featureTypeVersion: "advanced-solid-feature/v0",
      kind: "chamfer",
      parameters: {
        options: {
          distance: { source: "literal", value: 0.25 },
          widthForm: { source: "literal", value: "equalOffsets" },
        },
        participants: [{ role: "edge", targets: [edgeTarget(bodyId, edgeId)] }],
      },
    }) as unknown as FeatureDefinition,
  fillet: (bodyId: BodyId, edgeId: EdgeId) =>
    ({
      featureTypeVersion: "feature-type/fillet/v1alpha1",
      kind: "fillet",
      parameters: {
        edgeTargets: [edgeTarget(bodyId, edgeId)],
        radius: { source: "literal", value: 0.25 },
      },
    }) as unknown as FeatureDefinition,
};

test.each(["chamfer", "fillet"] as const)(
  "a tail %s preview on the landing enclosure meshes only its changed faces and commits a model equal to a cold open",
  async (kind) => {
    const source = await loadLandingModel("enclosure");
    const session = await open(source);
    try {
      const body = (await session.snapshot()).document.bodies[0]!;
      const faceCount = body.topology.faceIds.length;
      // The first edge the operation accepts at this size.
      let definition: FeatureDefinition | null = null;
      for (const edgeId of body.topology.edgeIds) {
        const candidate = definitions[kind](body.bodyId, edgeId);
        const preview = await session.preview(candidate, null);
        if (!preview.diagnostics.some((d) => d.severity === "error")) {
          definition = candidate;
          break;
        }
      }
      expect(definition, `an edge of ${body.bodyId} takes a ${kind}`).not.toBe(
        null,
      );

      reusedFaces.count = 0;
      const preview = await session.preview(definition!, null);
      expect(preview.diagnostics.filter((d) => d.severity === "error")).toEqual(
        [],
      );
      expect(
        reusedFaces.count,
        `the ${kind} preview reuses the display meshes of the faces it kept`,
      ).toBeGreaterThan(faceCount / 2);

      reusedFaces.off = true;
      const full = await open(source);
      try {
        const fullPreview = await full.preview(definition!, null);
        expect(
          previewModel(preview),
          `the ${kind} preview with reused face meshes equals one meshing every face`,
        ).toEqual(previewModel(fullPreview));
      } finally {
        reusedFaces.off = false;
        full.adapter.dispose();
      }

      await session.create(definition!);
      await expectColdEquivalent(
        session,
        await session.exported(),
        `${kind} committed after its preview`,
        "exact",
      );
    } finally {
      session.adapter.dispose();
    }
  },
  600_000,
);
