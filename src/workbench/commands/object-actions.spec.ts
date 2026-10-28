import { expect, test, vi } from "vitest";

import { createTestErrorReporter, ok } from "@/contracts/errors";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { DocumentVariableId, RevisionId } from "@/contracts/shared/ids";
import type { EditorEvent, EditorState } from "@/core/editor/state-machine";
import type { ModelingService } from "@/application/modeling/modeling-service";
import { createSeedDocumentSnapshot } from "@/application/modeling/modeling-test-fixtures";
import { addWorkbenchVariable } from "@/workbench/commands/object-actions";
import { createWorkbenchDocumentOwner } from "@/workbench/document/document-owner";

// cadara-5nz. Seam: the Add variable command clicked twice before the first
// add settles (both clicks share one render's owner and snapshot). The fake
// service refuses stale base revisions and duplicate names like the kernel.
test("a second Add variable while one is in flight adds another variable without an error", async () => {
  const seed = await createSeedDocumentSnapshot();
  let revision = 1;
  const variables: WorkspaceSnapshot["document"]["variables"] = [];
  const currentSnapshot = (): WorkspaceSnapshot => ({
    ...seed,
    document: {
      ...seed.document,
      revisionId: `rev_${revision}` as RevisionId,
      variables: [...variables],
    },
  });
  const addRequests: Array<{ baseRevisionId: string; name: string }> = [];
  const modelingService = {
    currentDocumentId: seed.document.documentId,
    sketchSolver: null,
    async getCurrentDocumentSnapshot() {
      return currentSnapshot();
    },
    async addDocumentVariable(input: {
      baseRevisionId: string;
      name: string;
      valueText: string;
    }) {
      addRequests.push({
        baseRevisionId: input.baseRevisionId,
        name: input.name,
      });
      // A slow kernel add, so the second click lands while this one is in flight.
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (input.baseRevisionId !== `rev_${revision}`) {
        return ok({
          revisionState: {
            kind: "conflict" as const,
            actualRevisionId: `rev_${revision}`,
          },
          diagnostics: [
            {
              code: "revision-conflict",
              severity: "error" as const,
              message: "Revision conflict.",
              target: null,
              detail: null,
            },
          ],
        });
      }
      if (variables.some((variable) => variable.name === input.name)) {
        return ok({
          revisionState: {
            kind: "rejected" as const,
            reasonCode: "duplicate-variable-name",
          },
          diagnostics: [
            {
              code: "duplicate-variable-name",
              severity: "error" as const,
              message: `Variable ${input.name} already exists.`,
              target: null,
              detail: null,
            },
          ],
        });
      }
      revision += 1;
      variables.push({
        variableId: `variable_${input.name}` as DocumentVariableId,
        name: input.name,
        valueText: input.valueText,
      });
      return ok({
        revisionState: { kind: "accepted" as const },
        diagnostics: [],
      });
    },
  } as unknown as ModelingService;

  const loadedSnapshots: WorkspaceSnapshot[] = [];
  const documentOwner = createWorkbenchDocumentOwner({
    machineState: { snapshot: currentSnapshot() } as EditorState,
    dispatch: (event: EditorEvent) => {
      if (event.type === "document.snapshotLoaded")
        loadedSnapshots.push(event.snapshot);
    },
    modelingService,
    runtimeExtensionRegistries: {
      importProviders: { getById: () => null },
    } as never,
  });
  const errors: string[] = [];
  const context = {
    documentOwner,
    errorReporter: createTestErrorReporter(),
    snapshot: currentSnapshot(),
    showWorkbenchError: (message: string) => errors.push(message),
    showWorkbenchInfo: () => {},
  };

  void addWorkbenchVariable(context);
  void addWorkbenchVariable(context);

  await vi.waitFor(() =>
    expect(loadedSnapshots.length + errors.length).toBe(2),
  );
  expect(errors, "neither click surfaces an error").toEqual([]);
  expect(
    variables.map((variable) => variable.name),
    "both clicks add a variable",
  ).toEqual(["var1", "var2"]);
  expect(
    addRequests,
    "the second add is rebased on the revision the first one produced",
  ).toEqual([
    { baseRevisionId: "rev_1", name: "var1" },
    { baseRevisionId: "rev_2", name: "var2" },
  ]);
  expect(
    loadedSnapshots.at(-1)?.document.variables.map((variable) => variable.name),
  ).toEqual(["var1", "var2"]);
});
