import type {
  ExportProvider,
  ExportProviderInput,
} from "@/contracts/export/provider";
import type { ExportResult } from "@/contracts/export/result";
import type {
  SketchVectorEntity,
  SketchVectorExportModel,
} from "@/contracts/export/sketch-vector";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import {
  tessellateCubicSpans,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";

export type DxfSketchExportOptions = Record<string, never>;

function dxfPair(code: number, value: string | number) {
  return `${code}\n${value}`;
}

function angleDegrees(center: SketchPoint2D, point: SketchPoint2D) {
  const degrees =
    (Math.atan2(point[1] - center[1], point[0] - center[0]) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** Output-only polyline of cubic poles through the one owner tessellator. */
function tessellateCubics(
  spans: readonly SplinePoles[],
  steps: number,
): readonly SketchPoint2D[] {
  return tessellateCubicSpans(
    spans.map((poles) => ({ interval: [0, 1] as const, poles })),
    steps,
  );
}

/** The exact degree elevation of a quadratic Bézier to a cubic. */
function elevateQuadratic([
  start,
  control,
  end,
]: readonly SketchPoint2D[]): SplinePoles {
  const toward = (from: SketchPoint2D): SketchPoint2D => [
    from[0] + (2 / 3) * (control![0] - from[0]),
    from[1] + (2 / 3) * (control![1] - from[1]),
  ];
  return [start!, toward(start!), toward(end!), end!];
}

function lineEntity(start: SketchPoint2D, end: SketchPoint2D) {
  return [
    dxfPair(0, "LINE"),
    dxfPair(8, "SKETCH"),
    dxfPair(10, start[0]),
    dxfPair(20, start[1]),
    dxfPair(30, 0),
    dxfPair(11, end[0]),
    dxfPair(21, end[1]),
    dxfPair(31, 0),
  ];
}

function polylineEntity(points: readonly SketchPoint2D[]) {
  if (points.length < 2) {
    return [];
  }

  return [
    dxfPair(0, "LWPOLYLINE"),
    dxfPair(8, "SKETCH"),
    dxfPair(90, points.length),
    dxfPair(70, 0),
    ...points.flatMap((point) => [
      dxfPair(10, point[0]),
      dxfPair(20, point[1]),
    ]),
  ];
}

function entityToDxf(entity: SketchVectorEntity): string[] {
  if (entity.isConstruction) {
    return [];
  }

  switch (entity.kind) {
    case "lineSegment":
      return lineEntity(entity.start, entity.end);
    case "circle":
      return [
        dxfPair(0, "CIRCLE"),
        dxfPair(8, "SKETCH"),
        dxfPair(10, entity.center[0]),
        dxfPair(20, entity.center[1]),
        dxfPair(30, 0),
        dxfPair(40, entity.radius),
      ];
    case "arc": {
      const startAngle = angleDegrees(entity.center, entity.start);
      const endAngle = angleDegrees(entity.center, entity.end);
      return [
        dxfPair(0, "ARC"),
        dxfPair(8, "SKETCH"),
        dxfPair(10, entity.center[0]),
        dxfPair(20, entity.center[1]),
        dxfPair(30, 0),
        dxfPair(40, entity.radius),
        dxfPair(
          50,
          entity.sweepDirection === "counterClockwise" ? startAngle : endAngle,
        ),
        dxfPair(
          51,
          entity.sweepDirection === "counterClockwise" ? endAngle : startAngle,
        ),
      ];
    }
    case "spline":
      return polylineEntity(tessellateCubics(entity.spans, 24));
    case "bezierCurve":
      return polylineEntity(
        entity.degree === 3 && entity.controlPoints.length >= 4
          ? tessellateCubics(
              [
                [
                  entity.controlPoints[0]!,
                  entity.controlPoints[1]!,
                  entity.controlPoints[2]!,
                  entity.controlPoints[3]!,
                ],
              ],
              24,
            )
          : tessellateCubics([elevateQuadratic(entity.controlPoints)], 16),
      );
    case "conic":
      return polylineEntity(
        tessellateCubics(
          [elevateQuadratic([entity.start, entity.control, entity.end])],
          16,
        ),
      );
  }
}

function serializeDxf(model: SketchVectorExportModel): ExportResult {
  const entityLines = model.entities.flatMap(entityToDxf);

  if (entityLines.length === 0) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "sketch-dxf-empty-export",
          severity: "error",
          message:
            "DXF export could not produce any supported sketch geometry.",
          target: { kind: "sketch", sketchId: model.sketchId },
        },
        ...model.diagnostics,
      ],
    };
  }

  const lines = [
    dxfPair(0, "SECTION"),
    dxfPair(2, "HEADER"),
    dxfPair(9, "$INSUNITS"),
    dxfPair(70, 4),
    dxfPair(0, "ENDSEC"),
    dxfPair(0, "SECTION"),
    dxfPair(2, "ENTITIES"),
    ...entityLines,
    dxfPair(0, "ENDSEC"),
    dxfPair(0, "EOF"),
  ];

  return {
    ok: true,
    payload: lines.join("\n"),
    diagnostics: [...model.diagnostics],
  };
}

export const dxfSketchExportProvider: ExportProvider<
  DxfSketchExportOptions,
  FeatureEditorFormSchema
> = {
  id: "sketch-dxf",
  label: "DXF",
  formatId: "dxf",
  fileExtension: "dxf",
  mimeType: "application/dxf",
  targetKinds: ["sketch"],

  getDefaultOptions(): DxfSketchExportOptions {
    return {};
  },

  getOptionFormSchema(): FeatureEditorFormSchema {
    return { sections: [] };
  },

  applyOptionPatch(options: DxfSketchExportOptions): DxfSketchExportOptions {
    return options;
  },

  async export(
    input: ExportProviderInput<DxfSketchExportOptions>,
  ): Promise<ExportResult> {
    const result =
      await input.capabilities.sketchVector.resolveSketchVectorModel(
        input.target,
      );

    if ("diagnostic" in result) {
      return { ok: false, diagnostics: [result.diagnostic] };
    }

    return serializeDxf(result);
  },
};
