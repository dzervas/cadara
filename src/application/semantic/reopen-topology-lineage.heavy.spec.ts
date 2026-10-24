// cadara-797. Logic lane, heavy tier (docs/testing.md): the headless session's
// modeling service and production OCC adapter over the production Automerge
// document repository (in-memory automerge-repo, no IndexedDB), entered the way
// the workbench's "Open a copy" does: `repository.initialize(file)`, then the
// service restores the stored document.
//
// Reopening a document must not rewrite its topology lineage. Collaborative
// storage returns source targets in key order, and a restore used to advance
// every output's token and re-mint its edge/vertex ids. The first write after
// opening (a body rename) then rewrote ~0.9 MB of witnesses on the landing
// wheel (866 lineage leaves, ~300 ms of Automerge transact in the browser).
//
// The stored basis is the wheel after one write by the current code. The
// shipped file still holds ids from fresh feature evaluation (native hash ids
// for edges/vertices no lineage witness preserves), which the first restore
// re-mints once.
import { readFile } from "node:fs/promises";
import * as Automerge from "@automerge/automerge/slim";
import { initializeBase64Wasm, Repo } from "@automerge/automerge-repo/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { DocumentId } from "@/contracts/shared/ids";
import { MemoryDocumentRepositoryUrlStore } from "@/infrastructure/persistence/document-repository-url-store";
import { IndexedDbAutomergeDocumentRepository } from "@/infrastructure/persistence/indexeddb-automerge-document-repository";
import { createSemanticSessionWorkflow } from "../../../test/helpers/semantic-session-workflow";

const wheelBodyId = "body_feature_extrude-1";

/** Lineage as collaborative storage keys it (by feature, output slot and source key); list order elsewhere is kept. */
function keyedLineage(document: AuthoredModelDocument) {
  return Object.fromEntries(
    (document.topologyLineage ?? []).map((feature) => [
      feature.featureId,
      Object.fromEntries(
        feature.outputs.map((output) => [
          output.outputSlot,
          {
            ...output,
            sourceTargets: Object.fromEntries(
              output.sourceTargets.map((entry) => [
                entry.sourceKey,
                entry.targets,
              ]),
            ),
          },
        ]),
      ),
    ]),
  );
}

/** Opens a copy of `stored`, renames the wheel body once, and returns the stored lineage before/after that first write. */
async function openCopyAndRenameOnce(
  stored: AuthoredModelDocument,
  label: string,
) {
  await initializeBase64Wasm(automergeWasmBase64);
  const repo = new Repo({ network: [] });
  const urlStore = new MemoryDocumentRepositoryUrlStore();
  let repository!: IndexedDbAutomergeDocumentRepository;
  let documentId!: DocumentId;
  const workflow = await createSemanticSessionWorkflow("reopen-lineage", {
    createRepository: (assets) => {
      repository = new IndexedDbAutomergeDocumentRepository({
        repo,
        urlStore,
        assetStore: assets,
        localPeerSync: false,
      });
      const load = repository.load.bind(repository);
      repository.load = async (input) => {
        if (!documentId) {
          documentId = input.documentId;
          const initialized = await repository.initialize({
            documentId,
            document: { ...structuredClone(stored), documentId },
          });
          if (!initialized.ok) throw new Error(JSON.stringify(initialized));
        }
        return load(input);
      };
      return repository;
    },
  });
  const storedDocument = async () => {
    const loaded = await repository.load({ documentId, seedDocument: stored });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    return loaded.document;
  };
  try {
    expect(
      (await workflow.run({ operation: "document.inspect" })).outcome.kind,
    ).toBe("completed");
    const before = await storedDocument();
    const handle = await repo.find<unknown>(urlStore.get(documentId)!);
    const headsBefore = Automerge.getHeads(
      handle.doc() as Automerge.Doc<unknown>,
    );
    const renamed = await workflow.run({
      operation: "body.rename",
      bodyId: wheelBodyId,
      label,
      intent: "fulfill",
    });
    expect(renamed.outcome.kind).toBe("completed");
    const after = await storedDocument();
    expect(
      after.bodyLabels.find((record) => record.bodyId === wheelBodyId)?.label,
    ).toBe(label);
    const firstWriteBytes = Automerge.getChanges(
      Automerge.view(handle.doc() as Automerge.Doc<unknown>, headsBefore),
      handle.doc() as Automerge.Doc<unknown>,
    ).reduce((total, change) => total + change.byteLength, 0);
    return { before, after, firstWriteBytes };
  } finally {
    await workflow.close();
  }
}

test("the first write after reopening a stored wheel leaves its topology lineage unchanged", async () => {
  const file = JSON.parse(
    await readFile(
      new URL("../../../landing/examples/wheel/model.cadara", import.meta.url),
      "utf8",
    ),
  ) as AuthoredModelDocument;
  const written = (await openCopyAndRenameOnce(file, "Wheel (written once)"))
    .after;

  const reopened = await openCopyAndRenameOnce(written, "Wheel (reopened)");
  expect(keyedLineage(reopened.before), "premise: the stored lineage").toEqual(
    keyedLineage(written),
  );
  // Every output keeps its token and ids: the rename writes no witness.
  expect(keyedLineage(reopened.after)).toEqual(keyedLineage(written));
  // The first write's Automerge change stays a label + revision edit (a few
  // hundred bytes), not a rewrite of the witness set (hundreds of kilobytes).
  expect(reopened.firstWriteBytes).toBeLessThan(4_096);
}, 600_000);
