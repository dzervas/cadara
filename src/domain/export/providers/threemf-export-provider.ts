import { strToU8, zipSync } from "fflate";

import type {
  ExportCapabilities,
  MeshTriangle,
} from "@/contracts/export/capabilities";
import type {
  ExportProvider,
  ExportProviderInput,
  ExportProviderResult,
} from "@/contracts/export/provider";
import type { ExportResult } from "@/contracts/export/result";
import type { BodyAppearance } from "@/contracts/modeling/body-appearance";
import { resolveBodyAppearanceHex } from "@/contracts/modeling/body-appearance";
import type { DurableRef } from "@/contracts/shared/references";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";

import { requireGeometryExportOptions } from "@/contracts/export/options.runtime-schema";
import type { ThreeMfExportOptions } from "@/contracts/export/options";
export type { ThreeMfExportOptions } from "@/contracts/export/options";
export type ThreeMfMeshAccuracyOptions = import("@/contracts/export/capabilities").MeshExportAccuracy;

function getDefaultThreeMfMeshAccuracy(): ThreeMfMeshAccuracyOptions {
  return { chordTolerance: 0.05, angleToleranceRadians: 0.1 };
}

function formatXmlNumber(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(6)));
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type MeshPoint = readonly [number, number, number];

const THREEMF_MATERIAL_NAMESPACE =
  "http://schemas.microsoft.com/3dmanufacturing/material/2015/02";
const BODY_COLOR_GROUP_ID = 2;

/*
 * The body colour is written as a Materials & Properties extension colour
 * group referenced by the object's pid/pindex, because that is the encoding
 * the slicers actually import (checked 2026-10-21):
 * - Bambu Studio reads `m:colorgroup`/`m:color` plus object/triangle
 *   pid/pindex from non-Bambu 3MFs, maps each colour to a filament and offers
 *   the colour-mapping dialog; it has no `basematerials` handling at all:
 *   https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/src/libslic3r/Format/bbs_3mf.cpp#L2229-L2365
 *   https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/src/slic3r/GUI/Plater.cpp#L8889-L8893
 * - OrcaSlicer (same importer lineage) reads `m:colorgroup` and assigns the
 *   object's extruder from its pid; no `basematerials` either:
 *   https://github.com/SoftFever/OrcaSlicer/blob/857896dc6b3fdfbf5cebc5057bde5a179a29b1ba/src/libslic3r/Format/bbs_3mf.cpp#L2186-L2310
 * - PrusaSlicer parses object pid/pindex but its `basematerials` branch is
 *   commented out and it knows no colour group, so it ignores both:
 *   https://github.com/prusa3d/PrusaSlicer/blob/30ef59195e0f3ee6f270b185bb5f9fb5f349f81f/src/slic3r-shared/src/Slic3r/Biz/Format/3mf/Model3mf.cpp#L834-L842
 * - Cura's 3MF reader reads no colours.
 * Core `basematerials` (displaycolor) would be honoured by none of them, and
 * an object has a single pid, so only the colour group is written. Both
 * Bambu and Orca match the literal `m:` prefix, so it must stay `m`. The
 * extension is not listed in `requiredextensions`: the colour is optional for
 * consumers. Specs: 3MF Core 1.4.0 (CT_Resources puts extension resources before
 * objects; ST_ColorValue `#RRGGBB[AA]` sRGB) and Materials & Properties 1.2.1
 * chapter 2:
 * https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md
 * https://github.com/3MFConsortium/spec_materials/blob/master/3MF%20Materials%20Extension.md
 */
function createBodyColorGroupXml(appearance: BodyAppearance) {
  const color = resolveBodyAppearanceHex(appearance).toUpperCase();
  return `<m:colorgroup id="${BODY_COLOR_GROUP_ID}"><m:color color="${color}"/></m:colorgroup>`;
}

function createThreeMfModelXml(
  triangles: readonly MeshTriangle[],
  targetLabel: string,
  targetAppearance: BodyAppearance | null,
  includeMetadata: boolean,
) {
  const vertices: string[] = [];
  const triangleElements: string[] = [];
  const vertexIndicesByKey = new Map<string, number>();

  function getVertexIndex(vertex: MeshPoint) {
    const x = formatXmlNumber(vertex[0]);
    const y = formatXmlNumber(vertex[1]);
    const z = formatXmlNumber(vertex[2]);
    const key = `${x},${y},${z}`;
    const existing = vertexIndicesByKey.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const index = vertices.length;

    vertexIndicesByKey.set(key, index);
    vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`);

    return index;
  }

  triangles.forEach((triangle) => {
    const [first, second, third] = triangle.vertices.map(getVertexIndex);
    triangleElements.push(
      `<triangle v1="${first}" v2="${second}" v3="${third}"/>`,
    );
  });

  const metadata = includeMetadata
    ? `<metadata name="Title">${escapeXml(targetLabel)}</metadata>`
    : "";

  const colorReference = targetAppearance
    ? ` pid="${BODY_COLOR_GROUP_ID}" pindex="0"`
    : "";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="${THREEMF_MATERIAL_NAMESPACE}">`,
    metadata,
    "<resources>",
    targetAppearance ? createBodyColorGroupXml(targetAppearance) : "",
    `<object id="1" type="model"${colorReference}>`,
    "<mesh>",
    "<vertices>",
    vertices.join(""),
    "</vertices>",
    "<triangles>",
    triangleElements.join(""),
    "</triangles>",
    "</mesh>",
    "</object>",
    "</resources>",
    "<build>",
    '<item objectid="1"/>',
    "</build>",
    "</model>",
  ].join("");
}

