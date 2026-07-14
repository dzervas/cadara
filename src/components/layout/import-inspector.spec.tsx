import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ImportInspector } from "@/components/layout/import-inspector";
import type { ModelingDiagnostic } from "@/contracts/modeling/schema";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";
import type { ImportSessionState } from "@/core/editor/state-machine/types";
import { EditorContext } from "@/hooks/editor-context";
import { RuntimeExtensionRegistryProvider } from "@/hooks/runtime-extension-registry-provider";
import { createScopedRuntimeExtensionRegistryCompositionForTest } from "@/domain/extensions/test-registry-composition";
import {
  initialEditorState,
  type EditorViewState,
} from "@/domain/editor/state-machine";

function createDenseImportFormSchema(): FeatureEditorFormSchema {
  return {
    sections: Array.from({ length: 6 }, (_, sectionIndex) => ({
      id: `section-${sectionIndex}`,
      title: `Imported studio ${sectionIndex}`,
      fields: Array.from({ length: 8 }, (_, fieldIndex) => ({
        kind: "summary" as const,
        id: `field-${sectionIndex}-${fieldIndex}`,
        label: `Feature ${sectionIndex}.${fieldIndex}`,
        value: `baked/degraded feature ${sectionIndex}.${fieldIndex}`,
      })),
    })),
  };
}

function createDenseImportDiagnostics(): ModelingDiagnostic[] {
  return Array.from({ length: 40 }, (_, index) => ({
    code: `onshape-import-${index}`,
    severity: index % 2 === 0 ? "warning" : "error",
    message: `Degraded feature ${index} fell back with a reason code.`,
    target: null,
    detail: null,
  }));
}

function createDenseImportSession(): ImportSessionState {
  return {
    providerId: "onshape",
    resolvedSource: {} as ResolvedImportSource,
    review: {
      providerReview: {},
      proposedActionKinds: [],
      diagnostics: [],
    },
    selections: {},
    formSchema: createDenseImportFormSchema(),
    diagnostics: createDenseImportDiagnostics(),
  };
}

function renderDenseImportInspector(): string {
  const session = createDenseImportSession();
  const viewState: EditorViewState = {
    ...initialEditorState.view,
    mode: "part",
    activeCommand: {
      commandSessionId: "command_import-1",
      toolId: "importPart",
      phase: "editing",
    },
    activeImportSession: session,
  };

  return renderToStaticMarkup(
    <MantineProvider defaultColorScheme="dark">
      <RuntimeExtensionRegistryProvider
        registries={createScopedRuntimeExtensionRegistryCompositionForTest()}
      >
        <EditorContext.Provider
          value={{
            machineState: initialEditorState,
            state: viewState,
            dispatch: () => undefined,
          }}
        >
          <ImportInspector onCommit={() => undefined} />
        </EditorContext.Provider>
      </RuntimeExtensionRegistryProvider>
    </MantineProvider>,
  );
}

test("src/components/layout/import-inspector.spec.tsx bounds the scroll region for a dense import so the footer stays reachable", () => {
  const markup = renderDenseImportInspector();

  expect(
    markup.includes("max-h-[70vh]"),
    "Import inspector host must be height-bounded so its internal scroll region scrolls instead of growing with content.",
  ).toBe(true);
  expect(
    markup.includes("overflow-y-auto"),
    "Import inspector must keep a scrollable overflow region for the fidelity/verification content.",
  ).toBe(true);
});

test("src/components/layout/import-inspector.spec.tsx keeps the commit and cancel footer present with a dense import", () => {
  const markup = renderDenseImportInspector();

  expect(
    markup.includes(">Commit</") && markup.includes(">Cancel</"),
    "Commit and cancel footer actions must remain rendered even when the import fidelity report is dense.",
  ).toBe(true);
});
