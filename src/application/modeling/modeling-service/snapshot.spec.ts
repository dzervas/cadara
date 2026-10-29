/**
 * Logic lane (docs/testing.md: `src/application`). Seam:
 * `validateSnapshotResponse`, the main thread's check of every snapshot the
 * OCC worker delivers. It runs the exact response contract once and then
 * only the normalization, instead of re-running the snapshot and document
 * contracts on the same payload; the result is the one the full
 * normalization produces, and every rejection still happens.
 */
import { expect, test } from "vitest";

import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { validateSnapshotResponse } from "@/application/modeling/modeling-service/snapshot";
import { normalizeWorkspaceSnapshot } from "@/core/modeling/modeling-service/normalization";
import { requireGetDocumentSnapshotResponse } from "@/contracts/modeling/runtime-schema";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";

async function deliveredResponse() {
  const adapter = new MockKernelAdapter();
  return structuredClone(
    await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
    }),
  );
}

/**
 * Counts reads of `document.cursor.kind`, a field only the contract checks
 * look at (the normalization copies `cursor` by reference), so the count
 * tells how many contract passes went over the payload.
 */
function countCursorKindReads(
  response: Awaited<ReturnType<typeof deliveredResponse>>,
) {
  const cursor = response.snapshot.document.cursor;
  const kind = cursor.kind;
  let reads = 0;
  Object.defineProperty(cursor, "kind", {
    enumerable: true,
    configurable: true,
    get: () => {
      reads += 1;
      return kind;
    },
  });
  return () => reads;
}

test("a delivered snapshot goes through the contract checks once", async () => {
  const oneContractPass = await deliveredResponse();
  const contractReads = countCursorKindReads(oneContractPass);
  requireGetDocumentSnapshotResponse(oneContractPass);
  expect(
    contractReads(),
    "premise: the contract reads the field",
  ).toBeGreaterThan(0);

  const delivered = await deliveredResponse();
  const deliveryReads = countCursorKindReads(delivered);
  validateSnapshotResponse(delivered, "doc_workspace" as never);
  expect(
    deliveryReads(),
    "the delivery validates the payload as often as one exact response contract pass",
  ).toBe(contractReads());
});

test("a delivered snapshot normalizes as the full snapshot normalization does and keeps its meshes", async () => {
  const response = await deliveredResponse();
  const validated = validateSnapshotResponse(
    response,
    "doc_workspace" as never,
  );

  expect(validated).toEqual(normalizeWorkspaceSnapshot(response.snapshot));
  const meshIndex = response.snapshot.document.render.records.findIndex(
    (record) => record.geometry.kind === "mesh",
  );
  expect(meshIndex).toBeGreaterThanOrEqual(0);
  expect(validated.document.render.records[meshIndex]!.geometry).toBe(
    response.snapshot.document.render.records[meshIndex]!.geometry,
  );
});

test("a delivered snapshot is still checked against the exact contract, the mesh normalization and the document id", async () => {
  const extraDocumentKey = await deliveredResponse();
  (
    extraDocumentKey.snapshot.document as unknown as Record<string, unknown>
  ).unexpected = true;
  expect(() =>
    validateSnapshotResponse(extraDocumentKey, "doc_workspace" as never),
  ).toThrow(/property `unexpected` is not defined/);

  const extraPresentationKey = await deliveredResponse();
  (
    extraPresentationKey.snapshot.presentation as unknown as Record<
      string,
      unknown
    >
  ).unexpected = true;
  expect(() =>
    validateSnapshotResponse(extraPresentationKey, "doc_workspace" as never),
  ).toThrow(/property `unexpected` is not defined/);

  const badMesh = await deliveredResponse();
  const geometry = badMesh.snapshot.document.render.records.find(
    (record) => record.geometry.kind === "mesh",
  )!.geometry;
  if (geometry.kind !== "mesh") throw new Error("Expected a mesh.");
  geometry.triangleIndices = new Uint32Array([
    0,
    1,
    geometry.vertexPositions.length / 3,
  ]);
  expect(() =>
    validateSnapshotResponse(badMesh, "doc_workspace" as never),
  ).toThrow("Mesh triangle indices must reference existing vertex positions.");

  const otherDocument = await deliveredResponse();
  expect(() =>
    validateSnapshotResponse(otherDocument, "doc_other" as never),
  ).toThrow(
    "Snapshot response document ID does not match the active document.",
  );
});
