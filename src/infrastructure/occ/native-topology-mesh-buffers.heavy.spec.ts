// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing models. The adapter's display path
// builds each body's payload with CadaraNativeTopologyMeshBuffers when the
// kernel has it; on every body shape that path meshed, at every display tier,
// the mesh-buffer payload must equal BuildJson's: topology records, counts,
// triangle indices and face ids exactly, positions and deflections within
// BuildJson's 6-significant-digit text rounding (one unit in the 6th
// significant digit; scripts/occ/topology-mesh-buffers-conformance.mjs
// states and checks the bound). Red with "assets predate ..." until
// public/cadara-occ is rebuilt from the current occ-native-shims.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import {
  getNativeTopologyDisplayPayloadBuilder,
  type OpenCascadeNativeTopologyMeshBuffersHost,
} from "@/infrastructure/occ/native-topology-mesh-buffers";
import {
  parseNativeShimPayloadJson,
  type OccNativeShimPayload,
  type OpenCascadeNativeTopologyKernelHost,
} from "@/infrastructure/occ/native-topology-payload";
import {
  occInstance,
  open,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

type DisplayBuild = Parameters<
  NonNullable<
    NonNullable<
      OpenCascadeNativeTopologyMeshBuffersHost["CadaraNativeTopologyMeshBuffers"]
    >["Build"]
  >
>;

/** The payload with its mesh arrays as BuildJson prints them (triples). */
function asBuildJsonShape(payload: OccNativeShimPayload) {
  const triples = (values: ArrayLike<number> | undefined) =>
    values &&
    Array.from({ length: values.length / 3 }, (_, index) => [
      values[index * 3]!,
      values[index * 3 + 1]!,
      values[index * 3 + 2]!,
    ]);
  return payload.mesh
    ? {
        ...payload,
        mesh: {
          ...payload.mesh,
          positions: triples(payload.mesh.positions),
          triangleIndices: triples(payload.mesh.triangleIndices),
        },
      }
    : payload;
}

const landingModel = async (name: string) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../landing/examples/${name}/model.cadara`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

test.each(["bracket", "wheel", "enclosure"])(
  "the mesh-buffer display payload equals BuildJson's on every body of the landing %s",
  async (name) => {
    const { compareMeshBuffersPayload } = (await import(
      new URL(
        "../../../scripts/occ/topology-mesh-buffers-conformance.mjs",
        import.meta.url,
      ).href
    )) as {
      compareMeshBuffersPayload(json: unknown, buffers: unknown): string[];
    };
    const source = await landingModel(name);
    const session = await open(source);
    try {
      const host = (await occInstance()) as unknown as Required<
        Pick<
          OpenCascadeNativeTopologyKernelHost,
          "CadaraBuildNativeTopologyPayload"
        >
      > &
        OpenCascadeNativeTopologyMeshBuffersHost & {
          BRepTools: { Clean(shape: unknown, force: boolean): void };
        };
      const meshBuffers = host.CadaraNativeTopologyMeshBuffers;
      expect(
        typeof meshBuffers?.Build,
        "CadaraNativeTopologyMeshBuffers.Build: assets predate the mesh-buffer builder (cadara-dx2k.10)",
      ).toBe("function");
      const build = meshBuffers!.Build!;
      const displayBuilds: DisplayBuild[] = [];
      try {
        meshBuffers!.Build = (...args) => {
          displayBuilds.push(args);
          return build(...args);
        };
        for (const tier of ["normal", "fine"] as const) {
          await session.adapter.refineSnapshotLod(
            {
              contractVersion: CONTRACT_VERSION,
              documentId: source.documentId,
            },
            tier,
          );
        }
        await session.snapshot();
      } finally {
        meshBuffers!.Build = build;
      }

      expect(
        displayBuilds.length,
        "premise: the display path meshed bodies with the mesh-buffer builder",
      ).toBeGreaterThan(0);
      const displayPayload = getNativeTopologyDisplayPayloadBuilder(host)!;
      const results = displayBuilds.map(
        ([shape, bodyId, topologyToken, linear, angular]) => {
          // Each builder meshes a freshly cleaned shape.
          host.BRepTools.Clean(shape, true);
          const json = parseNativeShimPayloadJson(
            host.CadaraBuildNativeTopologyPayload.BuildJson!(
              shape,
              bodyId,
              topologyToken,
              linear,
              angular,
            ),
          );
          host.BRepTools.Clean(shape, true);
          const buffers = displayPayload(
            shape,
            bodyId,
            topologyToken,
            linear,
            angular,
          );
          return {
            bodyId,
            linear,
            angular,
            triangles: json.mesh?.triangleCount ?? 0,
            mismatches: compareMeshBuffersPayload(
              asBuildJsonShape(json),
              asBuildJsonShape(buffers),
            ),
          };
        },
      );

      expect(
        results.reduce((sum, result) => sum + result.triangles, 0),
        "premise: the bodies have display meshes",
      ).toBeGreaterThan(0);
      expect(results.filter((result) => result.mismatches.length > 0)).toEqual(
        [],
      );
    } finally {
      session.adapter.dispose();
    }
  },
  600_000,
);
