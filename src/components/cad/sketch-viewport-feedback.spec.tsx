import { test, expect } from "vitest";
import { getSketchConstraintDefinition } from "@/core/sketch-constraints/registry";
import type { SketchConstraintTargetRecord } from "@/core/sketch-constraints/definition";
import { FIXTURE_SKETCH_ID } from "@/contracts/sketch/region-extraction.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";

import { SketchViewportFeedbackLayer } from "@/components/cad/sketch-viewport-feedback";
import {
  collectSketchViewportFeedbackAnchors,
  getFloatingInputKeyPatch,
  getSketchToolLabelObstacles,
  placeSketchPointerLabel,
} from "@/components/cad/sketch-viewport-feedback-model";
import type { SketchToolPresentationSchema } from "@/core/sketch-tools/editor-schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import { buildSketchEditToolPresentation } from "@/domain/editor/sketch-session/tools";
import {
  editDimension,
  makeCircleWithDiameterSession,
  openDimensionInput,
} from "@/components/cad/sketch-reference-dimension.fixtures";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchConstraintTarget,
  selectSketchEditToolTarget,
  startSketchDraw,
  updateSketchPointer,
} from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { makeAnnotationLifecycleState } from "@/domain/editor/annotation-lifecycle.fixtures";
import { transitionEditorState } from "@/core/editor/state-machine/reducer-root";
import type { SketchEditorState } from "@/core/editor/state-machine/types";
import {
  eid,
  entityRef,
  entityTarget,
  mirroredSession,
  seedDefinition,
} from "@/domain/editor/sketch-mirror.fixtures";
import { beginSketchMirrorRepair } from "@/domain/editor/sketch-session/mirror-actions";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";

test.each([
  { hotspot: { x: 500, y: 400 }, expected: { x: 538, y: 438 } },
  { hotspot: { x: 1190, y: 790 }, expected: { x: 832, y: 730 } },
  { hotspot: { x: 10, y: 10 }, expected: { x: 48, y: 48 } },
  { hotspot: { x: 1190, y: 10 }, expected: { x: 832, y: 48 } },
  { hotspot: { x: 10, y: 790 }, expected: { x: 48, y: 730 } },
])(
  "pointer chip clears the hotspot and pick box, flipping at edges: $hotspot",
  ({ hotspot, expected }) => {
    const extent = { width: 320, height: 22 };
    const position = placeSketchPointerLabel(hotspot, extent, {
      width: 1200,
      height: 800,
    });
    expect(position).toEqual(expected);
    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.x + extent.width).toBeLessThanOrEqual(1200);
    expect(position.y + extent.height).toBeLessThanOrEqual(800);
    // The hovered point can be 16 px towards the chip from the cursor, and
    // its pick box extends another 16 px. Neither box may reach the chip.
    expect(
      position.x >= hotspot.x + 38 ||
        position.x + extent.width <= hotspot.x - 38,
    ).toBe(true);
    expect(
      position.y >= hotspot.y + 38 ||
        position.y + extent.height <= hotspot.y - 38,
    ).toBe(true);
  },
);

test("Fix Geometry renders both prompt fragments in one offset chip, not centred on the pick", () => {
  const schema: SketchToolPresentationSchema = {
    prompts: [],
    overlays: [
      {
        id: "fix-preview",
        kind: "constraintPreview",
        label: "Fix geometry preview",
        detail: "Select geometry to fix",
        anchor: { kind: "sketchPoint", point: [0, 0] },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <SketchViewportFeedbackLayer
      schema={schema}
      projections={[{ id: "overlay:fix-preview", x: 500, y: 400 }]}
      onPatch={() => undefined}
    />,
  );
  expect(markup.match(/data-sketch-viewport-overlay=/g)).toHaveLength(1);
  expect(markup).toContain("Fix geometry preview");
  expect(markup).toContain("Select geometry to fix");
  expect(markup).toContain("left:538px;top:438px");
  expect(markup).not.toContain("translate(-50%, -50%)");
  expect(markup).toContain("white-space:normal");
});

test.each([
  {
    point: [3, 0.01] as const,
    detail: "On Line 1",
    candidate: "nearestOnLine",
  },
  {
    point: [5, 0.01] as const,
    detail: "Midpoint of Line 1",
    candidate: "midpoint",
  },
  {
    point: [10, 0.01] as const,
    detail: "Coincident · Line 1 end",
    candidate: "endpoint",
  },
])(
  "Point hover shows one offset inferred-constraint hint: $candidate",
  async ({ point, detail, candidate }) => {
    const { state } = await makeAnnotationLifecycleState();
    const armed = transitionEditorState(state, {
      type: "tool.activated",
      toolId: "point",
    }).state;
    const hovered = transitionEditorState(armed, {
      type: "sketch.pointerMoved",
      point,
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
    }).state as SketchEditorState;
    expect(hovered.session.activeInference?.candidate?.kind).toBe(candidate);
    const schema = hovered.session.toolPresentation;
    const projections = collectSketchViewportFeedbackAnchors(schema).map(
      ({ id, anchor }) => ({
        id,
        x: 300 + (anchor.offset?.x ?? 0),
        y: 200 + (anchor.offset?.y ?? 0),
      }),
    );
    const markup = renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={schema}
        projections={projections}
        onPatch={() => undefined}
      />,
    );

    expect(markup).toContain(
      'data-sketch-viewport-overlay="constraintPreview"',
    );
    expect(markup).toContain("left:338px;top:238px");
    expect(markup.match(/Inferred constraint/g)).toHaveLength(1);
    expect(markup.split(detail)).toHaveLength(2);
    expect(markup).not.toContain(
      'data-sketch-viewport-overlay="snapIndicator"',
    );
    expect(
      markup.match(/data-sketch-viewport-geometry="snapIndicator"/g),
    ).toHaveLength(1);
    expect(getSketchToolLabelObstacles(schema, projections)).toEqual([
      { x: 338, y: 238, width: 159 + detail.length * 7, height: 22 },
    ]);

    const suppressed = transitionEditorState(hovered, {
      type: "sketch.inferenceSuppressionChanged",
      held: true,
    }).state as SketchEditorState;
    const free = renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={suppressed.session.toolPresentation}
        projections={projections}
        onPatch={() => undefined}
      />,
    );
    expect(free).not.toContain("Inferred constraint");
    expect(free).not.toContain('data-sketch-viewport-geometry="snapIndicator"');

    const away = transitionEditorState(hovered, {
      type: "sketch.pointerMoved",
      point: [40, 40],
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
    }).state as SketchEditorState;
    const cleared = renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={away.session.toolPresentation}
        projections={projections}
        onPatch={() => undefined}
      />,
    );
    expect(cleared).not.toContain("Inferred constraint");
  },
);

