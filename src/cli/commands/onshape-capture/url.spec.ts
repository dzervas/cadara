import { test, expect } from "vitest";

import { parseDocumentUrl } from "@/cli/commands/onshape-capture/url";

test("url.spec.ts parses a workspace URL without an element", () => {
  const ref = parseDocumentUrl(
    "https://cad.onshape.com/documents/40a51fb8fa82fd4565151114/w/a14bbd18c43e1cd99d2cfc48",
  );
  expect(ref).toEqual({
    documentId: "40a51fb8fa82fd4565151114",
    wvm: "w",
    wvmId: "a14bbd18c43e1cd99d2cfc48",
    elementId: null,
  });
});

test("url.spec.ts parses a version URL scoped to an element", () => {
  const ref = parseDocumentUrl(
    "https://cad.onshape.com/documents/40a51fb8fa82fd4565151114/v/b14bbd18c43e1cd99d2cfc48/e/865452a3e2270f0ebca3ce63",
  );
  expect(ref.wvm).toBe("v");
  expect(ref.elementId).toBe("865452a3e2270f0ebca3ce63");
});

test("url.spec.ts rejects a non-Onshape URL with the expected shape", () => {
  expect(() => parseDocumentUrl("not a url")).toThrow(/Expected/);
});

test("url.spec.ts rejects a document URL missing the workspace/version segment", () => {
  expect(() =>
    parseDocumentUrl(
      "https://cad.onshape.com/documents/40a51fb8fa82fd4565151114",
    ),
  ).toThrow(/workspace\/version/);
});
