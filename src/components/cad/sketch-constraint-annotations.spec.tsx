import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchConstraintAnnotations } from "@/components/cad/sketch-constraint-annotations";
import { resolveSketchAnnotationVisibility } from "@/components/cad/sketch-constraint-annotation-visibility";
import { getAnnotationProjectionId } from "@/components/cad/sketch-viewport-feedback-model";
import {
  getSketchAnnotationDescriptors,
  type SketchAnnotationDescriptor,
} from "@/domain/editor/sketch-session";
import { makeCircleWithDiameterSession } from "@/components/cad/sketch-reference-dimension.fixtures";
import {
  DimensionAnnotationLabelDrag,
  type DimensionAnnotationPointerEvent,
} from "@/components/cad/three-cad-viewport-annotation-drag";

test("src/components/cad/sketch-constraint-annotations.spec.tsx", () => {
  const annotation: SketchAnnotationDescriptor = {
    id: "constraint_1_parallel",
    target: {
      kind: "constraint",
      sketchId: "sketch_draft",
      constraintId: "constraint_1_parallel",
    },
    glyphKind: "constraintParallel",
    anchor: { kind: "sketchPoint", point: [5, 2], offset: { x: 18, y: -18 } },
    affectedGeometryRefs: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: "sketch_entity_1_line",
      },
      {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: "sketch_entity_2_line",
      },
    ],
    constraintDisplay: {
      state: "overconstrained",
      isAffectedOverconstraint: true,
    },
    label: "Parallel",
    detail: "Parallel lines",
    status: "constraint",
  };
  const dimensionAnnotation: SketchAnnotationDescriptor = {
    id: "dimension_1_distance",
    target: {
      kind: "dimension",
      sketchId: "sketch_draft",
      dimensionId: "dimension_1_distance",
    },
    glyphKind: "dimensionDistance",
    anchor: { kind: "sketchPoint", point: [5, 2], offset: { x: 0, y: -28 } },
    affectedGeometryRefs: [
      {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: "sketch_point_1_start",
      },
      {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: "sketch_point_1_end",
      },
    ],
    label: "Distance",
    detail: "10.00 mm distance",
    status: "dimension",
    visibleLabel: "10.00",
    dragHandle: {
      id: "dimension_1_distance-annotation-drag",
      dimensionId: "dimension_1_distance",
    },
  };
  const angleDimensionAnnotation: SketchAnnotationDescriptor = {
    ...dimensionAnnotation,
    id: "dimension_2_angle",
    target: {
      kind: "dimension",
      sketchId: "sketch_draft",
      dimensionId: "dimension_2_angle",
    },
    glyphKind: "dimensionAngle",
    label: "Line angle",
    detail: "90.0 deg angle",
    visibleLabel: "90.0°",
    dragHandle: {
      id: "dimension_2_angle-annotation-drag",
      dimensionId: "dimension_2_angle",
    },
  };
  const horizontalAnnotation: SketchAnnotationDescriptor = {
    ...annotation,
    id: "constraint_2_horizontal",
    target: {
      kind: "constraint",
      sketchId: "sketch_draft",
      constraintId: "constraint_2_horizontal",
    },
    glyphKind: "constraintHorizontal",
    label: "Horizontal",
    detail: "Horizontal line",
  };
  const verticalAnnotation: SketchAnnotationDescriptor = {
    ...annotation,
    id: "constraint_3_vertical",
    target: {
      kind: "constraint",
      sketchId: "sketch_draft",
      constraintId: "constraint_3_vertical",
    },
    glyphKind: "constraintVertical",
    label: "Vertical",
    detail: "Vertical line",
  };
  const newGlyphAnnotations: SketchAnnotationDescriptor[] = [
    ["constraintConcentric", "Concentric"],
    ["constraintMidpoint", "Midpoint"],
    ["constraintNormal", "Normal"],
    ["constraintPierce", "Pierce"],
    ["constraintSymmetric", "Symmetric"],
    ["constraintFixed", "Fixed"],
  ].map(([glyphKind, label], index) => ({
    ...annotation,
    id: `constraint_new_${index}`,
    target: {
      kind: "constraint",
      sketchId: "sketch_draft",
      constraintId: `constraint_new_${index}`,
    },
    glyphKind: glyphKind as SketchAnnotationDescriptor["glyphKind"],
    label,
    detail: `${label} constraint`,
  }));

  const markup = renderToStaticMarkup(
    <SketchConstraintAnnotations
      annotations={[
        annotation,
        dimensionAnnotation,
        angleDimensionAnnotation,
        horizontalAnnotation,
        verticalAnnotation,
        ...newGlyphAnnotations,
      ]}
      projections={[
        { id: getAnnotationProjectionId(annotation.id), x: 120, y: 80 },
        {
          id: getAnnotationProjectionId(dimensionAnnotation.id),
          x: 120,
          y: 80,
        },
        {
          id: getAnnotationProjectionId(angleDimensionAnnotation.id),
          x: 180,
          y: 80,
        },
        {
          id: getAnnotationProjectionId(horizontalAnnotation.id),
          x: 220,
          y: 80,
        },
        { id: getAnnotationProjectionId(verticalAnnotation.id), x: 260, y: 80 },
        ...newGlyphAnnotations.map((entry, index) => ({
          id: getAnnotationProjectionId(entry.id),
          x: 300 + index * 36,
          y: 80,
        })),
      ]}
      hoveredAnnotation={annotation.target}
      selectedAnnotation={annotation.target}
      hoverTarget={null}
      selection={[]}
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  );

  expect(
    markup.includes('data-sketch-annotation-glyph="constraintParallel"'),
    "Committed annotation glyphs should render from descriptor glyph kinds.",
  ).toBeTruthy();
  expect(
    markup.includes("z-30"),
    "Committed annotation glyphs should render above committed dimension overlay geometry.",
  ).toBeTruthy();
  expect(
    markup.includes("/icons/sketch-parallel.svg") &&
      markup.includes("/icons/sketch-dimension.svg"),
    "Committed annotation glyphs should use toolbar SVG assets.",
  ).toBeTruthy();
  expect(
    markup.includes("/icons/drawing-angular-dim-line-to-line.svg"),
    "Committed angle dimension annotations should use the angular dimension icon asset.",
  ).toBeTruthy();
  expect(
    markup.includes("/icons/sketch-horizontal.svg") &&
      markup.includes("/icons/sketch-vertical.svg"),
    "Horizontal and vertical constraint annotations should use visible public icon assets.",
  ).toBeTruthy();
  expect(
    markup.includes("/icons/sketch-concentric.svg") &&
      markup.includes("/icons/sketch-midpoint.svg") &&
      markup.includes("/icons/sketch-normal.svg") &&
      markup.includes("/icons/sketch-pierce.svg") &&
      markup.includes("/icons/sketch-symmetric.svg") &&
      markup.includes("/icons/sketch-fix.svg"),
    "New committed constraint glyphs should use their dedicated toolbar SVG assets.",
  ).toBeTruthy();
  expect(
    markup.includes("left:120px") &&
      markup.includes("left:158px") &&
      markup.includes("top:80px"),
    "Committed annotation glyphs should offset colliding projected anchors.",
  ).toBeTruthy();
  expect(
    markup.includes("Parallel: Parallel lines") &&
      markup.includes("Distance: 10.00 mm distance"),
    "Committed annotation glyphs should preserve durable label/detail metadata for accessible labels.",
  ).toBeTruthy();
  expect(
    markup.includes('data-sketch-annotation-kind="dimension"') &&
      markup.includes(">10.00<"),
    "Committed dimensions should render as compact icon-plus-value chips.",
  ).toBeTruthy();
  expect(
    markup.includes("var(--workbench-shell-danger-text)"),
    "Affected overconstrained annotation glyphs should use the shared danger theme token.",
  ).toBeTruthy();
});

