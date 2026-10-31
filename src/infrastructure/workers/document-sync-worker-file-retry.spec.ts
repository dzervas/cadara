import { expect, test } from "vitest";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import { createMemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import type { DocumentSyncWorkerResponse } from "./document-sync-worker-protocol";
import { createDocumentSyncWorkerMessageHandler } from "./document-sync-worker-runtime";

// Logic lane: the worker's file retry capability, using the real message handler and fake I/O.
test("permission recovery retries the latest failed file write without another model mutation or a new handle", async () => {
  const seed = await createSeedAuthoredModelDocument();
  const repository = createMemoryDocumentRepository([seed]);
  const posted: DocumentSyncWorkerResponse[] = [];
  const writes: string[] = [];
  let permitted = false;
  const handler = createDocumentSyncWorkerMessageHandler(
    { repository },
    (message) => posted.push(message),
  );
  await handler({
    kind: "bindFileHandle",
    requestId: "request_bind",
    documentId: seed.documentId,
    metadata: {
      documentId: seed.documentId,
      fileName: "Bracket.cadara",
      storedAt: "2026-10-31",
    },
    handle: {
      name: "Bracket.cadara",
      getFile: async () => {
        throw new Error("Retry must not reload a file over browser edits.");
      },
      queryPermission: async () => (permitted ? "granted" : "denied"),
      createWritable: async () => ({
        write: (data) => {
          writes.push(String(data));
        },
        close: () => undefined,
      }),
    },
  });
  const first = { ...seed, name: "First edit" };
  await handler({
    kind: "mutate",
    requestId: "request_edit_one",
    documentId: seed.documentId,
    expected: seed,
    document: first,
  });
  const latest = { ...first, name: "Latest edit" };
  await handler({
    kind: "mutate",
    requestId: "request_edit_two",
    documentId: seed.documentId,
    expected: first,
    document: latest,
  });
  await expect
    .poll(() =>
      posted.some(
        (message) =>
          message.kind === "writeStatusChanged" &&
          message.status.kind === "permission-denied",
      ),
    )
    .toBe(true);
  expect(writes).toHaveLength(0);
  const statusCount = posted.filter(
    (message) => message.kind === "writeStatusChanged",
  ).length;
  await handler({
    kind: "restoreBinding",
    requestId: "request_handle",
    documentId: seed.documentId,
    announce: false,
  });
  expect(
    posted.filter((message) => message.kind === "writeStatusChanged"),
  ).toHaveLength(statusCount);
  expect(posted.at(-1)).toMatchObject({
    kind: "bindingRestored",
    record: { handle: { name: "Bracket.cadara" } },
  });
  permitted = true;
  await handler({
    kind: "retryFileWrite",
    requestId: "request_retry",
    documentId: seed.documentId,
  });
  await expect.poll(() => writes.length).toBe(1);
  expect(JSON.parse(writes[0]!).name).toBe("Latest edit");
  await expect
    .poll(
      () =>
        posted.filter((message) => message.kind === "writeStatusChanged").at(-1)
          ?.status.kind === "synced",
    )
    .toBe(true);
  expect(posted.some((message) => message.kind === "fileWriteRetried")).toBe(
    true,
  );
});
