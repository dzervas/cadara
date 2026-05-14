import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentExportModal } from "@/components/layout/document-export-modal";
import { buildDocumentExportModalInput } from "@/components/layout/document-export-modal-input";
import { createTestErrorReporter } from "@/contracts/errors";
import type { ObjectExportModalState } from "@/domain/export/object-export-state";
import { workbenchTheme } from "@/theme/workbench-theme";
import { RuntimeExtensionRegistryProvider } from "@/hooks/runtime-extension-registry-provider";
import { createScopedRuntimeExtensionRegistryCompositionForTest } from "@/domain/extensions/test-registry-composition";
import { stepExportProvider } from "@/domain/export/providers/step-export-provider";

test("src/components/layout/document-export-modal.spec.tsx", () => {
  const target: ObjectExportModalState = {
    target: { kind: "body", bodyId: "body_part-1" },
    label: "Part 1",
    baseRevisionId: "rev_0001",
  };
  const errorReporter = createTestErrorReporter();
  const registries = createScopedRuntimeExtensionRegistryCompositionForTest();

  const stlMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <RuntimeExtensionRegistryProvider registries={registries}>
        <DocumentExportModal
          opened
          target={target}
          withinPortal={false}
          errorReporter={errorReporter}
          exportDocument={async () => ({
            ok: false,
            format: "stl",
            diagnostics: [],
          })}
          onClose={() => undefined}
          onDownload={() => undefined}
        />
      </RuntimeExtensionRegistryProvider>
    </MantineProvider>,
  );

  expect(
    stlMarkup.includes("Export Part 1"),
    "Export modal should be scoped to the selected row label.",
  ).toBeTruthy();
  expect(
    stlMarkup.includes("STL"),
    "Export modal should list STL.",
  ).toBeTruthy();
  expect(
    stlMarkup.includes("STEP"),
    "Export modal should list STEP.",
  ).toBeTruthy();
  expect(
    stlMarkup.includes("3MF"),
    "Export modal should list 3MF.",
  ).toBeTruthy();
  expect(
    stlMarkup.includes("cadara"),
    "Solid export modal should not list cadara document export.",
  ).toBeFalsy();
  expect(
    stlMarkup.includes("Mesh accuracy"),
    "STL export should show mesh accuracy controls.",
  ).toBeTruthy();
  expect(
    stlMarkup.includes("STEP options"),
    "STL export should not show STEP-specific controls.",
  ).toBeFalsy();
  expect(
    stlMarkup.includes("cadara JSON"),
    "STL export should not show cadara-specific controls.",
  ).toBeFalsy();

  const sketchMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <RuntimeExtensionRegistryProvider registries={registries}>
        <DocumentExportModal
          opened
          target={{
            target: { kind: "sketch", sketchId: "sketch_profile" },
            label: "Sketch 1",
            baseRevisionId: "rev_0001",
          }}
          withinPortal={false}
          errorReporter={errorReporter}
          exportDocument={async () => ({
            ok: false,
            format: "svg",
            diagnostics: [],
          })}
          onClose={() => undefined}
          onDownload={() => undefined}
        />
      </RuntimeExtensionRegistryProvider>
    </MantineProvider>,
  );

  expect(
    sketchMarkup.includes("SVG"),
    "Sketch export modal should list SVG.",
  ).toBeTruthy();
  expect(
    sketchMarkup.includes("DXF"),
    "Sketch export modal should list DXF.",
  ).toBeTruthy();
  expect(
    sketchMarkup.includes("STL"),
    "Sketch export modal should omit STL.",
  ).toBeFalsy();
  expect(
    sketchMarkup.includes("STEP"),
    "Sketch export modal should omit STEP.",
  ).toBeFalsy();
  expect(
    sketchMarkup.includes("3MF"),
    "Sketch export modal should omit 3MF.",
  ).toBeFalsy();

  const stepMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <RuntimeExtensionRegistryProvider registries={registries}>
        <DocumentExportModal
          opened
          initialFormat="step"
          target={target}
          withinPortal={false}
          errorReporter={errorReporter}
          exportDocument={async () => ({
            ok: false,
            format: "step",
            diagnostics: [],
          })}
          onClose={() => undefined}
          onDownload={() => undefined}
        />
      </RuntimeExtensionRegistryProvider>
    </MantineProvider>,
  );

  expect(
    stepMarkup.includes("STEP options"),
    "STEP export should show STEP-specific controls.",
  ).toBeTruthy();
  expect(
    stepMarkup.includes("Mesh accuracy"),
    "STEP export should omit mesh accuracy controls.",
  ).toBeFalsy();

  const stepDefaults = stepExportProvider.getDefaultOptions();
  const input = buildDocumentExportModalInput(target, "step", stepDefaults);

  expect(
    input.format,
    "Modal submission should preserve the selected format.",
  ).toBe("step");
  expect(
    typeof input.options === "object" &&
      input.options !== null &&
      "meshAccuracy" in input.options,
    "Modal submission should not include incompatible mesh options for STEP.",
  ).toBeFalsy();
});
