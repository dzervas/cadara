// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing bracket, through the shared session
// helpers of the history prefix-reuse spec.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";

import {
  expectColdEquivalent,
  open,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

// A restore of a document whose cursor sits before features (Publish Sketch of
// a reopened sketch, an Undo of a rollback, a saved rolled-back document)
// evaluates none of them, so their persisted lineage is all the session has of
// their topology ids. Dropping it lost them from the export and let the next
// Roll To End mint fresh ids, which orphaned the references to lineage-only ids
// (a split's sheet faces).
test("a restore behind features keeps their persisted lineage for the export and the next Roll To End", async () => {
  const source = JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/bracket/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;
  const session = await open(source);
  try {
    const opened = await session.exported();
    const first = opened.historyOrder[0]!;
    expect(first.kind, "premise: the bracket history opens with a sketch").toBe(
      "sketch",
    );
    if (first.kind !== "sketch") throw new Error("Expected a leading sketch.");
    await session.setCursor({ kind: "sketch", sketchId: first.sketchId });
    const rolledBack = await session.exported();
    expect(
      rolledBack.topologyLineage?.length,
      "premise: a rollback keeps every feature's lineage",
    ).toBe(opened.topologyLineage?.length);

    await session.restore(rolledBack);
    expect(
      (await session.exported()).topologyLineage,
      "the restored export persists the lineage of the features behind the cursor",
    ).toEqual(rolledBack.topologyLineage);
    await expectColdEquivalent(
      session,
      rolledBack,
      "restored rollback",
      "exact",
    );

    await session.setCursor(opened.cursor);
    await expectColdEquivalent(session, opened, "roll to end", "exact");
  } finally {
    session.adapter.dispose();
  }
}, 900_000);