test("src/components/cad/sketch-constraint-annotations.spec.tsx visibility", () => {
  const lineRef = {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: "sketch_entity_1_line",
  } as const;
  const otherLineRef = {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: "sketch_entity_9_line",
  } as const;
  const constraintAnnotation: SketchAnnotationDescriptor = {
    id: "constraint_1_parallel",
    target: {
      kind: "constraint",
      sketchId: "sketch_draft",
      constraintId: "constraint_1_parallel",
    },
    glyphKind: "constraintParallel",
    anchor: { kind: "sketchPoint", point: [5, 2], offset: { x: 18, y: -18 } },
    affectedGeometryRefs: [lineRef],
    constraintDisplay: {
      state: "underconstrained",
      isAffectedOverconstraint: false,
    },
    label: "Parallel",
    detail: "Parallel lines",
    status: "constraint",
  };
  const dimensionAnnotation: SketchAnnotationDescriptor = {
    id: "dimension_1_distance",
    target: {
      kind: "dimension",
      sketchId: "sketch_draft",
      dimensionId: "dimension_1_distance",
    },
    glyphKind: "dimensionDistance",
    anchor: { kind: "sketchPoint", point: [5, 2], offset: { x: 0, y: -28 } },
    affectedGeometryRefs: [lineRef],
    label: "Distance",
    detail: "10.00 mm distance",
    status: "dimension",
    visibleLabel: "10.00",
  };
  const idleContext = {
    hoveredAnnotation: null,
    selectedAnnotation: null,
    hoverTarget: null,
    selection: [],
  } as const;

  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, idleContext),
    "Constraint annotations should be hidden while no related geometry is hovered or selected.",
  ).toBe("hidden");
  expect(
    resolveSketchAnnotationVisibility(dimensionAnnotation, idleContext),
    "Dimension annotations should stay visible regardless of hover or selection.",
  ).toBe("visible");
  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, {
      ...idleContext,
      hoverTarget: lineRef,
    }),
    "Constraint annotations should fade in while their affected geometry is hovered.",
  ).toBe("faded");
  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, {
      ...idleContext,
      hoverTarget: otherLineRef,
    }),
    "Constraint annotations should stay hidden while unrelated geometry is hovered.",
  ).toBe("hidden");
  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, {
      ...idleContext,
      selection: [lineRef],
    }),
    "Constraint annotations should be fully visible while their affected geometry is selected.",
  ).toBe("visible");
  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, {
      ...idleContext,
      hoveredAnnotation: constraintAnnotation.target,
    }),
    "Constraint annotations should stay fully visible while the annotation itself is hovered.",
  ).toBe("visible");
  expect(
    resolveSketchAnnotationVisibility(
      {
        ...constraintAnnotation,
        constraintDisplay: {
          state: "overconstrained",
          isAffectedOverconstraint: true,
        },
      },
      idleContext,
    ),
    "Overconstrained constraint annotations should always stay visible.",
  ).toBe("visible");

  const markup = renderToStaticMarkup(
    <SketchConstraintAnnotations
      annotations={[constraintAnnotation, dimensionAnnotation]}
      projections={[
        {
          id: getAnnotationProjectionId(constraintAnnotation.id),
          x: 120,
          y: 80,
        },
        {
          id: getAnnotationProjectionId(dimensionAnnotation.id),
          x: 160,
          y: 80,
        },
      ]}
      hoveredAnnotation={null}
      selectedAnnotation={null}
      hoverTarget={lineRef}
      selection={[]}
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  );

  expect(
    markup.includes('data-sketch-annotation-visibility="faded"') &&
      markup.includes("opacity-60"),
    "Hover-revealed constraint annotations should render semi-transparent.",
  ).toBeTruthy();
  expect(
    markup.includes('data-sketch-annotation-visibility="visible"') &&
      markup.includes(">10.00<"),
    "Dimension annotations should render fully visible alongside faded constraints.",
  ).toBeTruthy();
});