function writeThreeMfPackage(
  triangles: readonly MeshTriangle[],
  targetLabel: string,
  targetAppearance: BodyAppearance | null,
  includeMetadata: boolean,
) {
  const xml = createThreeMfModelXml(
    triangles,
    targetLabel,
    targetAppearance,
    includeMetadata,
  );

  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
          '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
          "</Types>",
        ].join(""),
      ),
      "_rels/.rels": strToU8(
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
          '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
          "</Relationships>",
        ].join(""),
      ),
      "3D/3dmodel.model": strToU8(xml),
    },
    { level: 0 },
  );
}

function exportThreeMf(
  target: DurableRef,
  targetLabel: string,
  targetAppearance: BodyAppearance | null,
  options: ThreeMfExportOptions,
  capabilities: ExportCapabilities,
): Promise<ExportResult> {
  return Promise.resolve(
    capabilities.mesh.tessellate(target, options.meshAccuracy),
  ).then((result) => {
    if (!Array.isArray(result)) {
      return { ok: false, diagnostics: [result] };
    }

    const triangles = result;

    if (triangles.length === 0) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "export-empty-mesh",
            severity: "error",
            message:
              "3MF export could not produce triangles for the selected body.",
            target,
          },
        ],
      };
    }

    return {
      ok: true,
      payload: writeThreeMfPackage(
        triangles,
        targetLabel,
        targetAppearance,
        options.includeMetadata,
      ),
      diagnostics: [],
    };
  });
}

export const threeMfExportProvider: ExportProvider<
  ThreeMfExportOptions,
  FeatureEditorFormSchema
> = {
  id: "3mf",
  label: "3MF",
  formatId: "3mf",
  validateOptions: (options) => requireGeometryExportOptions("3mf", options),
  fileExtension: "3mf",
  mimeType: "model/3mf",
  targetKinds: ["body"],

  getDefaultOptions(): ThreeMfExportOptions {
    return {
      meshAccuracy: getDefaultThreeMfMeshAccuracy(),
      unit: "millimeter",
      includeMetadata: true,
    };
  },

  getOptionFormSchema(options: ThreeMfExportOptions): FeatureEditorFormSchema {
    return {
      sections: [
        {
          id: "mesh-accuracy",
          title: "Mesh accuracy",
          fields: [
            {
              kind: "numeric",
              id: "chordTolerance",
              label: "Chord tolerance",
              value: options.meshAccuracy.chordTolerance,
              input: "number",
              step: 0.005,
              patch: { patchKey: "meshAccuracy.chordTolerance" },
            },
            {
              kind: "numeric",
              id: "angleToleranceRadians",
              label: "Angle tolerance",
              value: options.meshAccuracy.angleToleranceRadians,
              input: "number",
              step: 0.01,
              patch: { patchKey: "meshAccuracy.angleToleranceRadians" },
            },
            {
              kind: "enum",
              id: "unit",
              label: "Unit",
              value: options.unit,
              options: [{ value: "millimeter", label: "Millimeter" }],
              patch: { patchKey: "unit" },
            },
            {
              kind: "custom",
              id: "includeMetadata",
              label: "Include metadata",
              rendererId: "checkbox",
              payload: {
                checked: options.includeMetadata,
                patchKey: "includeMetadata",
              },
            },
          ],
        },
      ],
    };
  },

  applyOptionPatch(
    options: ThreeMfExportOptions,
    patch: Record<string, unknown>,
  ): ThreeMfExportOptions {
    let current = { ...options, meshAccuracy: { ...options.meshAccuracy } };

    if (typeof patch["meshAccuracy.chordTolerance"] === "number") {
      current.meshAccuracy.chordTolerance =
        patch["meshAccuracy.chordTolerance"];
    }

    if (typeof patch["meshAccuracy.angleToleranceRadians"] === "number") {
      current.meshAccuracy.angleToleranceRadians =
        patch["meshAccuracy.angleToleranceRadians"];
    }

    if (patch["unit"] === "millimeter") {
      current = { ...current, unit: patch["unit"] };
    }

    if (typeof patch["includeMetadata"] === "boolean") {
      current = { ...current, includeMetadata: patch["includeMetadata"] };
    }

    return current;
  },

  export(
    input: ExportProviderInput<ThreeMfExportOptions>,
  ): ExportProviderResult {
    return exportThreeMf(
      input.target,
      input.targetLabel,
      input.targetAppearance,
      input.options,
      input.capabilities,
    );
  },
};
