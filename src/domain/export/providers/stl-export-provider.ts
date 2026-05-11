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
import type { DurableRef } from "@/contracts/shared/references";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";

export interface StlMeshAccuracyOptions {
  chordTolerance: number;
  angleToleranceRadians: number;
}

export interface StlExportOptions {
  meshAccuracy: StlMeshAccuracyOptions;
  encoding: "binary" | "ascii";
}

function getDefaultStlMeshAccuracy(): StlMeshAccuracyOptions {
  return { chordTolerance: 0.05, angleToleranceRadians: 0.1 };
}

function writeAsciiStl(triangles: readonly MeshTriangle[]) {
  const lines = ["solid cadara"];

  for (const triangle of triangles) {
    lines.push(
      `  facet normal ${triangle.normal[0]} ${triangle.normal[1]} ${triangle.normal[2]}`,
    );
    lines.push("    outer loop");

    for (const vertex of triangle.vertices) {
      lines.push(`      vertex ${vertex[0]} ${vertex[1]} ${vertex[2]}`);
    }

    lines.push("    endloop");
    lines.push("  endfacet");
  }

  lines.push("endsolid cadara");

  return lines.join("\n");
}

function writeBinaryStl(triangles: readonly MeshTriangle[]) {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  const header = new TextEncoder().encode("cadara binary stl export");

  bytes.set(header.slice(0, 80), 0);
  view.setUint32(80, triangles.length, true);

  let offset = 84;

  for (const triangle of triangles) {
    for (const value of triangle.normal) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }

    for (const vertex of triangle.vertices) {
      for (const value of vertex) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }

    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return bytes;
}

function exportStl(
  target: DurableRef,
  options: StlExportOptions,
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
              "STL export could not produce triangles for the selected body.",
            target,
          },
        ],
      };
    }

    const payload =
      options.encoding === "ascii"
        ? writeAsciiStl(triangles)
        : writeBinaryStl(triangles);

    return { ok: true, payload, diagnostics: [] };
  });
}

export const stlExportProvider: ExportProvider<
  StlExportOptions,
  FeatureEditorFormSchema
> = {
  id: "stl",
  label: "STL",
  formatId: "stl",
  fileExtension: "stl",
  mimeType: "model/stl",
  targetKinds: ["body"],

  getDefaultOptions(): StlExportOptions {
    return {
      meshAccuracy: getDefaultStlMeshAccuracy(),
      encoding: "binary",
    };
  },

  getOptionFormSchema(options: StlExportOptions): FeatureEditorFormSchema {
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
              id: "encoding",
              label: "Encoding",
              value: options.encoding,
              options: [
                { value: "binary", label: "Binary" },
                { value: "ascii", label: "ASCII" },
              ],
              patch: { patchKey: "encoding" },
            },
          ],
        },
      ],
    };
  },

  applyOptionPatch(
    options: StlExportOptions,
    patch: Record<string, unknown>,
  ): StlExportOptions {
    let current = { ...options, meshAccuracy: { ...options.meshAccuracy } };

    if (typeof patch["meshAccuracy.chordTolerance"] === "number") {
      current.meshAccuracy.chordTolerance =
        patch["meshAccuracy.chordTolerance"];
    }

    if (typeof patch["meshAccuracy.angleToleranceRadians"] === "number") {
      current.meshAccuracy.angleToleranceRadians =
        patch["meshAccuracy.angleToleranceRadians"];
    }

    if (patch["encoding"] === "ascii" || patch["encoding"] === "binary") {
      current = { ...current, encoding: patch["encoding"] };
    }

    return current;
  },

  export(input: ExportProviderInput<StlExportOptions>): ExportProviderResult {
    return exportStl(input.target, input.options, input.capabilities);
  },
};
