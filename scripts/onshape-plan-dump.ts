import { readFile } from "node:fs/promises";

import type {
  HistoryProbeTopologySignature,
  ImportCapabilities,
} from "../src/contracts/import/capabilities.ts";
import { validateOnshapeCaptureBundle } from "../src/contracts/import/onshape-capture-bundle.ts";
import type { ResolvedImportSource } from "../src/contracts/import/source.ts";
import { CONTRACT_VERSION } from "../src/contracts/shared/versioning.ts";
import {
  listPartStudios,
  readPartStudio,
} from "../src/domain/import/onshape/bundle-reader.ts";
import {
  planStudioFidelity,
  type FeaturePlan,
  type StudioPlan,
} from "../src/domain/import/onshape/fidelity-planner.ts";
import { onshapeImportProvider } from "../src/domain/import/onshape/provider.ts";

const USAGE =
  "Usage: bun run scripts/onshape-plan-dump.ts <bundle.onshape-capture.json> [elementId] [--review]";

function printPlan(
  title: string,
  plan: Pick<StudioPlan, "featurePlans" | "tierCounts" | "requiresStudioBake">,
) {
  console.log(`\n${title}`);
  console.log(
    `tiers: parametric=${plan.tierCounts.parametric} baked=${plan.tierCounts.baked} geometryOnly=${plan.tierCounts.geometryOnly}`,
  );
  console.log(`requiresStudioBake: ${plan.requiresStudioBake}`);

  const headings = ["tier", "featureType", "label", "reasonCodes"];
  const rows = plan.featurePlans.map((feature) => [
    feature.tier,
    feature.featureType,
    feature.label,
    feature.reasonCodes.join(", ") || "-",
  ]);
  const widths = headings.map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => row[index]!.length)),
  );
  const format = (row: string[]) =>
    row.map((value, index) => value.padEnd(widths[index]!)).join(" | ");

  console.log(format(headings));
  console.log(widths.map((width) => "-".repeat(width)).join("-|-"));
  for (const row of rows) console.log(format(row));
}

function sourceFromBytes(path: string, bytes: Uint8Array): ResolvedImportSource {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  return {
    name,
    origin: { kind: "localFile", fileName: name },
    mediaType: "application/json",
    bytes,
    fingerprint: `sha256:${"0".repeat(64)}`,
  };
}

function scalePoint(point: [number, number, number]): [number, number, number] {
  return [point[0] * 1000, point[1] * 1000, point[2] * 1000];
}

function createLogicLaneReviewCapabilities(
  featurePlans: FeaturePlan[],
  resolvedReferences: ReturnType<typeof readPartStudio>["studio"]["resolvedReferences"],
): ImportCapabilities {
  const signatures: HistoryProbeTopologySignature[] = resolvedReferences.flatMap(
    (entry, index) => {
      if (!("signature" in entry)) return [];
      const signature = entry.signature;
      const id = `${index}`;
      const reference =
        signature.entityClass === "body"
          ? { kind: "body" as const, bodyId: `body_review_${id}` as never }
          : signature.entityClass === "face"
            ? {
                kind: "face" as const,
                bodyId: `body_review_${id}` as never,
                faceId: `face_review_${id}` as never,
              }
            : signature.entityClass === "edge"
              ? {
                  kind: "edge" as const,
                  bodyId: `body_review_${id}` as never,
                  edgeId: `edge_review_${id}` as never,
                }
              : {
                  kind: "vertex" as const,
                  bodyId: `body_review_${id}` as never,
                  vertexId: `vertex_review_${id}` as never,
                };
      return [
        {
          ...signature,
          centroid: signature.centroid
            ? scalePoint(signature.centroid)
            : undefined,
          boundingBox: signature.boundingBox
            ? {
                low: scalePoint(signature.boundingBox.low),
                high: scalePoint(signature.boundingBox.high),
              }
            : undefined,
          reference,
        },
      ];
    },
  );

  return {
    context: {
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_onshape_plan_review",
      baseRevisionId: "rev_onshape_plan_review",
    },
    modeling: {
      async bakeGeometry() {
        throw new Error("Plan review does not bake geometry.");
      },
      async reconstructMeshToBrep() {
        throw new Error("Plan review does not reconstruct geometry.");
      },
    },
    sketch: {
      async convertVectorToSketch() {
        throw new Error("Plan review does not convert vector geometry.");
      },
    },
    assets: {
      async registerGeometryAsset() {
        throw new Error("Plan review does not register geometry assets.");
      },
      async storeEmbeddedBinary() {
        throw new Error("Plan review does not store binary assets.");
      },
    },
    history: {
      async evaluateHistoryProbe(input) {
        const count = input.actions.orderedActions?.length ?? featurePlans.length;
        return {
          steps: Array.from({ length: count }, () => ({
            status: "rebuilt" as const,
            signatures,
          })),
        };
      },
    },
  };
}

async function main() {
  const review = process.argv.includes("--review");
  const positional = process.argv.slice(2).filter((argument) => argument !== "--review");
  const [path, requestedElementId] = positional;
  if (!path || positional.length > 2) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const bytes = await readFile(path);
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  const validation = validateOnshapeCaptureBundle(raw);
  if (!validation.success) {
    console.error("Onshape capture bundle validation failed:");
    for (const issue of validation.issues) {
      console.error(`- ${issue.path || "payload"}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const bundle = validation.data;
  const studios = listPartStudios(bundle);
  if (studios.length === 0) {
    console.error("The bundle contains no Part Studios.");
    process.exitCode = 1;
    return;
  }

  let elementId = requestedElementId;
  if (!elementId) {
    elementId = studios[0]!.elementId;
    if (studios.length > 1) {
      console.log("Part Studios:");
      for (const studio of studios) {
        console.log(`- ${studio.elementId}: ${studio.name}`);
      }
      console.log(`No elementId supplied; using first studio: ${elementId}.`);
    }
  }
  if (!studios.some((studio) => studio.elementId === elementId)) {
    console.error(`Part Studio ${elementId} is not present in the bundle.`);
    process.exitCode = 1;
    return;
  }

  const read = readPartStudio(bundle, elementId);
  const plan = planStudioFidelity(read);
  console.log(`formatVersion: ${bundle.formatVersion}`);
  console.log(`studio: ${read.studio.name} (${read.studio.elementId})`);
  console.log(`rollbackSnapshots: ${read.studio.rollbackSnapshots?.length ?? 0}`);
  console.log(`resolvedReferences: ${read.studio.resolvedReferences.length}`);
  printPlan("Plain fidelity plan", plan);

  if (read.diagnostics.length > 0) {
    console.log("\nRead diagnostics:");
    for (const diagnostic of read.diagnostics) {
      console.log(`- ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  if (review) {
    const capabilities = createLogicLaneReviewCapabilities(
      plan.featurePlans,
      read.studio.resolvedReferences,
    );
    const reviewed = await onshapeImportProvider.review({
      source: sourceFromBytes(path, bytes),
      capabilities,
    });
    const reviewedStudio = reviewed.providerReview.studios.find(
      (studio) => studio.elementId === elementId,
    );
    if (!reviewedStudio) {
      throw new Error(`Provider review did not return Part Studio ${elementId}.`);
    }
    printPlan("Logic-lane review (mock kernel)", reviewedStudio);
  }
}

await main();