test("src/components/cad/sketch-viewport-feedback.spec.tsx", () => {
  const schema: SketchToolPresentationSchema = {
    prompts: [],
    overlays: [
      {
        id: "rectangle-width-overlay",
        kind: "measurement",
        label: "Width",
        value: 4,
        unit: "mm",
        anchor: { kind: "sketchPoint", point: [2, 0] },
      },
      {
        id: "distance-preview",
        kind: "dimensionLine",
        label: "Horizontal 12.00 mm",
        referenceKind: "horizontal",
        start: [0, 2],
        end: [4, 2],
        value: 12,
        unit: "mm",
        labelled: true,
        dragHandle: { id: "distance-preview-drag", kind: "dimensionLine" },
        labelAnchor: { kind: "sketchPoint", point: [2, 2] },
        extensionLines: [
          {
            id: "distance-preview-extension-a",
            label: "Extension",
            start: [0, 0],
            end: [0, 2],
          },
          {
            id: "distance-preview-extension-b",
            label: "Extension",
            start: [4, 0],
            end: [4, 2],
          },
        ],
      },
      {
        id: "committed-width-overlay",
        kind: "dimensionLine",
        label: "Rectangle 1 width",
        referenceKind: "horizontal",
        start: [0, 3],
        end: [4, 3],
        value: 4,
        unit: "mm",
        labelAnchor: { kind: "sketchPoint", point: [2, 3] },
      },
      {
        id: "parallel-angle-preview",
        kind: "angleArc",
        label: "Angle preview",
        center: [0, 0],
        start: [1, 0],
        end: [0, 1],
        radius: 1,
        side: "major",
        labelAnchor: { kind: "sketchPoint", point: [0.5, 0.5] },
        labelled: true,
        dragHandle: { id: "parallel-angle-preview-drag", kind: "angleArc" },
        witnessLines: [
          {
            id: "parallel-angle-preview-witness-a",
            label: "Witness",
            start: [0.5, 0],
            end: [1, 0],
          },
          {
            id: "parallel-angle-preview-witness-b",
            label: "Witness",
            start: [0, 0.5],
            end: [0, 1],
          },
        ],
      },
      {
        id: "committed-angle-overlay",
        kind: "angleArc",
        label: "Angle dimension",
        center: [0, 0],
        start: [1.5, 0],
        end: [0, 1.5],
        radius: 1.5,
        side: "minor",
        labelAnchor: { kind: "sketchPoint", point: [0.75, 0.75] },
        witnessLines: [
          {
            id: "committed-angle-overlay-witness-a",
            label: "Witness",
            start: [1, 0],
            end: [1.5, 0],
          },
        ],
      },
      {
        id: "rectangle-start-anchor",
        kind: "anchor",
        label: "First corner",
        point: [0, 0],
      },
      {
        id: "rectangle-completion-cue",
        kind: "completionCue",
        label: "Place corner",
        point: [4, 3],
        ready: true,
      },
      {
        id: "active-snap",
        kind: "snapIndicator",
        label: "Midpoint",
        point: [2, 0],
        candidateKind: "midpoint",
        glyphKind: "midpoint",
      },
    ],
    floatingInput: {
      id: "distance-value-input",
      label: "Distance",
      value: "12",
      unit: "mm",
      confirmLabel: "Commit",
      cancelLabel: "Cancel",
      anchor: { kind: "sketchPoint", point: [4, 0] },
      submitAction: {
        type: "patch",
        patch: { intent: "commitConstraintValue" },
      },
      cancelAction: {
        type: "patch",
        patch: { intent: "cancelConstraintValue" },
      },
    },
  };

  const markup = renderToStaticMarkup(
    <SketchViewportFeedbackLayer
      schema={schema}
      projections={[
        { id: "overlay:rectangle-width-overlay", x: 120, y: 80 },
        { id: "overlay:distance-preview", x: 140, y: 70 },
        { id: "overlay-geometry:distance-preview:start", x: 100, y: 100 },
        { id: "overlay-geometry:distance-preview:end", x: 180, y: 100 },
        {
          id: "overlay-geometry:distance-preview-extension-a:start",
          x: 100,
          y: 140,
        },
        {
          id: "overlay-geometry:distance-preview-extension-a:end",
          x: 100,
          y: 100,
        },
        {
          id: "overlay-geometry:distance-preview-extension-b:start",
          x: 180,
          y: 140,
        },
        {
          id: "overlay-geometry:distance-preview-extension-b:end",
          x: 180,
          y: 100,
        },
        { id: "overlay:committed-width-overlay", x: 140, y: 40 },
        { id: "overlay-geometry:committed-width-overlay:start", x: 100, y: 60 },
        { id: "overlay-geometry:committed-width-overlay:end", x: 180, y: 60 },
        { id: "overlay:parallel-angle-preview", x: 160, y: 60 },
        {
          id: "overlay-geometry:parallel-angle-preview:center",
          x: 200,
          y: 120,
        },
        { id: "overlay-geometry:parallel-angle-preview:start", x: 240, y: 120 },
        { id: "overlay-geometry:parallel-angle-preview:end", x: 200, y: 80 },
        {
          id: "overlay-geometry:parallel-angle-preview-witness-a:start",
          x: 220,
          y: 120,
        },
        {
          id: "overlay-geometry:parallel-angle-preview-witness-a:end",
          x: 240,
          y: 120,
        },
        {
          id: "overlay-geometry:parallel-angle-preview-witness-b:start",
          x: 200,
          y: 100,
        },
        {
          id: "overlay-geometry:parallel-angle-preview-witness-b:end",
          x: 200,
          y: 80,
        },
        { id: "overlay:committed-angle-overlay", x: 190, y: 70 },
        {
          id: "overlay-geometry:committed-angle-overlay:center",
          x: 200,
          y: 120,
        },
        {
          id: "overlay-geometry:committed-angle-overlay:start",
          x: 260,
          y: 120,
        },
        { id: "overlay-geometry:committed-angle-overlay:end", x: 200, y: 60 },
        {
          id: "overlay-geometry:committed-angle-overlay-witness-a:start",
          x: 240,
          y: 120,
        },
        {
          id: "overlay-geometry:committed-angle-overlay-witness-a:end",
          x: 260,
          y: 120,
        },
        { id: "overlay:rectangle-start-anchor", x: 100, y: 140 },
        { id: "overlay:rectangle-completion-cue", x: 200, y: 60 },
        { id: "overlay:active-snap", x: 140, y: 100 },
        { id: "floating-input:distance-value-input", x: 180, y: 90 },
      ]}
      onPatch={() => undefined}
    />,
  );

  expect(
    markup.includes('data-sketch-viewport-overlay="measurement"'),
    "Viewport feedback should render measurement overlays from generic descriptors.",
  ).toBeTruthy();
  expect(
    markup.includes("Width") && markup.includes("4.00 mm"),
    "Viewport feedback should render anchored measurement text.",
  ).toBeTruthy();
  expect(
    markup.includes("left:120px") && markup.includes("top:80px"),
    "Viewport feedback should place measurement labels at projected screen positions.",
  ).toBeTruthy();
  expect(
    markup.includes("pointer-events-none absolute"),
    "Viewport feedback should keep transient overlay labels non-interactive so canvas clicks pass through.",
  ).toBeTruthy();
  expect(
    markup.includes(
      'data-sketch-viewport-floating-input="distance-value-input"',
    ),
    "Viewport feedback should render floating numeric input from projected anchors.",
  ).toBeTruthy();
  expect(
    markup.includes("Distance") && markup.includes("Commit"),
    "Viewport feedback should preserve numeric input controls.",
  ).toBeTruthy();
  expect(
    markup.includes("left:clamp(12px, 180px, calc(100% - 232px))") &&
      markup.includes(
        "bottom:clamp(12px, calc(100% - 90px), calc(100% - 144px))",
      ),
    "Viewport feedback should clamp floating numeric input inside the viewport overlay before focusing it.",
  ).toBeTruthy();
  expect(
    markup.includes("autofocus"),
    "Viewport feedback should focus numeric input with preventScroll instead of React autoFocus so offscreen bubbles do not scroll the workbench.",
  ).toBeFalsy();
  expect(
    markup.includes('data-sketch-viewport-geometry="dimensionLine"') &&
      markup.includes('x1="100"'),
    "Viewport feedback should render dimension preview line geometry from projected endpoints.",
  ).toBeTruthy();
  expect(
    markup.includes('data-sketch-viewport-geometry="angleArc"') &&
      markup.includes('data-sketch-viewport-arc-side="major"') &&
      markup.includes("L 200 80") &&
      !markup.includes("A 40 40"),
    "Viewport feedback should render major angle arcs as centered sampled paths from projected line references.",
  ).toBeTruthy();
  expect(
    markup.includes(
      'data-sketch-viewport-drag-handle="distance-preview-drag"',
    ) &&
      markup.includes(
        'data-sketch-viewport-drag-handle="parallel-angle-preview-drag"',
      ),
    "Viewport feedback should expose declared dimension preview geometry as draggable handles.",
  ).toBeTruthy();
  expect(
    markup.includes("Rectangle 1 width"),
    "Committed dimension overlays should leave visible text to the draggable annotation chip.",
  ).toBeFalsy();
  expect(
    markup.includes(
      'data-sketch-viewport-angle-witness="parallel-angle-preview-witness-a"',
    ) &&
      markup.includes(
        'data-sketch-viewport-angle-witness="parallel-angle-preview-witness-b"',
      ) &&
      markup.includes('stroke-dasharray="4 4"'),
    "Viewport feedback should render dashed angular witness lines when the overlay declares them.",
  ).toBeTruthy();
  expect(
    markup.includes(
      'data-sketch-viewport-angle-witness="committed-angle-overlay-witness-a"',
    ),
    "Viewport feedback should render angular witness lines for committed angle arcs without preview drag handles.",
  ).toBeTruthy();
  expect(
    markup.includes("First corner") && !markup.includes("Place corner"),
    "Viewport feedback should suppress non-dimensional anchor and completion tooltips.",
  ).toBeFalsy();
  expect(
    markup.includes('data-sketch-viewport-geometry="snapIndicator"') &&
      markup.includes('data-sketch-snap-kind="midpoint"') &&
      markup.includes("Midpoint"),
    "Viewport feedback should render transient snap indicators and labels.",
  ).toBeTruthy();
});

