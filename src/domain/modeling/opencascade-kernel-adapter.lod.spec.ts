// Logic lane: actual adapter snapshots of tracked curved bodies using shipped
// OCC, not tier-enum policy or the stock package's different native bindings.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import {
  FIXTURE_SKETCH_ID,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  CONTRACT_VERSION,
  EXTRUDE_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import type { RenderPoint3D } from "@/contracts/render/schema";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { getOccTessellationTier } from "@/domain/modeling/occ/tessellation";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const request = {
  contractVersion: CONTRACT_VERSION,
  documentId: "doc_workspace",
} as const;

// Measure the sagitta of actual base-cap boundary chords, not the nominal
// deflection. Ignore interior diagonals and side triangles of the cylinder.
function rimMetrics(
  positions: readonly RenderPoint3D[],
  triangles: readonly (readonly [number, number, number])[],
) {
  const edges = new Map<
    string,
    { a: RenderPoint3D; b: RenderPoint3D; count: number }
  >();
  for (const triangle of triangles) {
    if (!triangle.every((index) => Math.abs(positions[index]![2]) < 1e-8))
      continue;
    for (let i = 0; i < 3; i++) {
      const a = triangle[i]!;
      const b = triangle[(i + 1) % 3]!;
      const key = [a, b].sort((x, y) => x - y).join(":");
      const edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { a: positions[a]!, b: positions[b]!, count: 1 });
    }
  }
  const rim = [...edges.values()].filter(
    ({ a, b, count }) =>
      count === 1 &&
      Math.abs(Math.hypot(a[0], a[1]) - 10) < 1e-5 &&
      Math.abs(Math.hypot(b[0], b[1]) - 10) < 1e-5,
  );
  return {
    rimSegments: rim.length,
    chordError: Math.max(
      0,
      ...rim.map(
        ({ a, b }) => 10 - Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
      ),
    ),
  };
}

