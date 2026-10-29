// Logic lane (docs/testing.md), heavy tier: the production OCC adapter over
// the landing enclosure. Seam: a fillet/chamfer inserted mid-history (the
// native transaction path) and the cursor rolled forward over a face sketch
// and an edge feature authored against the topology before the insert. A
// fillet/chamfer trims the faces and edges next to its edge and leaves the
// rest untouched; every one of them must keep its durable id, so the face
// sketch stays placed and the later edge feature still resolves its edges.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { FeatureId, SketchId } from "@/contracts/shared/ids";
import {
  authored,
  occInstance,
  open,
  runtimeBodies,
  shownModel,
  type Session,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

const bodyId = "body_feature_extrude-7";
const edge = (hash: string) => ({
  kind: "edge" as const,
  bodyId,
  edgeId: `edge_${bodyId}_${hash}`,
});
const chamfer = (hashes: readonly string[], distance: number) =>
  ({
    featureTypeVersion: "advanced-solid-feature/v0",
    kind: "chamfer",
    parameters: {
      options: {
        distance: { source: "literal", value: distance },
        widthForm: { source: "literal", value: "equalOffsets" },
      },
      participants: [{ role: "edge", targets: hashes.map(edge) }],
    },
  }) as unknown as FeatureDefinition;
const fillet = (hashes: readonly string[], radius: number) =>
  ({
    featureTypeVersion: "feature-type/fillet/v1alpha1",
    kind: "fillet",
    parameters: {
      edgeTargets: hashes.map(edge),
      radius: { source: "literal", value: radius },
    },
  }) as unknown as FeatureDefinition;

/** The enclosure's lid-seat top face, z = height. */
const topFaceId = `face_${bodyId}_gef2a23e5a5c4891a`;
const topZ = 32;
const faceSketchId = "sketch_inserted-local-operation-top-face" as SketchId;
const laterFeatureId = "feature_inserted-local-operation-later" as FeatureId;

/**
 * The landing enclosure followed by an empty face sketch on the top face and
 * `later`, an edge feature on edges of the same body, both authored before
 * the insert.
 */
async function enclosureWithLaterItems(later: FeatureDefinition) {
  const source = JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/enclosure/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;
  const template = source.sketches[0]!.definition;
  const emptyDefinition = {
    ...template,
    ...Object.fromEntries(
      Object.entries(template).flatMap(([key, value]) =>
        Array.isArray(value) ? [[key, []]] : [],
      ),
    ),
  } as AuthoredModelDocument["sketches"][number]["definition"];
  const document: AuthoredModelDocument = {
    ...source,
    sketches: [
      ...source.sketches,
      {
        sketchId: faceSketchId,
        label: "Top face",
        plane: {
          support: { kind: "face", bodyId, faceId: topFaceId },
          frame: {
            handedness: "rightHanded",
            linearUnit: "documentLength",
            origin: [0, 0, topZ],
            normal: [0, 0, 1],
            xAxis: [1, 0, 0],
            yAxis: [0, 1, 0],
          },
          key: null,
        },
        definition: emptyDefinition,
      },
    ] as AuthoredModelDocument["sketches"],
    features: [
      ...source.features,
      {
        featureId: laterFeatureId,
        label: "Later edge feature",
        suppressed: false,
        definition: later,
      },
    ],
    featureOrder: [...source.featureOrder, laterFeatureId],
    historyOrder: [
      ...source.historyOrder,
      { kind: "sketch", sketchId: faceSketchId },
      { kind: "feature", featureId: laterFeatureId },
    ],
    cursor: { kind: "feature", featureId: laterFeatureId },
  };
  const lastSourceFeature = source.featureOrder.at(-1)!;
  return { document, lastSourceFeature };
}

/** Surface type and centroid of every face of the body, by durable id. */
async function faceGeometry(session: Session) {
  const oc = await occInstance();
  const body = runtimeBodies(session).find((entry) => entry.bodyId === bodyId)!;
  const geometry = new Map<string, { type: unknown; centroid: number[] }>();
  for (const [faceId, face] of body.facesById) {
    const properties = new oc.GProp_GProps_1();
    const surface = new oc.BRepAdaptor_Surface_2(face, true);
    try {
      oc.BRepGProp.SurfaceProperties_1(face, properties, false, false);
      const centre = properties.CentreOfMass();
      geometry.set(faceId, {
        type: surface.GetType(),
        centroid: [centre.X(), centre.Y(), centre.Z()],
      });
      centre.delete();
    } finally {
      properties.delete();
      surface.delete();
    }
  }
  return { geometry, edgeIds: new Set<string>(body.topology.edgeIds) };
}

/**
 * The authored document with its lineage records sorted by feature. A session
 * appends an inserted feature's record, a cold open lists records in history
 * order; restores key the records by feature, so their order carries nothing.
 */
const lineageInFeatureOrder = (document: AuthoredModelDocument) =>
  authored(
    {
      ...document,
      topologyLineage: document.topologyLineage?.toSorted((left, right) =>
        left.featureId.localeCompare(right.featureId),
      ),
    },
    "exact",
  );

const diagnosticSummary = async (session: Session) =>
  (await session.snapshot()).document.diagnostics.map(
    (diagnostic) => `${diagnostic.code} ${JSON.stringify(diagnostic.target)}`,
  );

test.each([
  {
    name: "chamfer",
    // Top/front edge. It trims the top face, the front wall and the top edge
    // gd30004 that meets it; the later chamfer takes that trimmed edge and an
    // edge it leaves untouched.
    inserted: chamfer(["g4161b03398d80fed"], 1),
    insertedEdge: "g4161b03398d80fed",
    later: chamfer(["gd30004b73ffaab56", "ged7e14844daf017d"], 0.5),
  },
  {
    name: "fillet",
    // Top edge gd30004; it trims the two edges ga5c900 and g64da13 that meet
    // it, which the later chamfer takes.
    inserted: fillet(["gd30004b73ffaab56"], 1),
    insertedEdge: "gd30004b73ffaab56",
    later: chamfer(["ga5c900fae180c494", "g64da13d3c1ae469c"], 0.5),
  },
])(
  "a $name inserted before a face sketch and an edge feature keeps the ids of the faces and edges it trims or leaves untouched, cold-equivalent",
  async ({ inserted, insertedEdge, later }) => {
    const { document, lastSourceFeature } =
      await enclosureWithLaterItems(later);
    const session = await open(document);
    try {
      expect(
        await diagnosticSummary(session),
        "premise: the later items apply before the insert",
      ).toEqual([]);
      await session.setCursor({
        kind: "feature",
        featureId: lastSourceFeature,
      });
      const before = await faceGeometry(session);
      expect(before.geometry.has(topFaceId), "premise: the sketch's face").toBe(
        true,
      );

      await session.create(inserted);
      const after = await faceGeometry(session);
      expect(
        [...before.edgeIds].filter((edgeId) => !after.edgeIds.has(edgeId)),
        "only the filleted/chamfered edge leaves the body",
      ).toEqual([edge(insertedEdge).edgeId]);
      for (const [faceId, { type, centroid }] of before.geometry) {
        const successor = after.geometry.get(faceId);
        expect(successor?.type, `${faceId} keeps its id`).toEqual(type);
        // A trimmed face loses at most a 1 mm strip; no two faces of this
        // body have centroids within 1.5 mm of each other.
        successor!.centroid.forEach((coordinate, axis) =>
          expect(
            Math.abs(coordinate - centroid[axis]!),
            `${faceId} names the same face`,
          ).toBeLessThan(1),
        );
      }

      await session.setCursor({ kind: "feature", featureId: laterFeatureId });
      expect(
        await diagnosticSummary(session),
        "the face sketch stays placed and the later feature resolves its edges",
      ).toEqual([]);
      const sketch = (await session.snapshot()).document.sketches.find(
        (entry) => entry.sketchId === faceSketchId,
      )!;
      expect(sketch.plane.support).toEqual({
        kind: "face",
        bodyId,
        faceId: topFaceId,
      });
      expect(sketch.plane.frame.origin[2]).toBeCloseTo(topZ, 6);

      const exported = await session.exported();
      const cold = await open(exported);
      try {
        expect(
          shownModel(await session.snapshot()),
          "the session evaluates the same model as a cold open",
        ).toEqual(shownModel(await cold.snapshot()));
        expect(
          lineageInFeatureOrder(exported),
          "and exports the same authored document and lineage",
        ).toEqual(lineageInFeatureOrder(await cold.exported()));
      } finally {
        cold.adapter.dispose();
      }
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);