test("T13b A6 (D29): edit-tool floating inputs offer no variable datalist; dimension inputs still do", () => {
  const target = {
    kind: "sketchEntity",
    sketchId: "sketch_t13b",
    entityId: "sketch_entity_t13b",
  } as unknown as PrimitiveRef;
  const render = (
    floatingInput: SketchToolPresentationSchema["floatingInput"],
  ) =>
    renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={{ prompts: [], overlays: [], floatingInput }}
        projections={[
          { id: `floating-input:${floatingInput!.id}`, x: 180, y: 90 },
        ]}
        documentVariableNames={["w"]}
        onPatch={() => undefined}
      />,
    );
  const editInputs = (
    ["offset", "sketchFillet", "sketchCircularPattern"] as const
  ).map(
    (toolId) =>
      buildSketchEditToolPresentation({
        toolId,
        hoverTarget: null,
        selectedTarget: target,
        selectedTargets: [target],
        offsetDistance: 1,
        offsetSide: "left",
        toolValue: 1,
      }).floatingInput,
  );
  for (const input of editInputs) {
    expect(input, "premise: the edit tool shows a floating input").toBeTruthy();
    const markup = render(input);
    expect(
      markup.includes(`data-sketch-viewport-floating-input="${input!.id}"`),
    ).toBe(true);
    expect(
      markup.includes("<datalist") || markup.includes(" list="),
      `${input!.id}: an operation parameter takes plain numbers, so no variable suggestions`,
    ).toBe(false);
  }

  const dimension = render({
    id: "dimensionDistance-value-input",
    label: "Distance",
    value: null,
    confirmLabel: "Commit",
    cancelLabel: "Cancel",
    submitAction: { type: "patch", patch: { intent: "commitConstraintValue" } },
    cancelAction: { type: "patch", patch: { intent: "cancelConstraintValue" } },
  });
  expect(
    dimension.includes(
      '<datalist id="dimensionDistance-value-input-variables">',
    ) && dimension.includes('<option value="w">'),
    "a dimension value still offers the document variables",
  ).toBe(true);
});

