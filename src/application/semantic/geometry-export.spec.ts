import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { createPlateWorkflow } from "../../../test/helpers/semantic-workflow";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";

const meshAccuracy = { chordTolerance: 0.05, angleToleranceRadians: 0.1 };

it("writes actual native binary/ascii STL and 3MF bytes with exact receipts, shared discovery and independent solid bounds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-exports-"));
  const fixture = await createPlateWorkflow();
  try {
    const state = fixture.solid.discovery!.state;
    const target = fixture.solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.target;
    const providers = fixture.solid.discovery!.exportProviders!;
    expect(providers.map((p) => [p.format, p.targetKinds])).toEqual([
      ["stl", ["body"]],
      ["step", ["body"]],
      ["3mf", ["body"]],
      ["svg", ["sketch"]],
      ["dxf", ["sketch"]],
    ]);
    const denied = await fixture.run({
      operation: "export.stl",
      target,
      options: { meshAccuracy, encoding: "binary" },
      path: join(directory, "missing", "plate.stl"),
    });
    expect(denied.outcome).toEqual({ kind: "failed", failures: ["file"] });
    expect(denied.completion.file).toMatchObject({
      kind: "failed",
      bytesWritten: 0,
    });
    expect(denied.completion.geometry.kind).toBe("current");
    const binaryPath = join(directory, "plate.stl");
    const binaryResult = await fixture.execute({
      operation: "export.stl",
      target,
      options: { meshAccuracy, encoding: "binary" },
      path: binaryPath,
    });
    const binary = await readFile(binaryPath);
    const count = binary.readUInt32LE(80);
    expect(count).toBe(12);
    expect(binary.length).toBe(84 + 50 * count);
    const vertices: number[][] = [];
    for (let triangle = 0; triangle < count; triangle++) {
      for (let vertex = 0; vertex < 3; vertex++) {
        vertices.push(
          [0, 1, 2].map((axis) =>
            binary.readFloatLE(
              84 + triangle * 50 + 12 + vertex * 12 + axis * 4,
            ),
          ),
        );
      }
    }
    expect(
      [0, 1, 2].map((axis) => Math.min(...vertices.map((v) => v[axis]!))),
    ).toEqual([0, 0, 0]);
    expect(
      [0, 1, 2].map((axis) => Math.max(...vertices.map((v) => v[axis]!))),
    ).toEqual([20, 10, 7]);
    expect(binaryResult.completion.file).toMatchObject({
      kind: "written",
      bytesWritten: binary.length,
      state,
    });
    expect(binaryResult.completion.live).toEqual({ kind: "unchanged", state });
    expect(binaryResult.completion.persistence.kind).toBe("not-required");
    const asciiPath = join(directory, "ascii.stl");
    await fixture.execute({
      operation: "export.stl",
      target,
      options: { meshAccuracy, encoding: "ascii" },
      path: asciiPath,
    });
    const ascii = await readFile(asciiPath, "utf8");
    expect(ascii.startsWith("solid cadara\n")).toBe(true);
    expect(ascii.endsWith("endsolid cadara")).toBe(true);
    const asciiVertices = [...ascii.matchAll(/vertex ([^\n]+)/g)].map((m) =>
      m[1]!.split(" ").map(Number),
    );
    expect(asciiVertices).toEqual(vertices);
    for (const includeMetadata of [true, false]) {
      const path = join(directory, `${includeMetadata}.3mf`);
      const result = await fixture.execute({
        operation: "export.3mf",
        target,
        options: { meshAccuracy, unit: "millimeter", includeMetadata },
        path,
      });
      const bytes = await readFile(path);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      expect(result.completion.file).toMatchObject({
        kind: "written",
        bytesWritten: bytes.length,
        state,
      });
      const files = unzipSync(bytes);
      expect(Object.keys(files).sort()).toEqual([
        "3D/3dmodel.model",
        "[Content_Types].xml",
        "_rels/.rels",
      ]);
      const xml = strFromU8(files["3D/3dmodel.model"]!);
      expect(xml).toContain('unit="millimeter"');
      expect(xml.includes('<metadata name="Title">')).toBe(includeMetadata);
      const points = [
        ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
      ].map((m) => m.slice(1).map(Number));
      expect(points.length).toBe(8);
      expect(points.map((v) => v.join(",")).sort()).toEqual(
        [...new Set(vertices.map((v) => v.join(",")))].sort(),
      );
      expect([...xml.matchAll(/<triangle /g)]).toHaveLength(count);
    }
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

it("uses production curved-body tessellation at requested mesh accuracies for STL and 3MF", async () => {
  const fixture = await createSketchWorkflow();
  const directory = await mkdtemp(join(tmpdir(), "cadara-curved-export-"));
  try {
    await fixture.execute({
      operation: "sketch.author",
      draft: fixture.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 10 },
      construction: false,
      intent: "fulfill",
    });
    const published = await fixture.execute({
      operation: "sketch.publish",
      draft: fixture.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const solid = await fixture.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 7,
      intent: "fulfill",
    });
    const target = solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.target;
    const counts: number[] = [];
    for (const accuracy of [
      { chordTolerance: 1, angleToleranceRadians: 1 },
      { chordTolerance: 0.01, angleToleranceRadians: 0.05 },
    ]) {
      const path = join(directory, "curve.stl");
      await fixture.execute({
        operation: "export.stl",
        target,
        path,
        options: { meshAccuracy: accuracy, encoding: "binary" },
      });
      const bytes = await readFile(path);
      const count = bytes.readUInt32LE(80);
      counts.push(count);
      expect(bytes.length).toBe(84 + count * 50);
      const packagePath = join(directory, "curve.3mf");
      await fixture.execute({
        operation: "export.3mf",
        target,
        path: packagePath,
        options: {
          meshAccuracy: accuracy,
          unit: "millimeter",
          includeMetadata: false,
        },
      });
      const xml = strFromU8(
        unzipSync(await readFile(packagePath))["3D/3dmodel.model"]!,
      );
      expect([...xml.matchAll(/<triangle /g)]).toHaveLength(count);
    }
    expect(counts[1]!).toBeGreaterThan(counts[0]!);
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

it("exports committed sketch SVG/DXF through the existing vector owner and forwards unsupported-entity warnings", async () => {
  const fixture = await createSketchWorkflow();
  const directory = await mkdtemp(join(tmpdir(), "cadara-vector-export-"));
  try {
    for (const primitive of [
      { kind: "rectangle", start: [0, 0], end: [20, 10] },
      { kind: "point", position: [30, 30] },
    ])
      await fixture.execute({
        operation: "sketch.author",
        draft: fixture.current().discovery!.state.draft,
        primitive,
        construction: false,
        intent: "fulfill",
      });
    const published = await fixture.execute({
      operation: "sketch.publish",
      draft: fixture.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const target = {
      kind: "sketch",
      sketchId: published.discovery!.sketch!.sketchId,
    };
    for (const format of ["svg", "dxf"]) {
      const path = join(directory, `sketch.${format}`);
      const result = await fixture.execute({
        operation: `export.${format}`,
        target,
        options: {},
        path,
      });
      const text = await readFile(path, "utf8");
      expect(
        result.diagnostics.some(
          (d) =>
            d.code === "sketch-vector-unsupported-entity" &&
            d.severity === "warning",
        ),
        JSON.stringify(result.diagnostics),
      ).toBe(true);
      expect(result.completion.file).toMatchObject({
        kind: "written",
        bytesWritten: Buffer.byteLength(text),
      });
      if (format === "svg") {
        expect(text).toContain('width="20mm" height="10mm"');
        expect([...text.matchAll(/data-entity-id=/g)]).toHaveLength(4);
        expect(text).toContain("L 20 10");
      } else {
        expect(text).toContain("9\n$INSUNITS\n70\n4");
        expect([...text.matchAll(/0\nLINE\n/g)]).toHaveLength(4);
        expect(text).toContain("10\n20\n20\n0\n30\n0\n11\n20\n21\n10");
        expect(text.endsWith("0\nEOF")).toBe(true);
      }
    }
    await fixture.execute({ operation: "sketch.begin", plane: "xy" });
    await fixture.execute({
      operation: "sketch.author",
      draft: fixture.current().discovery!.state.draft,
      primitive: { kind: "point", position: [30, 30] },
      construction: false,
      intent: "fulfill",
    });
    const empty = await fixture.execute({
      operation: "sketch.publish",
      draft: fixture.current().discovery!.state.draft,
      requireProfiles: false,
    });
    for (const format of ["svg", "dxf"]) {
      const result = await fixture.run({
        operation: `export.${format}`,
        target: { kind: "sketch", sketchId: empty.discovery!.sketch!.sketchId },
        options: {},
        path: join(directory, `empty.${format}`),
      });
      expect(result.outcome).toEqual({
        kind: "rejected",
        reasonCode: `sketch-${format}-empty-export`,
      });
      expect(result.completion.file.kind).toBe("not-required");
      expect(
        result.diagnostics.some(
          (d) => d.code === "sketch-vector-unsupported-entity",
        ),
      ).toBe(true);
    }
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

it("refuses provider options, incompatible targets, stale revisions and missing bodies before any file write", async () => {
  let writes = 0;
  const fixture = await createPlateWorkflow({
    nativeFileIO: {
      read: async () => "",
      write: async () => {
        writes++;
        throw new Error("Unexpected text write");
      },
      writeBytes: async () => {
        writes++;
        throw new Error("Unexpected binary write");
      },
    },
  });
  try {
    const target = fixture.solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.target;
    const sketch = {
      kind: "sketch",
      sketchId: fixture.published.discovery!.sketch!.sketchId,
    };
    for (const [operation, options, selected, expected] of [
      [
        "export.stl",
        {
          meshAccuracy: { ...meshAccuracy, chordTolerance: 0 },
          encoding: "binary",
        },
        target,
        "invalid-stl-options",
      ],
      [
        "export.stl",
        { meshAccuracy, encoding: "other" },
        target,
        "invalid-stl-options",
      ],
      [
        "export.3mf",
        { meshAccuracy, unit: "inch", includeMetadata: true },
        target,
        "invalid-3mf-options",
      ],
      [
        "export.3mf",
        { meshAccuracy, unit: "millimeter", includeMetadata: "yes" },
        target,
        "invalid-3mf-options",
      ],
      ["export.svg", { ignored: true }, sketch, "invalid-svg-options"],
      ["export.dxf", {}, target, "export-incompatible-target"],
      [
        "export.stl",
        { meshAccuracy, encoding: "binary" },
        sketch,
        "export-incompatible-target",
      ],
      [
        "export.3mf",
        { meshAccuracy, unit: "millimeter", includeMetadata: true },
        { kind: "body", bodyId: "body_missing" },
        "occ-export-missing-body",
      ],
    ] as const) {
      const result = await fixture.run({
        operation,
        options,
        target: selected,
        path: "never",
      });
      expect(result.outcome).toEqual({
        kind: "rejected",
        reasonCode: expected,
      });
      expect(result.completion.file.kind).toBe("not-required");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    const stale = await fixture.run({
      operation: "export.stl",
      basis: fixture.published.discovery!.state,
      target,
      options: { meshAccuracy, encoding: "binary" },
      path: "never",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    expect(writes).toBe(0);
  } finally {
    await fixture.close();
  }
}, 60000);

it("keeps binary provider success separate from partial filesystem failure and missing binary adapters", async () => {
  let observed: Uint8Array | undefined;
  const files: import("./document-port").NativeDocumentFileIO = {
    read: async () => "",
    write: async () => {
      throw new Error("Binary must not be decoded");
    },
    writeBytes: async (_path, bytes) => {
      observed = bytes;
      return {
        kind: "failed",
        bytesWritten: 31,
        diagnostics: [
          {
            code: "disk-full",
            severity: "error",
            message: "Partial binary write",
            target: null,
            detail: null,
          },
        ],
      };
    },
  };
  const fixture = await createPlateWorkflow({ nativeFileIO: files });
  try {
    const target = fixture.solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.target;
    const result = await fixture.run({
      operation: "export.stl",
      target,
      path: "partial.stl",
      options: { meshAccuracy, encoding: "binary" },
    });
    expect(observed).toBeInstanceOf(Uint8Array);
    expect(observed!.length).toBe(684);
    expect(result.outcome).toEqual({ kind: "failed", failures: ["file"] });
    expect(result.completion.file).toMatchObject({
      kind: "failed",
      bytesWritten: 31,
    });
    expect(result.completion.geometry.kind).toBe("current");
    expect(result.completion.persistence.kind).toBe("not-required");
    expect(result.diagnostics.some((d) => d.code === "disk-full")).toBe(true);
    expect(validateSemanticResult(result.correlation, result).success).toBe(
      true,
    );
    files.writeBytes = undefined;
    const unavailable = await fixture.run({
      operation: "export.3mf",
      target,
      path: "unavailable.3mf",
      options: { meshAccuracy, unit: "millimeter", includeMetadata: true },
    });
    expect(unavailable.outcome).toEqual({ kind: "failed", failures: ["file"] });
    expect(unavailable.completion.file).toMatchObject({
      kind: "failed",
      bytesWritten: 0,
    });
    expect(unavailable.diagnostics[0]!.message).toContain(
      "does not support binary",
    );
  } finally {
    await fixture.close();
  }
});
