// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing models. A shell with a Boolean
// operation builds its tool through CadaraNativeToolBodyTransaction when the
// kernel has it; the tool's payload then carries only validation diagnostics.
// The Boolean re-identifies the output body, so the shell preview and the
// created feature must be identical to the full-payload transaction's:
// diagnostics, render geometry digests, bodies, references and features.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { BodyId, FaceId } from "@/contracts/shared/ids";
import { SHELL_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { OpenCascadeNativeTopologyKernelHost } from "@/infrastructure/occ/native-topology-payload";
import {
  evaluatedModel,
  occInstance,
  open,
  previewModel,
  runtimeBodies,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

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

/** The bench's shell: thickness 1 inside, intersected with its own body. */
const shellOf = (bodyId: BodyId, faceId: FaceId): FeatureDefinition => ({
  kind: "shell",
  featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
  parameters: {
    bodyTarget: { kind: "body", bodyId },
    faceTargets: [{ kind: "face", bodyId, faceId }],
    thickness: createLiteralAuthoredValue(1),
    operation: createLiteralAuthoredValue("intersect" as const),
    direction: "inside",
    booleanScope: { kind: "targetBody", bodyId },
  },
});

/**
 * The model with each body's topology id lists sorted: the inside shell plus
 * intersect does not reproduce its subshape map order from one evaluation to
 * the next, with either payload; the ids themselves are canonical.
 */
const withSortedTopologyIds = (model: ReturnType<typeof evaluatedModel>) => ({
  ...model,
  bodies: model.bodies.map((body) => ({
    ...body,
    topology: {
      ...body.topology,
      faceIds: [...body.topology.faceIds].sort(),
      edgeIds: [...body.topology.edgeIds].sort(),
      vertexIds: [...body.topology.vertexIds].sort(),
    },
  })),
});

const hasError = (preview: { diagnostics: readonly { severity: string }[] }) =>
  preview.diagnostics.some((diagnostic) => diagnostic.severity === "error");

test.each(["bracket", "wheel", "enclosure"])(
  "%s shell with a tool-body payload previews and creates exactly like the full payload",
  async (name) => {
    const document = await landingModel(name);
    const probe = await open(document);
    const toolBody = (
      (await occInstance()) as unknown as OpenCascadeNativeTopologyKernelHost
    ).CadaraNativeToolBodyTransaction;
    expect(
      typeof toolBody?.BuildShellWithHistory,
      "CadaraNativeToolBodyTransaction.BuildShellWithHistory is missing: assets predate the tool-body transaction (cadara-dx2k.20)",
    ).toBe("function");
    const body = runtimeBodies(probe)[0]!;
    let definition: FeatureDefinition | null = null;
    for (const faceId of body.topology.faceIds.slice(0, 12)) {
      const candidate = shellOf(body.bodyId, faceId);
      if (!hasError(await probe.preview(candidate, null))) {
        definition = candidate;
        break;
      }
    }
    probe.adapter.dispose();
    expect(definition, "premise: a clean shell preview").not.toBeNull();

    const builder = toolBody!.BuildShellWithHistory!;
    let toolBodyCalls = 0;
    const evaluate = async (withToolBody: boolean) => {
      toolBody!.BuildShellWithHistory = withToolBody
        ? (...args) => {
            toolBodyCalls += 1;
            return builder(...args);
          }
        : undefined;
      try {
        const session = await open(document);
        const preview = previewModel(await session.preview(definition!, null));
        await session.create(definition!);
        const created = withSortedTopologyIds(
          evaluatedModel(await session.snapshot()),
        );
        session.adapter.dispose();
        return { preview, created };
      } finally {
        toolBody!.BuildShellWithHistory = builder;
      }
    };

    const full = await evaluate(false);
    expect(toolBodyCalls).toBe(0);
    const tool = await evaluate(true);
    expect(
      toolBodyCalls,
      "the preview builds the tool once; the create adopts the preview's evaluation",
    ).toBe(1);
    expect(tool.preview).toEqual(full.preview);
    expect(tool.created).toEqual(full.created);
  },
  600_000,
);