// T13d (D12), UI lane: a reference dimension chip shows its measured value
// in parentheses in the muted tone, and its accessible name says
// "reference"; a driving chip keeps its value and constraint tone.
test("T13d D12: reference dimension chips read '(value)', muted, with 'reference' in the accessible name", () => {
  const session = makeCircleWithDiameterSession({ reference: true });
  const annotations = getSketchAnnotationDescriptors(session).filter(
    (entry) => entry.status === "dimension",
  );
  const markup = renderToStaticMarkup(
    <SketchConstraintAnnotations
      annotations={annotations}
      projections={annotations.map((entry, index) => ({
        id: getAnnotationProjectionId(entry.id),
        x: 100 + index * 60,
        y: 80,
      }))}
      hoveredAnnotation={null}
      selectedAnnotation={null}
      hoverTarget={null}
      selection={[]}
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  );
  const chip = (index: number) =>
    markup
      .split("<button")
      .find((button) =>
        button.includes(
          `aria-label="${session.definition.dimensions[index]!.label}:`,
        ),
      );
  const reference = chip(0);
  expect(reference, "premise: the reference chip renders").toBeTruthy();
  expect(reference).toContain(
    `aria-label="${session.definition.dimensions[0]!.label}: (5.00) mm reference diameter"`,
  );
  expect(reference).toContain(">(5.00)</span>");
  expect(reference).toContain("color:var(--cad-muted-foreground)");
  const driving = chip(1);
  expect(driving, "premise: the driving chip renders").toBeTruthy();
  expect(driving).toContain(">4.00</span>");
  expect(driving).not.toContain("--cad-muted-foreground");
});

