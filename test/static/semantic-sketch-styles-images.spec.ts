import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

it("browser and explicit style/image authoring retain shared authored owners", () => {
  const styles = read("src/domain/editor/sketch-session/styles.ts");
  expect(styles.match(/return applySketchStylePatch\(/g)).toHaveLength(2);
  expect(styles).toContain("applyStylePatchToDefinition(");
  const references = read("src/domain/editor/sketch-session/references.ts");
  expect(references).toContain(
    "return appendReferenceImageOperations(session,",
  );
  expect(references).toContain("return updateReferenceImageOperationStates(");
  expect(read("src/core/editor/state-machine/transitions-sketch.ts")).toContain(
    "appendReferenceImageOperations(",
  );
  expect(
    read("src/domain/reference-image-calibration/mode/definition.ts"),
  ).toContain("updateReferenceImageOperationStates(");
  const reducer = read("src/core/editor/state-machine/reducer-sketch.ts");
  expect(reducer).toContain(
    "authorSketchStyle(state.session, event.targets, event.patch)",
  );
  expect(reducer).toContain(
    "authorReferenceImage(state.session, event.payload)",
  );
  expect(reducer).toContain(
    "editReferenceImage(state.session, event.target.operationId, event.edit)",
  );
  expect(reducer).toContain(
    "deleteSelectedSketchGeometry(state.session, [event.target])",
  );
});

it("filesystem and browser acquire bytes separately and share the existing metadata preparation without decoders or browser shims", () => {
  const raster = read("src/infrastructure/reference-image/raster.ts");
  expect(raster).toContain("readRasterImageDimensions(input.bytes)");
  expect(raster).toContain("requireReferenceImagePayload(");
  expect(read("src/infrastructure/reference-image/import-flow.ts")).toContain(
    "return prepareReferenceImagePayload(",
  );
  const files = read("src/infrastructure/modeling/reference-image-file-io.ts");
  expect(files).toContain("await readFile(path)");
  expect(files).toContain("prepareReferenceImagePayload(");
  for (const path of [
    "src/infrastructure/reference-image/raster.ts",
    "src/infrastructure/modeling/reference-image-file-io.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
  ]) {
    expect(read(path)).not.toMatch(
      /new (?:Image|File|FileReader)\(|createImageBitmap\(|document\.(?:createElement|querySelector)\(|showOpenImportFilePicker|@\/lib\/import-file-picker/,
    );
  }
  const command = read("src/cli/commands/document-recipes.ts");
  expect(command).not.toMatch(
    /prepareReferenceImagePayload|readRasterImageDimensions|appendReferenceImageOperations|updateReferenceImageOperationStates|solveReferenceImageCalibration/,
  );
  expect(
    read("src/infrastructure/modeling/semantic-sketch-port.ts"),
  ).not.toMatch(/type:\s*["'](?:tool\.activated|sketch\.pointer|viewport\.)/);
});
