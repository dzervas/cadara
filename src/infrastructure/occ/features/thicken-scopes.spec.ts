import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { loadFilesystemOpenCascadeFactory } from "@/infrastructure/occ/filesystem-kernel-runtime";
import { createOccAuthoringState } from "@/infrastructure/occ/authoring-state";
import { trackNewSolidBody } from "@/infrastructure/occ/topology";
import { getShapeVertexPoints } from "./extrude";
import { toGpPnt } from "@/infrastructure/occ/planes";
import { executeThickenFeature } from "./thicken";
import { executeFilletFeature } from "./fillet-chamfer";
import { ADVANCED_SOLID_FEATURE_SCHEMA_VERSION } from "@/contracts/modeling/advanced-solid";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";

test("production native thicken retains positive material, boolean targets and downstream fillet geometry", async () => {
  const initialize = await loadFilesystemOpenCascadeFactory(
    fileURLToPath(new URL("../../../../public", import.meta.url)),
  );
  const oc = await initialize();
  const evidence = [];
  for (const thickness of [0.5, 2])
    for (const side of ["oneSide", "symmetric"] as const)
      for (const direction of ["positive", "negative"] as const) {
        const builder = new oc.BRepPrimAPI_MakeBox_3(
          toGpPnt(oc, [0, 0, 0]),
          20,
          10,
          10,
        );
        builder.Build(new oc.Message_ProgressRange_1());
        const source = trackNewSolidBody(oc, {
          bodyId: "body_source",
          label: "Source",
          ownerFeatureId: "feature_box",
          shape: builder.Shape(),
        });
        builder.delete();
        const top = [...source.facesById].find(([, face]) =>
          getShapeVertexPoints(oc, face).every(
            (p) => Math.abs(p[2] - 10) < 1e-5,
          ),
        )![0];
        const parameters = {
          participants: [
            {
              role: "face" as const,
              targets: [
                { kind: "face" as const, bodyId: source.bodyId, faceId: top },
              ],
            },
          ],
          options: {
            thickness: literal(thickness),
            side: literal(side),
            direction,
          },
        };
        const context = createOccAuthoringState(oc, { bodies: [source] });
        const standalone = executeThickenFeature(context, "feature_thicken", {
          kind: "thicken",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters,
        });
        const slab = standalone.bodies.find((b) => b.bodyId !== source.bodyId)!;
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.VolumeProperties_1(slab.shape, props, false, false, false);
        const volume = props.Mass();
        props.delete();
        const corner = [...slab.edgesById].find(([, edge]) =>
          getShapeVertexPoints(oc, edge).every(
            (p) => Math.abs(p[0]) < 1e-5 && Math.abs(p[1]) < 1e-5,
          ),
        )![0];
        const filleted = executeFilletFeature(
          createOccAuthoringState(oc, { bodies: standalone.bodies }),
          "feature_fillet",
          {
            edgeTargets: [
              { kind: "edge", bodyId: slab.bodyId, edgeId: corner },
            ],
            radius: literal(0.25),
          },
        );
        const rounded = filleted.bodies.find((b) => b.bodyId === slab.bodyId)!;
        const roundedProps = new oc.GProp_GProps_1();
        oc.BRepGProp.VolumeProperties_1(
          rounded.shape,
          roundedProps,
          false,
          false,
          false,
        );
        const roundedVolume = roundedProps.Mass();
        roundedProps.delete();
        expect(roundedVolume).toBeCloseTo(
          (200 - (1 - Math.PI / 4) * 0.25 ** 2) * thickness,
          5,
        );
        const result = executeThickenFeature(context, "feature_thicken", {
          kind: "thicken",
          featureTypeVersion: ADVANCED_SOLID_FEATURE_SCHEMA_VERSION,
          parameters: {
            ...parameters,
            participants: [
              ...parameters.participants,
              {
                role: "targetBody",
                targets: [{ kind: "body", bodyId: source.bodyId }],
              },
            ],
            operationIntent: literal("add"),
          },
        });
        const points = getShapeVertexPoints(oc, result.bodies[0]!.shape);
        evidence.push({
          direction,
          side,
          thickness,
          volume,
          minZ: Math.min(...points.map((p) => p[2])),
          maxZ: Math.max(...points.map((p) => p[2])),
        });
      }
  for (const row of evidence) {
    expect(row.volume, JSON.stringify(evidence)).toBeCloseTo(
      200 * row.thickness,
      5,
    );
    expect(row.minZ, JSON.stringify(evidence)).toBeCloseTo(0, 5);
    expect(row.maxZ, JSON.stringify(evidence)).toBeCloseTo(
      row.side === "symmetric"
        ? 10 + row.thickness / 2
        : row.direction === "positive"
          ? 10 + row.thickness
          : 10,
      5,
    );
  }
}, 15000);