for (const profile of ["circle", "split diameter"] as const) {
  for (const mode of ["committed", "snapshot"] as const) {
    test(`${mode} LOD refines the same tracked ${profile} body without changing topology`, async () => {
      const module =
        (await import("../../../public/cadara-occ.js")) as unknown as {
          default: new (
            options: Record<string, unknown>,
          ) => Promise<OpenCascadeInstance>;
        };
      const oc = await new module.default({
        wasmBinary: new Uint8Array(
          await readFile(
            new URL("../../../public/cadara-occ.wasm", import.meta.url),
          ),
        ),
      });
      const adapter = new OpenCascadeKernelAdapter({
        getOpenCascadeInstance: async () => oc,
        createSolverAdapter: (revisionId) =>
          new SketchConstraintSolverAdapter({
            revisionId,
            neutralCurveQueries:
              createCertifiedNeutralCurveQueryCapabilityForTest(),
          }),
      });
      try {
        const fixture = makeSketchFixture();
        fixture.point("center", 0, 0);
        if (profile === "circle") {
          fixture.circle("rim", "center", 10);
        } else {
          // The two collinear diameter edges bound distinct tracked side faces.
          // Re-running committed-shape preparation would unify them during a
          // display read; the native snapshot builder must retain both instead.
          fixture.point("start", 10, 0);
          fixture.point("end", -10, 0);
          fixture.arc("rim", "center", "start", "end", "counterClockwise");
          fixture.line("diameterLeft", "end", "center");
          fixture.line("diameterRight", "center", "start");
        }
        const initial = await adapter.getDocumentSnapshot(request);
        const sketch = await adapter.commitSketch({
          ...request,
          baseRevisionId: initial.snapshot.document.revisionId,
          solverCorrelation: {
            requestId: "request_lod",
            projectionRequestId: "request_lod:project",
            validationRequestId: "request_lod:validate",
            solveRequestId: "request_lod:solve",
            regionRequestId: "request_lod:regions",
          },
          sketchId: FIXTURE_SKETCH_ID,
          restoreRecordedSketchId: true,
          sketchLabel: "Cylinder profile",
          plane: createStandardPlaneDefinition("xy"),
          definition: fixture.build().definition,
        });
        expect(
          sketch.revisionState.kind,
          JSON.stringify(sketch.diagnostics),
        ).toBe("accepted");
        const afterSketch = (await adapter.getDocumentSnapshot(request))
          .snapshot.document;
        const published = afterSketch.sketches[0]!;
        const created = await adapter.createFeature({
          ...request,
          baseRevisionId: afterSketch.revisionId,
          definition: {
            kind: "extrude",
            featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
            parameters: {
              resultBodyType: "solid",
              profiles: [
                {
                  kind: "region",
                  sketchId: published.sketchId,
                  regionId: published.sketch.regions[0]!.regionId,
                },
              ],
              startExtent: { kind: "profilePlane" },
              extent: {
                mode: "oneSide",
                end: {
                  kind: "blind",
                  direction: "positive",
                  distance: { source: "literal", value: 5 },
                },
              },
              operation: { source: "literal", value: "newBody" },
              booleanScope: { kind: "standalone" },
            },
          },
        });
        expect(created.revisionState.kind).toBe("accepted");
        const authoredBefore = await adapter.exportAuthoredModelDocument(
          request.documentId,
        );
        const read = async (tierId: "startup" | "normal" | "fine") => {
          adapter.setSnapshotLodTier(tierId);
          if (mode === "committed") {
            const result = await adapter.buildNativeTopologySnapshot(
              request,
              tierId,
            );
            if (result.kind !== "nativeTopologyPayload")
              throw new Error(JSON.stringify(result));
            expect(result.payload.lodTierId).toBe(tierId);
            const body = result.payload.bodies[0]!;
            const mesh = body.renderMeshSummary!;
            expect(mesh.linearDeflection).toBeCloseTo(
              getOccTessellationTier(tierId).linearDeflectionModelUnits,
              12,
            );
            expect(mesh.angularDeflection).toBeCloseTo(
              getOccTessellationTier(tierId).angularDeflectionRadians,
              5,
            );
            return {
              triangles: mesh.triangleIndices!,
              ...rimMetrics(mesh.positions!, mesh.triangleIndices!),
              topology: body.topology,
              identity: body.identity,
              adjacency: body.adjacency,
            };
          }
          const snapshot = (await adapter.getDocumentSnapshot(request)).snapshot
            .document;
          const records = snapshot.render.records.filter(
            (record) => record.ownerBodyId && record.geometry.kind === "mesh",
          );
          const rims = records.map((record) =>
            record.geometry.kind === "mesh"
              ? rimMetrics(
                  record.geometry.vertexPositions,
                  record.geometry.triangleIndices,
                )
              : { chordError: 0, rimSegments: 0 },
          );
          return {
            triangles: records.flatMap((record) =>
              record.geometry.kind === "mesh"
                ? record.geometry.triangleIndices
                : [],
            ),
            chordError: Math.max(...rims.map((rim) => rim.chordError)),
            rimSegments: rims.reduce((sum, rim) => sum + rim.rimSegments, 0),
            topology: snapshot.bodies,
            identity: records.map((record) => record.binding),
            adjacency: null,
          };
        };
        const startup = await read("startup");
        const normal = await read("normal");
        const fine = await read("fine");
        if (profile === "circle") {
          expect([
            startup.rimSegments,
            normal.rimSegments,
            fine.rimSegments,
          ]).toEqual([26, 90, 360]);
        }
        expect(startup.triangles.length).toBeGreaterThan(0);
        expect(normal.triangles.length).toBeGreaterThan(
          startup.triangles.length,
        );
        expect(fine.triangles.length).toBeGreaterThan(normal.triangles.length);
        expect(fine.chordError).toBeGreaterThan(0);
        expect(normal.chordError).toBeLessThan(startup.chordError);
        expect(fine.chordError).toBeLessThan(normal.chordError);
        for (const result of [normal, fine]) {
          expect(result.topology).toEqual(startup.topology);
          expect(result.identity).toEqual(startup.identity);
          expect(result.adjacency).toEqual(startup.adjacency);
        }
        // Revisit coarser tiers after fine: cached arrays must retain their own
        // accuracy, not depend on whichever triangulation the shape has now.
        expect(await read("startup")).toEqual(startup);
        expect(await read("normal")).toEqual(normal);
        expect(await read("fine")).toEqual(fine);
        expect(
          await adapter.exportAuthoredModelDocument(request.documentId),
        ).toEqual(authoredBefore);
      } finally {
        adapter.dispose();
      }
    });
  }
}
