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
import { normalizeOnshapeTopologySignature } from "../src/domain/import/onshape/topology-signature-normalizer.ts";

const USAGE =
  "Usage: bun run scripts/onshape-plan-dump.ts <bundle.onshape-capture.json> [elementId] [--review]";

function printPlan(
  title: string,
  plan: Pick<StudioPlan, "featurePlans" | "tierCounts" | "requiresStudioBake"> &
    Partial<Pick<StudioPlan, "bakeStrategy" | "bakeDiagnostics">>,
) {
  console.log(`\n${title}`);
  console.log(
    `tiers: parametric=${plan.tierCounts.parametric} baked=${plan.tierCounts.baked} geometryOnly=${plan.tierCounts.geometryOnly}`,
  );
  console.log(`requiresStudioBake: ${plan.requiresStudioBake}`);
  if (plan.bakeStrategy) {
    const checkpointCount = plan.bakeStrategy.kind === "segments"
      ? plan.bakeStrategy.segments.length
      : 0;
    console.log(`bakeStrategy: ${plan.bakeStrategy.kind}`);
    console.log(`checkpointCount: ${checkpointCount}`);
    if (plan.bakeStrategy.kind === "wholeStudioLegacy") {
      console.log(`legacyReason: ${plan.bakeStrategy.reason}`);
    }
    if (plan.bakeStrategy.kind === "segments") {
      for (const segment of plan.bakeStrategy.segments) {
        console.log(
          `segment ${segment.segmentId}: ${segment.fromFeatureId} -> ${segment.boundaryFeatureId}` +
            ` outputs=[${segment.checkpointBodyDeterministicIds.join(",")}]` +
            ` consumed=[${segment.consumedBodyDeterministicIds.join(",")}]` +
            ` carried=[${segment.carriedBodyDeterministicIds.join(",")}]` +
            ` replaces=[${segment.replacementProducerFeatureIds.join(",")}]`,
        );
      }
    }
    for (const diagnostic of plan.bakeDiagnostics ?? []) {
      console.log(`segmentDiagnostic: ${diagnostic.code}: ${diagnostic.message}`);
    }
  }

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

function readPoint3(value: unknown): [number, number, number] | null {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === "number")
    ? [value[0] as number, value[1] as number, value[2] as number]
    : null;
}

function normalizeVector(
  value: readonly [number, number, number],
): [number, number, number] | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1e-12) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function mockXAxisForNormal(normal: readonly [number, number, number]): [number, number, number] | null {
  const seed: [number, number, number] = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const seedDotNormal = seed[0] * normal[0] + seed[1] * normal[1] + seed[2] * normal[2];
  return normalizeVector([
    seed[0] - normal[0] * seedDotNormal,
    seed[1] - normal[1] * seedDotNormal,
    seed[2] - normal[2] * seedDotNormal,
  ]);
}

function rollbackBodySignatures(
  snapshots: ReturnType<typeof readPartStudio>["studio"]["rollbackSnapshots"],
): HistoryProbeTopologySignature[] {
  const signatures = new Map<string, HistoryProbeTopologySignature>();
  for (const snapshot of snapshots ?? []) {
    const bodies = (snapshot.tessellatedFaces as {
      bodies?: Array<{
        id?: string;
        faces?: Array<{
          facets?: Array<{ vertices?: Array<{ x: number; y: number; z: number }> }>;
        }>;
      }>;
    }).bodies ?? [];
    for (const body of bodies) {
      if (!body.id) continue;
      const vertices = (body.faces ?? []).flatMap((face) =>
        (face.facets ?? []).flatMap((facet) => facet.vertices ?? []),
      );
      if (vertices.length === 0) continue;
      const low: [number, number, number] = [Infinity, Infinity, Infinity];
      const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      const centroid: [number, number, number] = [0, 0, 0];
      for (const vertex of vertices) {
        const point = [vertex.x, vertex.y, vertex.z] as const;
        for (const axis of [0, 1, 2] as const) {
          low[axis] = Math.min(low[axis], point[axis]);
          high[axis] = Math.max(high[axis], point[axis]);
          centroid[axis] += point[axis];
        }
      }
      for (const axis of [0, 1, 2] as const) centroid[axis] /= vertices.length;
      const normalizedLow = scalePoint(low);
      const normalizedHigh = scalePoint(high);
      const normalizedCentroid = scalePoint(centroid);
      const key = JSON.stringify([body.id, normalizedLow, normalizedHigh, normalizedCentroid]);
      signatures.set(key, {
        entityClass: "body",
        geometryType: "solid",
        boundingBox: { low: normalizedLow, high: normalizedHigh },
        centroid: normalizedCentroid,
        reference: {
          kind: "body",
          bodyId: `body_review_${body.id}_${signatures.size}` as never,
        },
      });
    }
  }
  return [...signatures.values()];
}

function createLogicLaneReviewCapabilities(
  featurePlans: FeaturePlan[],
  resolvedReferences: ReturnType<typeof readPartStudio>["studio"]["resolvedReferences"],
  rollbackSnapshots: ReturnType<typeof readPartStudio>["studio"]["rollbackSnapshots"],
): ImportCapabilities {
  const nonBodySignatures: HistoryProbeTopologySignature[] = resolvedReferences.flatMap(
    (entry, index) => {
      if (!("signature" in entry) || entry.signature.entityClass === "body") return [];
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
      const normalized = normalizeOnshapeTopologySignature(signature);
      const normal = signature.entityClass === "face" && signature.geometryType === "plane"
        ? normalizeVector(readPoint3(signature.definingData?.normal) ?? [0, 0, 0])
        : null;
      const xDirection = normal ? mockXAxisForNormal(normal) : null;
      return [
        {
          ...normalized,
          definingData: xDirection
            ? { ...normalized.definingData, xDirection }
            : normalized.definingData,
          reference,
        },
      ];
    },
  );
  const featureIndexById = new Map(
    featurePlans.map((plan, index) => [plan.onshapeFeatureId, index]),
  );
  const topologyConsumerIndexes = featurePlans.flatMap((plan, index) =>
    (plan.plannedBodyTopologyConsumer?.slots.length ?? 0) > 0 ||
    (plan.plannedExtrude?.topologySlots.length ?? 0) > 0
      ? [index]
      : [],
  );
  let topologyProbeIndex = 0;

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
        const nextConsumerIndex = input.includeFinalTessellation === false
          ? topologyConsumerIndexes[topologyProbeIndex++] ?? -1
          : -1;
        const boundarySnapshot = nextConsumerIndex < 0
          ? rollbackSnapshots?.at(-1)
          : [...(rollbackSnapshots ?? [])].reverse().find((snapshot) =>
              (featureIndexById.get(snapshot.featureId) ?? Infinity) < nextConsumerIndex,
            );
        const signatures = [
          ...rollbackBodySignatures(boundarySnapshot ? [boundarySnapshot] : []),
          ...nonBodySignatures,
        ];
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
  const plan = planStudioFidelity(read, {
    captureFormatVersion: bundle.formatVersion,
    historyProbeAvailable: true,
  });
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
      read.studio.rollbackSnapshots,
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
    printPlan("Logic-lane review (rollback-prefix evidence)", reviewedStudio);
  }
}

await main();
