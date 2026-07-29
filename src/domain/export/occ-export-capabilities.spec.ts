import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import { createOccAuthoringState } from "@/domain/modeling/occ/authoring-state";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { toGpPnt } from "@/domain/modeling/occ/planes";
import {
  trackNewSheetBody,
  trackNewSolidBody,
} from "@/domain/modeling/occ/topology";
import { createOccExportCapabilities } from "@/domain/export/occ-export-capabilities";
import { getDefaultOpenCascadeInstance } from "@/domain/modeling/occ/runtime";

type CustomOpenCascadeMainJSForTest = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

test("src/domain/export/occ-export-capabilities.spec.ts", async () => {
  async function loadCustomOpenCascadeForTest() {
    const module = (await import("../../../public/cadara-occ.js")) as {
      default: CustomOpenCascadeMainJSForTest;
    };
    const wasmBinary = new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    );

    return new module.default({ wasmBinary });
  }

  async function testMeshExportConsumesNativePayloadWithoutJsFaceTriangulation() {
    const oc = await loadCustomOpenCascadeForTest();
    const builder = new oc.BRepPrimAPI_MakeBox_3(
      toGpPnt(oc, [0, 0, 0]),
      1,
      2,
      3,
    );
    builder.Build(new oc.Message_ProgressRange_1());
    expect(
      builder.IsDone(),
      "Expected OCC box builder to produce a test export body.",
    ).toBeTruthy();

    const body = trackNewSolidBody(oc, {
      bodyId: "body_native_mesh_export" as BodyId,
      label: "Native mesh export body",
      ownerFeatureId: "feature_native_mesh_export" as FeatureId,
      shape: builder.Shape(),
    });
    const state = createOccAuthoringState(oc, { bodies: [body] });
    const originalTriangulation = oc.BRep_Tool.Triangulation;
    let triangulationCallCount = 0;

    oc.BRep_Tool.Triangulation = (() => {
      triangulationCallCount += 1;
      throw new Error(
        "Mesh export must use the native payload builder, not JS face triangulation.",
      );
    }) as typeof originalTriangulation;

    try {
      const capabilities = createOccExportCapabilities(state);
      const result = await capabilities.mesh.tessellate(
        { kind: "body", bodyId: body.bodyId },
        {
          chordTolerance: 0.1,
          angleToleranceRadians: 0.5,
        },
      );

      expect(
        Array.isArray(result),
        "Native OCC mesh export should return tessellated triangles.",
      ).toBeTruthy();
      if (!Array.isArray(result)) {
        return;
      }

      expect(
        triangulationCallCount,
        "Native OCC mesh export must not call the JS BRep_Tool.Triangulation binding.",
      ).toBe(0);
      expect(
        result.length,
        "Native box mesh export should produce twelve triangles.",
      ).toBe(12);
      expect(
        result.every(
          (triangle) =>
            triangle.vertices.length === 3 && triangle.normal.length === 3,
        ),
        "Native mesh export triangles should include three vertices and a derived normal.",
      ).toBeTruthy();
    } finally {
      oc.BRep_Tool.Triangulation = originalTriangulation;
      builder.delete?.();
    }
  }

  function createSheetExportBody(oc: OpenCascadeInstance) {
    const polygon = new oc.BRepBuilderAPI_MakePolygon_1();

    for (const point of [
      [0, 0, 0],
      [2, 0, 0],
      [2, 3, 0],
    ] as const) {
      polygon.Add_1(toGpPnt(oc, point));
    }

    expect(
      polygon.IsDone(),
      "Expected the open test polygon to build a wire for sheet export.",
    ).toBeTruthy();

    const prism = new oc.BRepPrimAPI_MakePrism_1(
      polygon.Wire(),
      new oc.gp_Vec_4(0, 0, 1),
      false,
      true,
    );
    prism.Build(new oc.Message_ProgressRange_1());
    expect(
      prism.IsDone(),
      "Expected OCC to sweep the open wire into a sheet export body.",
    ).toBeTruthy();

    const sheet = trackNewSheetBody(oc, {
      bodyId: "body_sheet_export" as BodyId,
      label: "Sheet export body",
      ownerFeatureId: "feature_sheet_export" as FeatureId,
      shape: prism.Shape(),
    });
    expect(
      sheet.bodyKind,
      "Sheet export fixtures must be tracked as sheet bodies.",
    ).toBe("sheet");

    return sheet;
  }

  async function testSheetBodyMeshExportStaysShapeAgnostic() {
    const oc = await loadCustomOpenCascadeForTest();
    const sheet = createSheetExportBody(oc);
    const capabilities = createOccExportCapabilities(
      createOccAuthoringState(oc, { bodies: [sheet] }),
    );
    const triangles = await capabilities.mesh.tessellate(
      { kind: "body", bodyId: sheet.bodyId },
      { chordTolerance: 0.1, angleToleranceRadians: 0.5 },
    );

    expect(
      Array.isArray(triangles) && triangles.length > 0,
      "Native mesh export must tessellate sheet bodies through the same shape-agnostic path as solids.",
    ).toBeTruthy();
  }

  async function testSheetBodyStepExportStaysShapeAgnostic() {
    const oc = await getDefaultOpenCascadeInstance();
    const sheet = createSheetExportBody(oc);
    const capabilities = createOccExportCapabilities(
      createOccAuthoringState(oc, { bodies: [sheet] }),
    );
    const stepResult = capabilities.brep.writeStep(
      { kind: "body", bodyId: sheet.bodyId },
      { schema: "AP242", unit: "millimeter" },
    );

    expect(
      "payload" in stepResult,
      "STEP export must accept sheet bodies without body-kind branching.",
    ).toBeTruthy();
    if ("payload" in stepResult) {
      expect(
        stepResult.payload.includes("ISO-10303-21"),
        "Sheet body STEP export should emit a STEP part 21 payload.",
      ).toBeTruthy();
    }
  }

  await testMeshExportConsumesNativePayloadWithoutJsFaceTriangulation();
  await testSheetBodyMeshExportStaysShapeAgnostic();
  await testSheetBodyStepExportStaysShapeAgnostic();
});