// T13d, UI lane: the dimension edit popup renders Make reference on a
// driving dimension and, on a reference, its measured readout plus Make
// driving; each control dispatches its patch.
test("T13d: the dimension edit popup renders Make reference / Make driving controls", () => {
  const render = (
    floatingInput: SketchToolPresentationSchema["floatingInput"],
  ) =>
    renderToStaticMarkup(
      <MantineProvider>
        <SketchViewportFeedbackLayer
          schema={{ prompts: [], overlays: [], floatingInput }}
          projections={[
            { id: `floating-input:${floatingInput!.id}`, x: 180, y: 90 },
          ]}
          documentVariableNames={[]}
          onPatch={() => undefined}
        />
      </MantineProvider>,
    );
  const driving = editDimension(
    makeCircleWithDiameterSession({ reference: false }),
    0,
  ).toolPresentation?.floatingInput;
  const drivingMarkup = render(driving);
  expect(drivingMarkup).toContain('role="switch"');
  expect(drivingMarkup).toContain('checked=""');
  expect(drivingMarkup).toContain(">Save<");
  expect(drivingMarkup).not.toContain("data-floating-input-readout");

  const referenceSession = editDimension(
    makeCircleWithDiameterSession({ reference: true }),
    0,
  );
  const reference = referenceSession.toolPresentation?.floatingInput;
  const referenceMarkup = render(reference);
  expect(referenceMarkup).toContain("Diameter (reference)");
  expect(referenceMarkup).toMatch(
    /data-floating-input-readout="true">Measured 5\.00 mm</,
  );
  expect(referenceMarkup).toContain(">Make driving<");
  expect(referenceMarkup).not.toContain("Make reference");
  expect(referenceMarkup).toMatch(/<input[^>]*disabled=""[^>]*value="5"/);
  expect(referenceMarkup).not.toContain(">Save<");
  expect(getFloatingInputKeyPatch(reference!, "Enter", false)).toBeNull();
  expect(referenceMarkup).toContain('role="switch"');
  expect(reference?.modeSwitch?.action.patch).toEqual({
    intent: "makeAnnotationDriving",
  });
  expect(driving?.modeSwitch?.action.patch).toEqual({
    intent: "makeAnnotationReference",
  });
  const staged = patchSketchConstraintValue(
    referenceSession,
    reference!.modeSwitch!.action.patch,
  );
  const stagedMarkup = render(staged.toolPresentation?.floatingInput);
  expect(stagedMarkup).toContain(">Save<");
  expect(stagedMarkup).not.toContain('disabled=""');
  expect(stagedMarkup).not.toContain('readOnly=""');
  expect(stagedMarkup).toContain('checked=""');
});

