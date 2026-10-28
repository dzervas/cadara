import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceToolbar } from "@/components/layout/workspace-toolbar";
import { getNextToolSearchHighlightIndex } from "@/components/layout/workspace-toolbar.a11y";
import {
  getEditorViewState,
  initialEditorState,
  type EditorViewState,
} from "@/core/editor/state-machine";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  focusSketchStyleTool,
  startSketchDraw,
  toggleSketchSvgRendering,
} from "@/core/editor/sketch-session";
import { enterSketchSession, enterSketchSessionState } from "@/core/editor/sketch-entry.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { EditorContext } from "@/hooks/editor-context";
import { WorkbenchCommandProvider } from "@/hooks/workbench-command-provider";
import { workbenchTheme } from "@/theme/workbench-theme";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";

test("src/components/layout/workspace-toolbar.spec.tsx", async () => {
  function getToolMarkup(markup: string, toolId: string) {
    const toolIdIndex = markup.indexOf(`data-tool-id="${toolId}"`);
    expect(
      toolIdIndex >= 0,
      `Expected ${toolId} tool markup to exist.`,
    ).toBeTruthy();

    const start = markup.lastIndexOf("<button", toolIdIndex);
    expect(
      start >= 0,
      `Expected ${toolId} tool button markup to exist.`,
    ).toBeTruthy();

    const end = markup.indexOf("</button>", toolIdIndex);
    return end >= 0 ? markup.slice(start, end) : markup.slice(start);
  }

  function getDropdownTriggerMarkup(markup: string, toolId: string) {
    const triggerIndex = markup.indexOf(
      `data-tool-dropdown-trigger="${toolId}"`,
    );
    expect(
      triggerIndex >= 0,
      `Expected ${toolId} dropdown trigger markup to exist.`,
    ).toBeTruthy();

    const start = markup.lastIndexOf("<button", triggerIndex);
    expect(
      start >= 0,
      `Expected ${toolId} dropdown trigger button markup to exist.`,
    ).toBeTruthy();

    const end = markup.indexOf("</button>", triggerIndex);
    return end >= 0 ? markup.slice(start, end) : markup.slice(start);
  }

  const workbenchHandlers = {
    activateTool: () => undefined,
    requestPartImport: () => undefined,
    requestRedo: () => undefined,
    requestUndo: () => undefined,
  };

  function renderToolbar({
    onReportBug,
    state,
  }: {
    onReportBug?: () => void;
    state?: Partial<EditorViewState>;
  } = {}) {
    const viewState = {
      ...getEditorViewState(initialEditorState),
      ...state,
    };

    return renderToStaticMarkup(
      <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
        <EditorContext.Provider
          value={{
            machineState: initialEditorState,
            state: viewState,
            dispatch: () => undefined,
            getRuntimeTrace: () => ({
              maxEntries: 0,
              totalEntries: 0,
              droppedEntries: 0,
              entries: [],
            }),
          }}
        >
          <WorkbenchCommandProvider handlers={workbenchHandlers}>
            <WorkspaceToolbar onReportBug={onReportBug} />
          </WorkbenchCommandProvider>
        </EditorContext.Provider>
      </MantineProvider>,
    );
  }

  const toolbarMarkup = renderToolbar();

  expect(
    toolbarMarkup.includes("Search tools"),
    "Toolbar should keep the tool search input.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes('role="combobox"') &&
      toolbarMarkup.includes('aria-autocomplete="list"') &&
      toolbarMarkup.includes('aria-expanded="false"'),
    "Toolbar search should expose collapsed combobox semantics before any results are shown.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes('aria-label="File"') &&
      toolbarMarkup.indexOf('aria-label="File"') <
        toolbarMarkup.indexOf('data-tool-id="undo"'),
    "Toolbar should render the file menu trigger (the spark logo) before the CAD tool sections.",
  ).toBeTruthy();
  const sparkLogoStart = toolbarMarkup.indexOf('aria-label="File"');
  const sparkLogoMarkup = toolbarMarkup.slice(
    sparkLogoStart,
    toolbarMarkup.indexOf("</button>", sparkLogoStart),
  );
  expect(
    sparkLogoMarkup,
    "The spark logo carries the decorative save-activity ring (cadara-781c), idle and hidden from assistive tech.",
  ).toMatch(/<span aria-hidden="true" class="workbench-save-activity-ring" data-save-activity-ring="idle">/);
  expect(
    toolbarMarkup.includes("min-w-0"),
    "Toolbar tool cluster row should be allowed to shrink so the absolute floating bar does not widen the workbench shell.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes('data-toolbar-compaction="families"') &&
      !toolbarMarkup.includes("data-toolbar-collapsed"),
    "Before it can measure, the toolbar should show every island with its tool families collapsed into dropdowns.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes('role="toolbar"') &&
      toolbarMarkup.includes('aria-label="CAD tools"'),
    "Toolbar tool groups should be wrapped in an explicit toolbar landmark.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes("data-icon=\"extrude.svg\""),
    "Toolbar should render standard tool buttons with local SVG assets.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes('data-tool-id="import"') &&
      toolbarMarkup.includes('aria-label="Import"') &&
      toolbarMarkup.includes("data-icon=\"import.svg\""),
    "Toolbar should expose import as a real icon-only tool in part mode.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes("data-icon=\"pattern.svg\""),
    "Toolbar should render dropdown-backed tool triggers with local SVG assets.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes('aria-label="Extrude"'),
    "Toolbar buttons should expose concise accessibility labels based on the tool name.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes('href="https://github.com/dzervas/cadara"') &&
      toolbarMarkup.includes('target="_blank"') &&
      toolbarMarkup.includes('rel="noreferrer"') &&
      toolbarMarkup.includes('aria-label="Open repository on GitHub"') &&
      toolbarMarkup.includes("data-icon=\"GitHub-logo.svg\""),
    "Toolbar should render a safe GitHub repository link at the end.",
  ).toBeTruthy();

  const reportBugToolbarMarkup = renderToolbar({
    onReportBug: () => undefined,
  });

  expect(
    reportBugToolbarMarkup.includes('aria-label="Report bug"') &&
      reportBugToolbarMarkup.includes('type="button"') &&
      reportBugToolbarMarkup.includes("data-icon=\"shell-reportBug.svg\""),
    "Toolbar should render the report-bug action as an icon-only button with local asset and accessible label.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes('data-tool-id="undo"') &&
      toolbarMarkup.includes('data-tool-id="redo"') &&
      getToolMarkup(toolbarMarkup, "undo").includes('data-disabled="true"') &&
      getToolMarkup(toolbarMarkup, "redo").includes('data-disabled="true"'),
    "Undo and redo should render disabled when no history step is available.",
  ).toBeTruthy();
  expect(
    getToolMarkup(toolbarMarkup, "undo").includes("opacity:0.46") &&
      getToolMarkup(toolbarMarkup, "redo").includes("opacity:0.46"),
    "Disabled undo and redo buttons should render with a visibly muted toolbar treatment.",
  ).toBeTruthy();
  expect(
    toolbarMarkup.includes("Filter:"),
    "Toolbar should not duplicate the selection filter debugger readout.",
  ).toBeFalsy();
  expect(
    toolbarMarkup.includes("Requirement:"),
    "Toolbar should not duplicate the requirement debugger readout.",
  ).toBeFalsy();
  expect(
    toolbarMarkup.includes("Slots:"),
    "Toolbar should not duplicate the slot-count debugger readout.",
  ).toBeFalsy();

  const sketchToolbarMarkup = renderToolbar({
    state: {
      mode: "sketch",
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "line",
        phase: "editing",
      },
      sketchSession: withSketchSnapScale(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
        SPEC_SKETCH_UNITS_PER_PIXEL,
      ),
    },
  });

  expect(
    sketchToolbarMarkup.includes('aria-label="Finish Sketch"'),
    "Toolbar should render Finish Sketch while a sketch session is active.",
  ).toBeTruthy();
  expect(
    sketchToolbarMarkup.includes("data-icon=\"line.svg\"") &&
      sketchToolbarMarkup.includes("data-icon=\"dimension.svg\"") &&
      sketchToolbarMarkup.includes("data-icon=\"construction.svg\"") &&
      sketchToolbarMarkup.includes("data-icon=\"svgRendering.svg\"") &&
      sketchToolbarMarkup.includes("data-icon=\"fill.svg\"") &&
      sketchToolbarMarkup.includes("data-icon=\"stroke.svg\""),
    "Sketch toolbar buttons and dropdown triggers should keep local SVG icons.",
  ).toBeTruthy();
  expect(
    sketchToolbarMarkup.includes('data-tool-id="svgRendering"') &&
      sketchToolbarMarkup.includes('data-tool-id="fill"') &&
      sketchToolbarMarkup.includes('data-tool-id="stroke"') &&
      !sketchToolbarMarkup.includes('data-tool-id="fillType"') &&
      !sketchToolbarMarkup.includes('data-tool-id="strokeOptions"'),
    "Sketch toolbar should include the SVG rendering toggle and only Fill/Stroke SVG style tools.",
  ).toBeTruthy();
  expect(
    getDropdownTriggerMarkup(sketchToolbarMarkup, "line").includes(
      "border-left",
    ),
    "Sketch dropdown tools should not render a divider between the tool icon and dropdown affordance.",
  ).toBeFalsy();
  expect(
    getToolMarkup(sketchToolbarMarkup, "fill").includes(
      'data-disabled="true"',
    ) &&
      getToolMarkup(sketchToolbarMarkup, "stroke").includes(
        'data-disabled="true"',
      ) &&
      !getToolMarkup(sketchToolbarMarkup, "svgRendering").includes(
        'aria-pressed="true"',
      ),
    "New sketch sessions should render SVG style controls disabled until SVG rendering is enabled.",
  ).toBeTruthy();
  expect(
    sketchToolbarMarkup.includes("var(--workbench-shell-success-surface)") &&
      sketchToolbarMarkup.includes("var(--workbench-shell-success-border)"),
    "Finish Sketch should use the semantic success treatment from the shared workbench theme.",
  ).toBeTruthy();

  let styledSession = toggleSketchSvgRendering(
    withSketchSnapScale(
      enterSketchSession(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    ),
  );
  styledSession = beginSketchTool(styledSession, "line");
  styledSession = startSketchDraw(styledSession, [0, 0]);
  styledSession = acceptSketchDraw(styledSession, [4, 0]);
  const styleTarget = styledSession.definition.entities[0]?.target;
  expect(
    styleTarget,
    "Toolbar style availability fixture should create a local sketch entity.",
  ).toBeTruthy();
  styledSession = focusSketchStyleTool(styledSession, [styleTarget], "stroke");

  const styleTargetToolbarMarkup = renderToolbar({
    state: {
      mode: "sketch",
      selection: [styleTarget],
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "line",
        phase: "editing",
      },
      sketchSession: styledSession,
    },
  });

  expect(
    getToolMarkup(styleTargetToolbarMarkup, "fill").includes(
      'data-disabled="true"',
    ) &&
      !getToolMarkup(styleTargetToolbarMarkup, "stroke").includes(
        'data-disabled="true"',
      ) &&
      getToolMarkup(styleTargetToolbarMarkup, "stroke").includes(
        'aria-pressed="true"',
      ),
    "Fill and Stroke should remain available while Stroke shows active for a selected sketch entity.",
  ).toBeFalsy();

  const baseSvgDisabledSession = withSketchSnapScale(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  const svgDisabledSession = {
    ...baseSvgDisabledSession,
    definition: {
      ...baseSvgDisabledSession.definition,
      svgRenderingEnabled: false,
    },
  };
  const svgDisabledToolbarMarkup = renderToolbar({
    state: {
      mode: "sketch",
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "line",
        phase: "editing",
      },
      sketchSession: svgDisabledSession,
    },
  });

  expect(
    getToolMarkup(svgDisabledToolbarMarkup, "fill").includes(
      'data-disabled="true"',
    ) &&
      getToolMarkup(svgDisabledToolbarMarkup, "stroke").includes(
        'data-disabled="true"',
      ) &&
      !getToolMarkup(svgDisabledToolbarMarkup, "svgRendering").includes(
        'aria-pressed="true"',
      ),
    "Fill and Stroke should only disable when SVG rendering is off.",
  ).toBeTruthy();

  const constructionSession = {
    ...withSketchSnapScale(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      SPEC_SKETCH_UNITS_PER_PIXEL,
    ),
    constructionModifierActive: true,
  };
  const constructionToolbarMarkup = renderToolbar({
    state: {
      mode: "sketch",
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "line",
        phase: "editing",
      },
      sketchSession: constructionSession,
    },
  });

  expect(
    constructionToolbarMarkup.includes('aria-label="Construction"') &&
      constructionToolbarMarkup.includes('aria-pressed="true"'),
    "Construction should render selected while acting as a sketch modifier.",
  ).toBeTruthy();

  const splineDraft = startSketchDraw(
    beginSketchTool(constructionSession, "spline"),
    [30, 30],
  );
  const draftToolbarMarkup = renderToolbar({
    state: getEditorViewState(enterSketchSessionState(splineDraft)),
  });
  expect(
    getToolMarkup(draftToolbarMarkup, "undo").includes('data-disabled="true"'),
    "A spline draft alone enables the toolbar Undo button without an authored history entry.",
  ).toBeFalsy();
  expect(
    getToolMarkup(draftToolbarMarkup, "redo").includes('data-disabled="true"'),
  ).toBeTruthy();

  const historyToolbarMarkup = renderToolbar({
    state: {
      history: {
        canUndo: true,
        canRedo: false,
      },
    },
  });

  expect(
    getToolMarkup(historyToolbarMarkup, "redo").includes(
      'data-disabled="true"',
    ),
    "Redo should render disabled when no redo step is available.",
  ).toBeTruthy();
  expect(
    getToolMarkup(historyToolbarMarkup, "undo").includes(
      'data-disabled="true"',
    ),
    "Undo should render enabled when an undo step is available.",
  ).toBeFalsy();
  expect(
    getNextToolSearchHighlightIndex(-1, "ArrowDown", 4) === 0 &&
      getNextToolSearchHighlightIndex(0, "ArrowUp", 4) === 0 &&
      getNextToolSearchHighlightIndex(1, "End", 4) === 3 &&
      getNextToolSearchHighlightIndex(3, "Home", 4) === 0 &&
      getNextToolSearchHighlightIndex(0, "Escape", 4) === null,
    "Toolbar search keyboard navigation should clamp within the result set and ignore unrelated keys.",
  ).toBeTruthy();
});
