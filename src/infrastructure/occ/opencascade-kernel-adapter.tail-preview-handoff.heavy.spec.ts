// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing enclosure and bracket. Seam:
// evaluatePreview then createFeature of a new extrude or sweep at the history
// tail, counting feature executions; preview and create must agree on
// rejection, and a committed session must equal a cold open of its export
// with exact topology tokens.
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

// Counts feature executions without retaining their (large) arguments.
const featureRuns = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/infrastructure/occ/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infrastructure/occ/features")>();
  return {
    ...actual,
    executeOccFeature: (
      ...args: Parameters<typeof actual.executeOccFeature>
    ) => {
      featureRuns.count += 1;
      return actual.executeOccFeature(...args);
    },
  };
});

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { BodyId, EdgeId, FaceId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { sweepAuthoringDefinition } from "@/core/feature-authoring/features/sweep";
import { enrichExtrudeRegionProfiles } from "@/core/modeling/region-profile-selection";

import {
  expectColdEquivalent,
  open,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

const loadEnclosure = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/enclosure/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

// A preview of a new feature at the history tail evaluates the record its
// create commits, with the region selectors the modeling service adds to that
// create, so the create of the previewed definition adopts the preview's
// evaluation and runs no feature (on the enclosure a join of the tail extrude
// took as long again as its preview). A create of anything else runs it.
test.each([
  ["the previewed definition", 1],
  ["another depth", 2],
] as const)(
  "a create of %s after a tail extrude preview on the landing enclosure runs the feature %i time(s) in all and equals a cold open (cadara-dx2k.7)",
  async (_committed, runs) => {
    const source = await loadEnclosure();
    const session = await open(source);
    try {
      const bosses = source.features.find(
        (feature) => feature.featureId === "feature_extrude-3",
      )!.definition;
      const bossSketch = source.sketches.find((sketch) =>
        JSON.stringify(bosses).includes(`"${sketch.sketchId}"`),
      )!;
      const sketchId = await session.commitSketch({
        label: "Tail bosses",
        plane: bossSketch.plane,
        definition: bossSketch.definition,
      });
      const regionIds = (await session.snapshot()).document.sketches
        .find((sketch) => sketch.sketchId === sketchId)!
        .sketch.regions.filter((region) => region.isClosed)
        .map((region) => region.regionId);
      const extrude = (distance: number) => {
        const definition = structuredClone(bosses) as unknown as {
          parameters: {
            operation: unknown;
            profiles: unknown[];
            extent: { end: { distance: unknown } };
          };
        };
        definition.parameters.profiles = regionIds.map((regionId) => ({
          kind: "region",
          sketchId,
          regionId,
        }));
        definition.parameters.extent.end.distance = {
          source: "literal",
          value: distance,
        };
        return definition as unknown as FeatureDefinition;
      };
      expect(
        [
          regionIds.length,
          (bosses.parameters as { operation: unknown }).operation,
        ],
        "premise: the tail extrude joins the bosses' regions to the shell",
      ).toEqual([4, { source: "literal", value: "join" }]);

      featureRuns.count = 0;
      const preview = await session.preview(extrude(4), null);
      expect(
        preview.diagnostics.filter(({ severity }) => severity === "error"),
        "premise: the tail extrude previews cleanly",
      ).toEqual([]);
      expect(
        preview.render.records.length,
        "premise: the preview renders the feature",
      ).toBeGreaterThan(0);
      // The modeling service enriches a create's region profiles from the
      // document snapshot it reads.
      const committed = enrichExtrudeRegionProfiles(
        extrude(runs === 1 ? 4 : 5),
        (await session.snapshot()).document.sketches,
      );
      await session.create(committed);
      expect(featureRuns.count, "the preview and the create").toBe(runs);
      await expectColdEquivalent(
        session,
        await session.exported(),
        "committed tail extrude",
        "exact",
      );
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);

const loadBracket = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/bracket/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

/** A new-body sweep of `faceId` of `bodyId` along `edgeId` of the same body. */
const faceAlongEdgeSweep = (bodyId: BodyId, faceId: FaceId, edgeId: EdgeId) =>
  sweepAuthoringDefinition.buildDefinition(
    sweepAuthoringDefinition.applySelection(
      sweepAuthoringDefinition.applySelection(
        sweepAuthoringDefinition.createDraft({ selectedTarget: null }),
        { kind: "face", bodyId, faceId },
      ),
      { kind: "edge", bodyId, edgeId },
    ),
  ) as FeatureDefinition;

const errorsOf = <TDiagnostic extends { severity: string }>(
  diagnostics: readonly TDiagnostic[],
) => diagnostics.filter(({ severity }) => severity === "error");

// A sweep's preview and its create evaluate the same record, so they agree:
// native validation rejects an invalid sweep result (here the bracket's first
// face swept along its first edge) in both, with the same message, and the
// create leaves the document as it was. The create used to skip that
// validation for sweep bodies and commit the invalid solid the preview had
// rejected (cadara-rk64). The codes differ by path for every advanced
// feature: a preview reports any failure as
// advanced-feature-unsupported-kernel-case, a create as occ-rebuild-failure.
test("an invalid sweep is rejected by its tail preview and by its create with the same message (cadara-rk64)", async () => {
  const source = await loadBracket();
  const session = await open(source);
  try {
    const before = await session.snapshot();
    const body = before.document.bodies[0]!;
    const sweep = faceAlongEdgeSweep(
      body.bodyId,
      body.topology.faceIds[0]!,
      body.topology.edgeIds[0]!,
    );

    const preview = await session.preview(sweep, null);
    const previewErrors = errorsOf(preview.diagnostics);
    expect(
      previewErrors.map(({ message }) => message),
      "the preview rejects the invalid sweep",
    ).toEqual([
      "Native topology payload for tracked solid body body_feature_sweep-1 is not releasable: Native OCC validation rejected the committed solid shape.",
    ]);
    expect(preview.render.records, "and renders nothing").toEqual([]);

    const created = await session.adapter.createFeature({
      contractVersion: CONTRACT_VERSION,
      documentId: source.documentId,
      baseRevisionId: before.document.revisionId,
      definition: sweep,
    });
    expect(created.revisionState.kind, "the create rejects it too").toBe(
      "rejected",
    );
    expect(
      errorsOf(created.diagnostics).map(({ message }) => message),
      "with the preview's message",
    ).toEqual(previewErrors.map(({ message }) => message));
    const after = await session.snapshot();
    expect(
      [after.document.revisionId, after.document.features.length],
      "the document is unchanged",
    ).toEqual([before.document.revisionId, before.document.features.length]);
  } finally {
    session.adapter.dispose();
  }
}, 900_000);

// A valid sweep at the history tail takes the same handoff as an extrude:
// its create adopts the preview's evaluation (cadara-rk64 re-enabled sweeps
// on the cadara-dx2k.7 path once the preview and the create agreed).
test("a create of a previewed tail sweep on the bracket adopts the preview's evaluation and equals a cold open (cadara-rk64)", async () => {
  const source = await loadBracket();
  const session = await open(source);
  try {
    const body = (await session.snapshot()).document.bodies[0]!;
    const faceId = body.topology.faceIds[0]!;
    let sweep: FeatureDefinition | null = null;
    for (const edgeId of body.topology.edgeIds) {
      const candidate = faceAlongEdgeSweep(body.bodyId, faceId, edgeId);
      const preview = await session.preview(candidate, null);
      if (
        errorsOf(preview.diagnostics).length === 0 &&
        preview.render.records.length > 0
      ) {
        sweep = candidate;
        break;
      }
    }
    expect(sweep, "premise: some edge sweeps the face validly").not.toBeNull();

    featureRuns.count = 0;
    const preview = await session.preview(sweep!, null);
    expect(errorsOf(preview.diagnostics), "premise: it previews").toEqual([]);
    await session.create(sweep!);
    expect(featureRuns.count, "the preview and the create").toBe(1);
    await expectColdEquivalent(
      session,
      await session.exported(),
      "committed tail sweep",
      "exact",
    );
  } finally {
    session.adapter.dispose();
  }
}, 900_000);
