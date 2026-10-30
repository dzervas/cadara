import { expect, test } from "vitest";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import { createEmptyAuthoredModelDocument } from "./empty-authored-model-document";

test("empty part seeds are valid authored documents with no authored geometry", () => {
  const document = createEmptyAuthoredModelDocument("doc_new");
  expect(parseAuthoredModelDocument(document)).toEqual({ ok: true, document });
  expect(document.documentId).toBe("doc_new");
  expect(document.cursor).toEqual({ kind: "empty" });
  expect(document.sketches).toEqual([]);
  expect(document.features).toEqual([]);
});
