import { expect, test, vi } from "vitest";

import { createTestErrorReporter, ok } from "@/contracts/errors";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type {
  DocumentVariableId,
  FeatureId,
  RevisionId,
} from "@/contracts/shared/ids";
import type { EditorEvent, EditorState } from "@/core/editor/state-machine";
import type { ModelingService } from "@/application/modeling/modeling-service";
import { createSeedDocumentSnapshot } from "@/application/modeling/modeling-test-fixtures";
import {
  addWorkbenchVariable,
  deleteWorkbenchTarget,
  renameWorkbenchTarget,
} from "@/workbench/commands/object-actions";
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
    showWorkbenchWarning: () => {},
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

// Seam: a workbench object action through the document owner to
// the notification callbacks, with a fake service whose accepted results
// carry every current document diagnostic, as the kernel's do. An accepted
// edit is a success; only the features it left failing are announced.
test("an accepted edit announces its success, and warns by label only about features it left failing", async () => {
  const seed = await createSeedDocumentSnapshot();
  const extrude = seed.document.features[0]!;
  const fillet = { ...extrude, featureId: "feature_fillet-1" as FeatureId, label: "Fillet 1" };
  const hole = { ...extrude, featureId: "feature_hole-1" as FeatureId, label: "Hole 1" };
  const featureError = (featureId: FeatureId, message: string) => ({
    code: "occ-missing-reference",
    severity: "error" as const,
    message,
    featureId,
    target: null,
    detail: null,
  });
  const holeError = featureError(hole.featureId, "Hole 1 location selection is incorrect.");
  const filletError = featureError(fillet.featureId, "Fillet 1 edge selection is incorrect.");
  const snapshotWith = (
    features: WorkspaceSnapshot["document"]["features"],
    diagnostics: WorkspaceSnapshot["document"]["diagnostics"],
  ): WorkspaceSnapshot => ({
    ...seed,
    document: { ...seed.document, features, diagnostics },
  });

  async function run(input: {
    before: WorkspaceSnapshot;
    after: WorkspaceSnapshot;
    revisionState?: { kind: "rejected"; reasonCode: string };
    act: (context: Parameters<typeof deleteWorkbenchTarget>[0]) => void;
  }) {
    const accepted = async () =>
      ok({
        revisionState: input.revisionState ?? { kind: "accepted" as const },
        diagnostics: input.after.document.diagnostics,
      });
    const modelingService = {
      currentDocumentId: seed.document.documentId,
      sketchSolver: null,
      getCurrentDocumentSnapshot: async () => input.after,
      deleteTarget: accepted,
      renameFeature: accepted,
    } as unknown as ModelingService;
    const shown: { kind: string; message: string; featureIds?: readonly FeatureId[] }[] = [];
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    const record = (entry: (typeof shown)[number]) => {
      shown.push(entry);
      settle();
    };
    input.act({
      documentOwner: createWorkbenchDocumentOwner({
        machineState: { snapshot: input.before } as EditorState,
        dispatch: () => undefined,
        modelingService,
        runtimeExtensionRegistries: {
          importProviders: { getById: () => null },
        } as never,
      }),
      errorReporter: createTestErrorReporter(),
      snapshot: input.before,
      showWorkbenchError: (message) => record({ kind: "error", message }),
      showWorkbenchInfo: (message) => record({ kind: "info", message }),
      showWorkbenchWarning: (message, featureIds) =>
        record({ kind: "warning", message, featureIds }),
      target: { kind: "feature", featureId: extrude.featureId },
      label: extrude.label,
    });
    await settled;
    return shown;
  }

  expect(
    await run({
      before: snapshotWith([extrude, fillet, hole], [holeError]),
      after: snapshotWith([fillet, hole], [holeError, filletError]),
      act: deleteWorkbenchTarget,
    }),
    "The delete happened; Fillet 1 is newly failing, Hole 1 was already.",
  ).toEqual([
    {
      kind: "warning",
      message: `Deleted ${extrude.label}. Fillet 1 no longer rebuilds: repair it or undo.`,
      featureIds: [fillet.featureId],
    },
  ]);

  expect(
    await run({
      before: snapshotWith([extrude, hole], [holeError]),
      after: snapshotWith([{ ...extrude, label: "Base" }, hole], [holeError]),
      act: (context) =>
        renameWorkbenchTarget({
          ...context,
          requestedLabel: "Base",
          setObjectLabelOverrides: () => undefined,
        }),
    }),
    "A document's existing broken feature does not turn an accepted rename into a failure or a warning.",
  ).toEqual([{ kind: "info", message: `Renamed ${extrude.label} to Base.` }]);

  expect(
    await run({
      before: snapshotWith([extrude, fillet], []),
      after: snapshotWith([extrude, fillet], [filletError]),
      revisionState: { kind: "rejected", reasonCode: "refused" },
      act: deleteWorkbenchTarget,
    }),
    "A rejected delete still fails.",
  ).toEqual([{ kind: "error", message: filletError.message }]);
});
