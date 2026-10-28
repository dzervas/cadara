// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing bracket. A feature that keeps faces of
// its input body shares them with the previous body, and those faces still
// carry the triangulation of the last display tier that meshed them. The
// identity payloads a suffix rebuild builds for its tracked bodies (topology.ts
// buildNativeTopologyPayloadForTrackedBody) must not depend on that display
// history: the same edit after viewing at the fine tier builds the same
// payloads as after viewing at the startup tier, mesh included.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { OccTessellationTierId } from "@/contracts/modeling/tessellation";
import type { FeatureId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import type { OpenCascadeNativeTopologyKernelHost } from "@/infrastructure/occ/native-topology-payload";
import {
  occInstance,
  open,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

const bracket = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/bracket/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

/**
 * The identity payloads (the tracked-body budget, 0.1 mm / 0.5 rad) built
 * while deleting a mid-history feature, after showing the model at `tier`.
 */
async function identityPayloadsOfMidDelete(
  source: AuthoredModelDocument,
  tier: OccTessellationTierId,
) {
  const session = await open(source);
  const host = (await occInstance()) as unknown as Required<
    Pick<
      OpenCascadeNativeTopologyKernelHost,
      "CadaraBuildNativeTopologyPayload"
    >
  >;
  const builder = host.CadaraBuildNativeTopologyPayload;
  const buildJson = builder.BuildJson!;
  const payloads: { bodyId: string; triangles: number; payload: string }[] = [];
  try {
    await session.adapter.refineSnapshotLod(
      { contractVersion: CONTRACT_VERSION, documentId: source.documentId },
      tier,
    );
    await session.snapshot();
    builder.BuildJson = (shape, bodyId, token, linear, angular) => {
      const payload = buildJson(shape, bodyId, token, linear, angular);
      if (linear === 0.1 && angular === 0.5) {
        payloads.push({
          bodyId,
          triangles: (
            JSON.parse(payload) as { mesh: { triangleCount: number } }
          ).mesh.triangleCount,
          payload,
        });
      }
      return payload;
    };
    await session.deleteFeature(source.features[4]!.featureId as FeatureId);
    return payloads;
  } finally {
    builder.BuildJson = buildJson;
    session.adapter.dispose();
  }
}

test("a suffix rebuild's identity payloads do not depend on the display tier its kept faces were meshed at", async () => {
  const source = await bracket();
  const afterStartup = await identityPayloadsOfMidDelete(source, "startup");
  const afterFine = await identityPayloadsOfMidDelete(source, "fine");

  expect(
    afterStartup.length,
    "premise: the rebuild tracks bodies",
  ).toBeGreaterThan(0);
  expect(
    afterFine.map(({ bodyId, triangles }) => ({ bodyId, triangles })),
  ).toEqual(
    afterStartup.map(({ bodyId, triangles }) => ({ bodyId, triangles })),
  );
  expect(afterFine).toEqual(afterStartup);
}, 600_000);