/** The chip's label drag driven with pointer events (T14a C1/C2, review R-5). */
function makeLabelDragHarness() {
  const annotation: SketchAnnotationDescriptor = {
    id: "dimension_1_distance",
    target: {
      kind: "dimension",
      sketchId: "sketch_draft",
      dimensionId: "dimension_1_distance",
    },
    glyphKind: "dimensionDistance",
    anchor: { kind: "sketchPoint", point: [5, 2], offset: { x: 0, y: -28 } },
    affectedGeometryRefs: [],
    label: "Distance",
    detail: "10.00 mm distance",
    status: "dimension",
    visibleLabel: "10.00",
    dragHandle: {
      id: "dimension_1_distance-annotation-drag",
      dimensionId: "dimension_1_distance",
    },
  };
  const drag = new DimensionAnnotationLabelDrag();
  const captured = new Set<number>();
  const selected: unknown[] = [];
  const phases: string[] = [];
  const pointer = (
    clientX: number,
    clientY: number,
  ): DimensionAnnotationPointerEvent => ({
    pointerId: 1,
    clientX,
    clientY,
    button: 0,
    isPrimary: true,
    currentTarget: {
      setPointerCapture: (id) => void captured.add(id),
      hasPointerCapture: (id) => captured.has(id),
      releasePointerCapture: (id) => void captured.delete(id),
    },
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  });
  return {
    annotation,
    drag,
    captured,
    selected,
    phases,
    down: (x: number, y: number) => drag.pointerDown(annotation, pointer(x, y)),
    move: (x: number, y: number) =>
      drag.pointerMove(
        annotation,
        pointer(x, y),
        (target) => selected.push(target),
        (_handle, clientX, clientY, phase) =>
          phases.push(`${phase} ${clientX},${clientY}`),
      ),
    up: (x: number, y: number) => drag.pointerEnd(pointer(x, y), "end"),
  };
}

test("T14a: a label press and release within 6 px is a click: no gesture, the click selects", () => {
  const h = makeLabelDragHarness();
  h.down(10, 10);
  h.move(13, 14);
  h.up(13, 14);
  expect(h.phases, "No gesture below the threshold.").toEqual([]);
  expect(h.selected, "The drag does not select; the click does.").toEqual([]);
  expect(
    h.drag.consumeClickSuppression(h.annotation.dragHandle?.id),
    "The click is not suppressed, so it selects.",
  ).toBe(false);
  expect(h.captured.size, "The capture is released.").toBe(0);
});

test("T14a: a label drag past 6 px selects once and reports start, move and end; its click is suppressed once", () => {
  const h = makeLabelDragHarness();
  h.down(10, 10);
  h.move(20, 10);
  h.move(30, 10);
  h.up(30, 10);
  expect(h.selected).toEqual([h.annotation.target]);
  expect(h.phases).toEqual([
    "start 10,10",
    "move 20,10",
    "move 30,10",
    "end 30,10",
  ]);
  expect(h.drag.consumeClickSuppression(h.annotation.dragHandle?.id)).toBe(
    true,
  );
  expect(h.drag.consumeClickSuppression(h.annotation.dragHandle?.id)).toBe(
    false,
  );
  expect(h.captured.size).toBe(0);
  h.drag.lostPointerCapture({ pointerId: 1 });
  expect(
    h.phases,
    "The capture loss that follows a release reports nothing.",
  ).toHaveLength(4);
});

test("T14a: lostpointercapture mid label drag reports cancel and ends the drag", () => {
  const h = makeLabelDragHarness();
  h.down(10, 10);
  h.move(30, 10);
  h.drag.lostPointerCapture({ pointerId: 1 });
  h.move(40, 10);
  h.up(40, 10);
  expect(h.phases).toEqual(["start 10,10", "move 30,10", "cancel 30,10"]);
});

test("T14a: a label drag whose chip or layer unmounts reports cancel", () => {
  const h = makeLabelDragHarness();
  const handleId = h.annotation.dragHandle!.id;
  h.down(10, 10);
  h.move(30, 10);
  h.drag.retainHandles(new Set([handleId]));
  expect(h.phases, "A still-rendered chip keeps its drag.").toEqual([
    "start 10,10",
    "move 30,10",
  ]);
  h.drag.retainHandles(new Set());
  expect(h.phases.at(-1), "The chip unmounted.").toBe("cancel 30,10");

  const layer = makeLabelDragHarness();
  layer.down(10, 10);
  layer.move(30, 10);
  layer.drag.cancel();
  layer.up(30, 10);
  expect(layer.phases, "The layer unmounted.").toEqual([
    "start 10,10",
    "move 30,10",
    "cancel 30,10",
  ]);
  const pressed = makeLabelDragHarness();
  pressed.down(10, 10);
  pressed.drag.cancel();
  expect(pressed.phases, "A press without a drag reports nothing.").toEqual([]);
});