// T13e (D11), UI lane: the Dimension tool's value input in Reference mode
// (an already-determined quantity) renders the measured value read-only, the
// note and an unchecked "Make driving" switch; after the switch it is
// editable with the switch on; an independent quantity shows neither.
test("T13e: the dimension value input renders Reference mode with a read-only measured value, the note and a Make driving switch", () => {
  const render = (
    floatingInput: SketchToolPresentationSchema["floatingInput"],
  ) =>
    renderToStaticMarkup(
      <MantineProvider>
        <SketchViewportFeedbackLayer
          schema={{ prompts: [], overlays: [], floatingInput }}
          projections={[
            { id: `floating-input:${floatingInput!.id}`, x: 180, y: 90 },
          ]}
          documentVariableNames={[]}
          onPatch={() => undefined}
        />
      </MantineProvider>,
    );
  const session = makeCircleWithDiameterSession({ reference: false });
  const opened = openDimensionInput(session, "Rectangle 1 top");
  const reference = opened.toolPresentation?.floatingInput;
  const referenceMarkup = render(reference);
  const valueInput = (markup: string) =>
    markup.match(/<input[^>]*value="4"[^>]*>/)?.[0] ?? "";
  expect(valueInput(referenceMarkup), "the measured value").not.toBe("");
  expect(valueInput(referenceMarkup)).toContain('readOnly=""');
  expect(valueInput(referenceMarkup)).toContain('aria-readonly="true"');
  expect(referenceMarkup).toMatch(
    /data-floating-input-readout="true">Already determined by other requirements</,
  );
  const switchInput = (markup: string) =>
    markup.match(/<input[^>]*role="switch"[^>]*>/)?.[0] ?? "";
  expect(switchInput(referenceMarkup), "a visible switch").not.toBe("");
  expect(switchInput(referenceMarkup)).not.toContain('checked=""');
  expect(referenceMarkup).toContain(">Make driving<");
  expect(referenceMarkup).toContain(">Add reference<");
  expect(reference?.modeSwitch?.action.patch).toEqual({
    intent: "setConstraintValueMode",
    reference: false,
  });

  const driving = patchSketchConstraintValue(
    opened,
    reference!.modeSwitch!.action.patch,
  ).toolPresentation?.floatingInput;
  const drivingMarkup = render(driving);
  expect(valueInput(drivingMarkup)).not.toContain("readOnly");
  expect(switchInput(drivingMarkup)).toContain('checked=""');
  expect(drivingMarkup).toContain(">Commit<");

  const independentMarkup = render(
    openDimensionInput(session, "Rectangle 1 right").toolPresentation
      ?.floatingInput,
  );
  expect(independentMarkup).not.toContain('role="switch"');
  expect(independentMarkup).not.toContain("data-floating-input-readout");
  expect(independentMarkup).not.toContain("readOnly");
});

// T13g, UI lane: the viewport renders the inference text of the live
// placement and of every placed click of an unfinished draft (D15), so all
// the requirements the commit will author are visible before the last click.
test("T13g: placement inference badges render their requirement text", () => {
  let session = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), [2, 2]),
    [6, 2.5],
  );
  session = beginSketchTool(session, "threePointArc");
  session = startSketchDraw(session, [6.02, 2.51]);
  session = updateSketchPointer(session, [4.01, 2.27]);
  const overlays = session.toolPresentation?.overlays ?? [];
  const markup = renderToStaticMarkup(
    <SketchViewportFeedbackLayer
      schema={session.toolPresentation!}
      projections={overlays.map((overlay, index) => ({
        id: `overlay:${overlay.id}`,
        x: 100 + index * 10,
        y: 100,
      }))}
      onPatch={() => undefined}
    />,
  );

  expect(
    markup.includes("Coincident · Line 1 end"),
    "the placed first click keeps its badge text",
  ).toBe(true);
  expect(
    markup.includes("Midpoint of Line 1"),
    "the live placement shows its requirement",
  ).toBe(true);
  expect(
    markup.match(/data-sketch-viewport-geometry="snapIndicator"/g)?.length,
    "one glyph per placement",
  ).toBe(2);
});

