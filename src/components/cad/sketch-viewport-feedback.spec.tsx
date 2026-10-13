import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";

import { SketchViewportFeedbackLayer } from "@/components/cad/sketch-viewport-feedback";
import { getFloatingInputKeyPatch } from "@/components/cad/sketch-viewport-feedback-model";
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
  expect(drivingMarkup).toContain("Make reference");
  expect(drivingMarkup).toContain(">Save<");
  expect(drivingMarkup).not.toContain("data-floating-input-readout");

  const reference = editDimension(
    makeCircleWithDiameterSession({ reference: true }),
    0,
  ).toolPresentation?.floatingInput;
  const referenceMarkup = render(reference);
  expect(referenceMarkup).toContain("Diameter (reference)");
  expect(referenceMarkup).toMatch(
    /data-floating-input-readout="true">Measured 5\.00 mm</,
  );
  expect(referenceMarkup).toContain(">Make driving<");
  expect(referenceMarkup).not.toContain("Make reference");
  expect(reference?.submitAction.patch).toEqual({
    intent: "commitAnnotationValue",
  });
  expect(driving?.secondaryAction?.action.patch).toEqual({
    intent: "makeAnnotationReference",
  });
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
  expect(refused.validationMessage, "premise: the pick is refused").toMatch(
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
