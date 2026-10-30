import { expect, test } from "vitest";
import { parseProjectManifest } from "./project-manifest.runtime-schema";
import type { ProjectManifest } from "./project-manifest";

function manifest(): ProjectManifest {
  return {
    format: "cadara-project",
    schemaVersion: 1,
    projectId: "project_one",
    name: "Enclosure",
    entries: [
      {
        name: "Lid",
        kind: "part",
        docId: "doc_lid",
        automergeDocumentId: "automerge_lid",
      },
    ],
    versions: [],
  };
}

test("project manifests accept reserved assemblies and a fork origin", () => {
  const value = manifest();
  value.entries.push({
    name: "Assembly",
    kind: "assembly",
    docId: "doc_assembly",
    automergeDocumentId: "automerge_assembly",
  });
  value.forkedFrom = { projectId: "original", version: "Printed" };
  expect(parseProjectManifest(value)).toEqual({ ok: true, value });
});

test.each([
  { ...manifest(), schemaVersion: 2 },
  { ...manifest(), extra: true },
  { ...manifest(), entries: [manifest().entries[0], manifest().entries[0]] },
  {
    ...manifest(),
    entries: [
      {
        name: "",
        kind: "part",
        docId: "doc_one",
        automergeDocumentId: "automerge_one",
      },
    ],
  },
  {
    ...manifest(),
    versions: [{ label: "v1", createdAt: "bad date", heads: {} }],
  },
  {
    ...manifest(),
    versions: [
      {
        label: "v1",
        createdAt: "2026-10-29T00:00:00Z",
        heads: { doc_one: ["bad hash"] },
      },
    ],
  },
  {
    ...manifest(),
    entries: [
      {
        name: "One",
        kind: "discussion",
        docId: "doc_one",
        automergeDocumentId: "automerge_one",
      },
      {
        name: "Two",
        kind: "discussion",
        docId: "doc_two",
        automergeDocumentId: "automerge_two",
      },
    ],
  },
])("malformed manifests return a diagnostic", (value) => {
  const result = parseProjectManifest(value);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostic.message).not.toBe("");
});

test.each([
  { name: "Missing", kind: "part", docId: "doc_missing" },
  { name: "Empty", kind: "part", docId: "doc_empty", automergeDocumentId: " " },
  {
    name: "Wrong type",
    kind: "part",
    docId: "doc_type",
    automergeDocumentId: 42,
  },
  {
    name: "Same document, different alias",
    kind: "part",
    docId: "doc_alias",
    automergeDocumentId: "automerge_lid",
  },
])("entries require nonempty unique Automerge identities: $name", (entry) => {
  const value = manifest();
  expect(
    parseProjectManifest({ ...value, entries: [...value.entries, entry] }).ok,
  ).toBe(false);
});