// T13j, UI lane: a confirm-only floating input (Merge Points) renders its
// label, readout and Merge/Cancel buttons but no text field, so no focused
// input swallows Enter.
test("T13j: a confirm-only floating input renders no text field", () => {
  const render = (confirmOnly: boolean) =>
    renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={{
          prompts: [],
          overlays: [],
          floatingInput: {
            id: "merge-points-confirm",
            label: "Merge Points",
            value: null,
            readout: "a2 \u2192 a",
            ...(confirmOnly ? { confirmOnly: true as const } : {}),
            confirmLabel: "Merge",
            cancelLabel: "Cancel",
            submitAction: { type: "patch", patch: { intent: "mergePoints" } },
            cancelAction: {
              type: "patch",
              patch: { intent: "cancelSketchEditOperator" },
            },
          },
        }}
        projections={[
          { id: "floating-input:merge-points-confirm", x: 180, y: 90 },
        ]}
        documentVariableNames={["w"]}
        onPatch={() => undefined}
      />,
    );
  const markup = render(true);
  expect(markup).toContain(
    'data-sketch-viewport-floating-input="merge-points-confirm"',
  );
  expect(markup).toContain(">Merge Points<");
  expect(markup).toMatch(/data-floating-input-readout="true">a2 \u2192 a</);
  expect(markup).toContain(">Merge<");
  expect(markup).toContain(">Cancel<");
  expect(markup, "no text field").not.toContain("<input");
  expect(markup, "no variable suggestions").not.toContain("<datalist");
  expect(render(false), "premise: the default renders the field").toContain(
    "<input",
  );
});

// T17f (T17-9′, as T16d review R-1), UI lane; seam: the Merge Points
// presentation built by the real session (entered, T17-10′ builder) and
// rendered by the viewport feedback layer. A refused pick after a staged
// pair keeps the Merge popup (Enter still merges; base: it vanished).
test("T17f: a refused pick after a staged merge keeps the Merge popup", () => {
  const session = enterSketchSession(
    rebuildSessionForDefinition(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      { definition: seedDefinition() },
    ),
  );
  const pointRef = (name: string) =>
    ({
      kind: "sketchPoint",
      sketchId: session.sketchId ?? "sketch_draft",
      pointId: `sketch_point_${name}`,
    }) as PrimitiveRef;
  const staged = ["a", "u"].reduce(
    (current, name) => selectSketchEditToolTarget(current, pointRef(name)),
    beginSketchTool(session, "sketchMergePoints"),
  );
  const refused = selectSketchEditToolTarget(staged, pointRef("c"));
  const render = (schema: SketchToolPresentationSchema | null) =>
    renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={schema}
        projections={[
          { id: "floating-input:merge-points-confirm", x: 300, y: 400 },
        ]}
        onPatch={() => undefined}
      />,
    );
  expect(refused.toolPresentation?.validation?.[0]?.message, "premise: the pick is refused").toMatch(
    /centre/,
  );
  expect(refused.activeEditTool?.selectedTargets).toHaveLength(2);
  for (const markup of [
    render(staged.toolPresentation),
    render(refused.toolPresentation),
  ]) {
    expect(markup).toContain(
      'data-sketch-viewport-floating-input="merge-points-confirm"',
    );
    expect(markup).toMatch(/data-floating-input-readout="true">a \u2192 u</);
    expect(markup).toContain(">Merge<");
  }
});

// T17f review A-7/A-4, UI lane; seam: the key handling of the floating
// input's field (`getFloatingInputKeyPatch`, used by its onKeyDown) on a
// Dimension edit popup built by the real session: Enter is its Save, Escape
// its Cancel, and a key that ends an IME composition is not the popup's.
test("T17f: Enter in a floating value field is the popup's confirm; Escape its Cancel; not while composing", () => {
  const input = editDimension(
    makeCircleWithDiameterSession({ reference: false }),
    0,
  ).toolPresentation!.floatingInput!;
  expect(input.submitAction.patch, "premise: the Save").toEqual({
    intent: "commitAnnotationValue",
  });
  expect(getFloatingInputKeyPatch(input, "Enter", false)).toEqual(
    input.submitAction.patch,
  );
  expect(getFloatingInputKeyPatch(input, "Escape", false)).toEqual(
    input.cancelAction.patch,
  );
  expect(getFloatingInputKeyPatch(input, "Enter", true)).toBe(null);
  expect(getFloatingInputKeyPatch(input, "Escape", true)).toBe(null);
  expect(getFloatingInputKeyPatch(input, "a", false)).toBe(null);
});

