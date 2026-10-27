// T17k3 (K3). Logic lane; seam: kernel adapter conformance (mock and
// production OCC on the main thread). A restore of a state this session did
// not author (`newRevision`) gets a revision id the kernel has not used
// before, even when the document carries the current id or an older one; a
// later stored id (a peer's next write) is kept, so sessions agree on it. A
// plain restore keeps the document's id. A mutation based on the revision
// before such a restore is a conflict.
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import type { RevisionId } from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";

const request = {
  contractVersion: CONTRACT_VERSION,
  documentId: "doc_workspace",
} as const;

type OpenCascadeModule = new (
  module: Record<string, unknown>,
) => Promise<OpenCascadeInstance>;

async function loadOcc() {
  const module = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: OpenCascadeModule;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  return new module.default({ wasmBinary });
}

const adapters = {
  mock: async () => new MockKernelAdapter(),
  OCC: async () => {
    const oc = await loadOcc();
    return new OpenCascadeKernelAdapter({
      createSolverAdapter: (revisionId) =>
        new SketchConstraintSolverAdapter({
          neutralCurveQueries:
            createCertifiedNeutralCurveQueryCapabilityForTest(),
          revisionId,
        }),
      getOpenCascadeInstance: async () => oc,
    });
  },
};

describe("T17k3: a restore of a state this session did not author gets a new revision", () => {
  for (const kind of ["mock", "OCC"] as const)
    test(`${kind} adapter`, async () => {
      const adapter = await adapters[kind]();
      const revision = async () =>
        (await adapter.getDocumentSnapshot(request)).snapshot.document
          .revisionId;
      const addVariable = (baseRevisionId: RevisionId, name: string) =>
        adapter.addDocumentVariable({
          ...request,
          baseRevisionId,
          name,
          valueText: "10",
        });
      const seen = new Set<RevisionId>([await revision()]);
      const older = await adapter.exportAuthoredModelDocument("doc_workspace");
      expect(
        (await addVariable(await revision(), "Width")).revisionState.kind,
      ).toBe("accepted");
      const own = await adapter.exportAuthoredModelDocument("doc_workspace");
      seen.add(own.revisionId);
      expect(seen.size).toBe(2);

      // A plain restore (this session's own state) keeps the document's id.
      await adapter.restoreAuthoredModelDocument!(own);
      expect(await revision()).toBe(own.revisionId);

      // A different state stored under the current id (a peer counted to
      // the same number), one under an older id (an Undo), then a later one.
      for (const [label, document] of [
        ["same stored id", { ...own, name: "Peer" }],
        ["older stored id", older],
        [
          "later stored id",
          { ...own, name: "Later", revisionId: "rev_0042" as RevisionId },
        ],
      ] as const) {
        const before = await revision();
        await adapter.restoreAuthoredModelDocument!(document, [], undefined, {
          newRevision: true,
        });
        const restored = await revision();
        expect(seen.has(restored), `${kind} ${label}: ${restored}`).toBe(false);
        if (label === "later stored id") expect(restored).toBe("rev_0042");
        seen.add(restored);
        const stale = await addVariable(before, `Stale ${label}`);
        expect(stale.revisionState.kind, `${kind} ${label}: stale base`).toBe(
          "conflict",
        );
        expect(await revision(), `${kind} ${label}: nothing written`).toBe(
          restored,
        );
      }

      // Later mutations keep counting from there.
      const next = await addVariable(await revision(), "Depth");
      expect(next.revisionState.kind).toBe("accepted");
      expect(seen.has(await revision())).toBe(false);
      seen.add(await revision());

      // T17k3 review R-1/(4): a plain restore of an older document (a file
      // opened again) keeps its id but never lowers the counter: the next
      // mutation's id is still unused here.
      await adapter.restoreAuthoredModelDocument!(older);
      expect(await revision()).toBe(older.revisionId);
      const reopened = await addVariable(older.revisionId, "Height");
      expect(reopened.revisionState.kind).toBe("accepted");
      expect(seen.has(await revision()), `${kind}: ${await revision()}`).toBe(
        false,
      );
      if (adapter instanceof OpenCascadeKernelAdapter) adapter.dispose();
    }, 240_000);
});
