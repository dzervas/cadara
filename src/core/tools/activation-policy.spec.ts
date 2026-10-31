import { test, expect } from "vitest";

import {
  getToolCommandBehavior,
  resolveToolActivationMode,
  toolAuthorsDocument,
} from "@/core/tools/activation-policy";
import { toolDefinitions } from "@/core/tools/tool-registry";

test("src/core/tools/activation-policy.spec.ts", () => {
  expect(
    getToolCommandBehavior("undo"),
    "Undo should declare undo behavior through tool metadata.",
  ).toBe("undo");
  expect(
    getToolCommandBehavior("redo"),
    "Redo should declare redo behavior through tool metadata.",
  ).toBe("redo");
  expect(
    getToolCommandBehavior("import"),
    "Part import should declare import behavior through tool metadata.",
  ).toBe("partImport");
  expect(
    getToolCommandBehavior("importImage"),
    "Sketch reference-image import should declare image-import behavior through tool metadata.",
  ).toBe("sketchReferenceImageImport");
  expect(
    getToolCommandBehavior("line"),
    "Ordinary modeling tools should not declare special command behavior.",
  ).toBe(null);

  expect(
    resolveToolActivationMode("undo", "part"),
    "Undo should preserve the current toolbar mode.",
  ).toBe("part");
  expect(
    resolveToolActivationMode("redo", "sketch"),
    "Redo should preserve the current toolbar mode.",
  ).toBe("sketch");
  expect(
    resolveToolActivationMode("sketch", "part"),
    "Sketch should log and route activation from part mode.",
  ).toBe("part");
  expect(
    resolveToolActivationMode("finishSketch", "sketch"),
    "Finish Sketch should remain a sketch-mode activation.",
  ).toBe("sketch");
  expect(
    resolveToolActivationMode("line", "part"),
    "Sketch-only tools should resolve to sketch mode from metadata alone.",
  ).toBe("sketch");
  expect(
    resolveToolActivationMode("extrude", "sketch"),
    "Part-only tools should resolve to part mode from metadata alone.",
  ).toBe("part");
});

test("only Measure and Section View stay usable without write permission", () => {
  const inspectionTools = toolDefinitions
    .filter((tool) => !toolAuthorsDocument(tool.id))
    .map((tool) => tool.id)
    .sort();
  expect(inspectionTools).toEqual(["measure", "sectionView"]);
});