// T16d ([TECH] T16-8/T16-21), UI lane; seam: the Mirror tool's presentation
// (built by the real session after each pick) rendered by the viewport
// feedback layer. The confirm-only popup shows "Mirror", the per-pick
// readout and Mirror/Cancel, no text field; its layer lets pointer events
// through except on the popup box itself (pick-through, review A-11).
test("T16d: the Mirror confirm popup renders per pick and only its own box takes the pointer", () => {
  const base = rebuildSessionForDefinition(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    { definition: seedDefinition() },
  );
  let session = beginSketchTool(base, "sketchMirror");
  const markups: string[] = [];
  for (const id of ["c", "ab", "axis"]) {
    session = selectSketchEditToolTarget(
      session,
      entityTarget(id) as PrimitiveRef,
    );
    markups.push(
      renderToStaticMarkup(
        <SketchViewportFeedbackLayer
          schema={session.toolPresentation}
          projections={[
            { id: "floating-input:sketch-mirror-confirm", x: 300, y: 400 },
          ]}
          onPatch={() => undefined}
        />,
      ),
    );
  }
  const [one, two, three] = markups;
  expect(one, "one pick: no popup").not.toContain(
    "data-sketch-viewport-floating-input",
  );
  for (const [markup, readout] of [
    [two!, "1 shape about \u2018ab\u2019"],
    [three!, "2 shapes about \u2018axis\u2019"],
  ] as const) {
    expect(markup).toContain(
      'data-sketch-viewport-floating-input="sketch-mirror-confirm"',
    );
    expect(markup).toContain(">Mirror<");
    expect(markup).toContain(`data-floating-input-readout="true">${readout}<`);
    expect(markup).toContain(">Cancel<");
    expect(markup, "no text field").not.toContain("<input");
    expect(
      markup.match(/pointer-events-auto/g),
      "only the popup box takes pointer events",
    ).toHaveLength(1);
    expect(markup).toContain(
      '<div class="pointer-events-none absolute inset-0 z-40"><div class="pointer-events-auto ',
    );
  }
});

// T16e ([TECH] T16-9), UI lane; seam: the Mirror tool's repair presentation
// (built by the real session) rendered by the viewport feedback layer. Before
// a pick: the prompt, no popup. After a valid pick: the confirm-only popup
// "Replace mirror line" with its readout and Replace/Cancel, no text field;
// only its box takes the pointer.
test("T16e: the Mirror repair prompt, then its Replace/Cancel popup after a pick", () => {
  const { session, relationship } = mirroredSession("free");
  const armed = beginSketchMirrorRepair(
    session,
    relationship.derivationId,
    "axis",
    [],
  );
  const render = (schema: SketchToolPresentationSchema | null) =>
    renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={schema}
        projections={[
          { id: "floating-input:sketch-mirror-repair-confirm", x: 300, y: 400 },
        ]}
        onPatch={() => undefined}
      />,
    );
  const before = render(armed.toolPresentation);
  expect(before, "no popup before a pick").not.toContain(
    "data-sketch-viewport-floating-input",
  );
  const picked = selectSketchEditToolTarget(armed, {
    kind: "sketchDatumReference",
    sketchId: "sketch_draft",
    datumId: "yAxis",
    geometryKind: "lineSegment",
  } as PrimitiveRef);
  const markup = render(picked.toolPresentation);
  expect(markup).toContain(
    'data-sketch-viewport-floating-input="sketch-mirror-repair-confirm"',
  );
  expect(markup).toContain(">Replace mirror line<");
  expect(markup).toContain(
    'data-floating-input-readout="true">Use the sketch Y axis as the mirror line<',
  );
  expect(markup).toContain(">Replace<");
  expect(markup).toContain(">Cancel<");
  expect(markup, "no text field").not.toContain("<input");
  expect(
    markup.match(/pointer-events-auto/g),
    "only the popup box takes pointer events",
  ).toHaveLength(1);
});

// T16f ([TECH] T16-12), UI lane; seam: the routed Dimension tool's popup
// (the shared driver's edit, built by the real session) rendered by the
// viewport feedback layer: the driver's kind and value, the "Shared with …"
// readout and an unchecked "Add as reference instead" switch, no Make
// reference; switched on, the picks' measured value read-only with
// "Add reference".
test("T16f: the routed Dimension popup renders the shared readout and the Add as reference instead switch", () => {
  const setup = mirroredSession("free");
  const session = rebuildSessionForDefinition(setup.session, {
    definition: {
      ...setup.session.definition,
      dimensionIds: ["dimension_seed" as never],
      dimensions: [
        {
          dimensionId: "dimension_seed",
          kind: "circleRadius",
          label: "Radius 2",
          entityId: eid("c"),
          value: { source: "literal", value: 2 },
        } as never,
      ],
    },
  });
  const routed = pinSketchConstraintPreview(
    selectSketchConstraintTarget(
      beginSketchTool(session, "dimensionDistance"),
      entityRef(session, setup.outputOf("c").outputEntityId),
    ),
    [6, 6],
  );
  const render = (
    floatingInput: SketchToolPresentationSchema["floatingInput"],
  ) =>
    renderToStaticMarkup(
      <MantineProvider>
        <SketchViewportFeedbackLayer
          schema={{ prompts: [], overlays: [], floatingInput }}
          projections={[
            { id: `floating-input:${floatingInput!.id}`, x: 180, y: 90 },
          ]}
          documentVariableNames={[]}
          onPatch={() => undefined}
        />
      </MantineProvider>,
    );
  const input = routed.toolPresentation?.floatingInput;
  const markup = render(input);
  expect(markup).toContain(">Radius<");
  expect(markup).toMatch(/<input[^>]*value="2"/);
  expect(markup).toContain(
    'data-floating-input-readout="true">Shared with Radius 2 through mirror \u2018mirror 1\u2019<',
  );
  expect(markup).toContain(">Add as reference instead<");
  const switchInput = (text: string) =>
    text.match(/<input[^>]*role="switch"[^>]*>/)?.[0] ?? "";
  expect(switchInput(markup), "a visible switch").not.toBe("");
  expect(switchInput(markup)).not.toContain('checked=""');
  expect(markup).not.toContain("Make reference");
  expect(markup).toContain(">Save<");

  const switched = render(
    patchSketchConstraintValue(routed, input!.modeSwitch!.action.patch)
      .toolPresentation?.floatingInput,
  );
  expect(switched).toContain("Diameter (reference)");
  expect(switched, "the copy's measured diameter").toMatch(
    /<input[^>]*readOnly=""[^>]*value="4"/,
  );
  expect(switchInput(switched)).toContain('checked=""');
  expect(switched).toContain(">Add reference<");
});

// T17j2 (review A-1), UI lane: while a point dimension's targets are being
// picked its preview keeps its kind label but renders no drag-handle hit
// line (which would sit under the pointer and swallow the second pick);
// once both are picked the placement preview has both.
test("T17j2: a point-dimension preview shows its kind label before the second pick, with no drag-handle hit line; the placement preview has both", () => {
  let session = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [1, 1]),
    [5, 4],
  );
  const [first, , second] = session.definition.points;
  const render = (state: typeof session) => {
    const schema = state.toolPresentation!;
    return renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={schema}
        projections={collectSketchViewportFeedbackAnchors(schema).map(
          (anchor, index) => ({ id: anchor.id, x: 100 + index * 10, y: 100 }),
        )}
        onPatch={() => undefined}
      />,
    );
  };
  for (const [toolId, kind] of [
    ["dimensionDistance", "Aligned"],
    ["dimensionHorizontal", "Horizontal"],
    ["dimensionVertical", "Vertical"],
  ] as const) {
    let picking = selectSketchConstraintTarget(
      beginSketchTool(session, toolId),
      first!.target,
    );
    picking = updateSketchPointer(picking, second!.position);
    const before = render(picking);
    expect(
      before.includes(`data-sketch-viewport-overlay="dimensionLine"`) &&
        before.includes(kind),
      `${toolId}: the preview's kind label is shown before the second pick`,
    ).toBe(true);
    expect(
      before.includes("data-sketch-viewport-drag-handle"),
      `${toolId}: no drag-handle hit line before the second pick`,
    ).toBe(false);
    const placing = updateSketchPointer(
      selectSketchConstraintTarget(picking, second!.target),
      [3, 6],
    );
    const after = render(placing);
    expect(
      after.includes(`data-sketch-viewport-overlay="dimensionLine"`),
      `${toolId}: the placement preview keeps its label`,
    ).toBe(true);
    expect(
      after.includes("data-sketch-viewport-drag-handle"),
      `${toolId}: the placement preview is draggable`,
    ).toBe(true);
  }
});

// The registry supplies the label; the viewport supplies the formatted value.
for (const referenceKind of [
  "aligned",
  "horizontal",
  "vertical",
  "lineLength",
  "lineDistance",
  "pointLineDistance",
  "radius",
  "diameter",
] as const) {
  test(`dimension preview renders one value for ${referenceKind}`, () => {
    const point = (
      anchor: readonly [number, number],
    ): SketchConstraintTargetRecord => ({
      target: {
        kind: "sketchDatumReference",
        sketchId: FIXTURE_SKETCH_ID,
        datumId: "origin",
        geometryKind: "point",
      },
      kind: "point",
      label: "Point",
      anchor,
    });
    const line = {
      ...point([2, 8.68]),
      kind: "line" as const,
      line: { start: [0, 8.68] as const, end: [4, 8.68] as const },
    };
    const circle = {
      ...point([0, 0]),
      kind: "circle" as const,
      circle: { center: [0, 0] as const, radius: 8.68 },
    };
    const targets =
      referenceKind === "lineDistance"
        ? [
            line,
            {
              ...line,
              anchor: [0, 0] as const,
              line: { start: [-1, 0] as const, end: [1, 0] as const },
            },
          ]
        : referenceKind === "lineLength"
          ? [line]
          : referenceKind === "pointLineDistance"
            ? [line, point([0, 0])]
            : referenceKind === "radius" || referenceKind === "diameter"
              ? [circle]
              : [point([0, 0]), point([4, 4])];
    const id =
      referenceKind === "radius"
        ? "dimensionRadius"
        : referenceKind === "horizontal"
          ? "dimensionHorizontal"
          : referenceKind === "vertical"
            ? "dimensionVertical"
            : "dimensionDistance";
    const overlays = getSketchConstraintDefinition(id).buildPreview({
      selectedTargets: targets,
      hoverTarget: null,
      pointer: referenceKind === "aligned" ? [2, 2] : [100, 40],
      value: 8.68,
    });
    expect(overlays[0]).toMatchObject({ kind: "dimensionLine", referenceKind });
    const schema: SketchToolPresentationSchema = {
      prompts: [],
      overlays: overlays.map((overlay) =>
        overlay.kind === "dimensionLine"
          ? { ...overlay, labelled: true }
          : overlay,
      ),
    };
    const projections = collectSketchViewportFeedbackAnchors(schema).map(
      ({ id }) => ({ id, x: 200, y: 200 }),
    );
    const markup = renderToStaticMarkup(
      <SketchViewportFeedbackLayer
        schema={schema}
        projections={projections}
        onPatch={() => undefined}
      />,
    );
    expect(markup.match(/8\.68/g)).toHaveLength(1);
  });
}
