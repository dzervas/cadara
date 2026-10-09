import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchConstraintAnnotations } from "@/components/cad/sketch-constraint-annotations";
import {
  getSketchAnnotationContextRefs,
  isSketchAnnotationIdleContext,
  resolveSketchAnnotationLayer,
  resolveSketchAnnotationVisibility,
} from "@/components/cad/sketch-constraint-annotation-visibility";
import { getAnnotationProjectionId } from "@/components/cad/sketch-viewport-feedback-model";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  getSketchAnnotationDescriptors,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
  startSketchDraw,
  type SketchAnnotationContext,
  type SketchAnnotationDescriptor,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { makeCircleWithDiameterSession } from "@/components/cad/sketch-reference-dimension.fixtures";
import { makeAnnotationLifecycleState } from "@/domain/editor/annotation-lifecycle.fixtures";
import {
  DimensionAnnotationLabelDrag,
  type DimensionAnnotationPointerEvent,
} from "@/components/cad/three-cad-viewport-annotation-drag";

/**
 * T14d: a canvas wide enough for the fixtures below; no top overlay inset, so
 * the anchors these rows use (y = 80) are inside it.
 */
const TEST_LAYOUT_VIEWPORT = {
  width: 4000,
  height: 1000,
  topInset: 0,
  bottomInset: 0,
};

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
      viewport={TEST_LAYOUT_VIEWPORT}
      obstacles={[]}
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
      hoverTarget={null}
      selection={[annotation.target]}
      annotationContext={{ owners: [], last: annotation.target }}
      definition={null}
      interactive
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
  // T14d re-pin (was `left:120px`/`left:158px`, the fixed 38 px ring step):
  // colliding anchors give labels whose estimated rects keep the 6 px gap,
  // all inside the viewport, and the first (the problem) at its anchor.
  const placed = renderedLabelRects(markup, [
    annotation,
    dimensionAnnotation,
    angleDimensionAnnotation,
    horizontalAnnotation,
    verticalAnnotation,
    ...newGlyphAnnotations,
  ]);
  expect(placed, "every annotation renders").toHaveLength(11);
  expectLabelsSeparated(
    placed,
    "Committed annotation glyphs should offset colliding projected anchors without overlapping.",
  );
  expectLabelsInside(placed, TEST_LAYOUT_VIEWPORT);
  expect(
    placed.find((entry) => entry.id === annotation.id)?.centre,
    "the first-placed label (the problem) sits at its anchor",
  ).toEqual({ x: 120, y: 80 });
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
    annotationContext: null,
    hoverTarget: null,
    selection: [],
    definition: null,
  } as const;

  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, idleContext),
    "Constraint annotations should be hidden while no related geometry is hovered or selected.",
  ).toBe("hidden");
  expect(
    resolveSketchAnnotationVisibility(dimensionAnnotation, idleContext),
    "Dimension annotations should stay pinned regardless of hover or selection.",
  ).toBe("pinned");
  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, {
      ...idleContext,
      hoverTarget: lineRef,
    }),
    "T14b T-1: a hovered entity previews its constraint annotations.",
  ).toBe("preview");
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
    "Constraint annotations should be pinned while their affected geometry is selected.",
  ).toBe("pinned");
  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, {
      ...idleContext,
      hoverTarget: constraintAnnotation.target,
    }),
    "T14b T-1: hovering an annotation never makes it visible (a preview cannot be hovered into a control).",
  ).toBe("hidden");
  expect(
    resolveSketchAnnotationVisibility(constraintAnnotation, {
      ...idleContext,
      selection: [constraintAnnotation.target],
    }),
    "The selected annotation stays pinned.",
  ).toBe("pinned");
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
    "Overconstrained constraint annotations should always stay pinned.",
  ).toBe("pinned");

  const markup = renderToStaticMarkup(
    <SketchConstraintAnnotations
      viewport={TEST_LAYOUT_VIEWPORT}
      obstacles={[]}
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
      hoverTarget={lineRef}
      selection={[]}
      annotationContext={null}
      definition={null}
      interactive
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  );
  const preview = renderedAnnotation(markup, "constraintParallel");
  const pinned = renderedAnnotation(markup, "dimensionDistance");

  // T14b T-1: the hover preview is passive markup, the pinned chip a control.
  expect(preview, "premise: the preview renders").toBeTruthy();
  expect(preview).toMatch(/^<div /);
  expect(preview).toContain('data-sketch-annotation-visibility="preview"');
  expect(openingTag(preview)).toContain('aria-hidden="true"');
  expect(preview).toContain("pointer-events-none");
  expect(preview).toContain("opacity-60");
  expect(preview).not.toContain("pointer-events-auto");
  expect(preview).not.toContain("hover:");
  expect(preview).not.toContain("title=");
  expect(preview).not.toContain("aria-label=");
  expect(preview).not.toContain("tabindex");
  expect(markup, "No faded-interactive state remains.").not.toContain("faded");
  expect(pinned, "premise: the pinned chip renders").toBeTruthy();
  expect(pinned).toMatch(/^<button /);
  expect(pinned).toContain('data-sketch-annotation-visibility="pinned"');
  expect(pinned).toContain("pointer-events-auto");
  expect(pinned).toContain(">10.00");
  expect(pinned).toContain('aria-label="Distance: 10.00 mm distance"');
  expect(openingTag(pinned)).not.toContain("aria-hidden");
});

/** The rendered element (opening tag onward) of the annotation with a glyph. */
function renderedAnnotation(markup: string, glyphKind: string) {
  const index = markup.indexOf(`data-sketch-annotation-glyph="${glyphKind}"`);
  if (index < 0) return undefined;
  const start = Math.max(
    markup.lastIndexOf("<button", index),
    markup.lastIndexOf("<div", index),
  );
  return markup.slice(start, markup.indexOf("</", index));
}

function openingTag(element: string | undefined) {
  return element?.slice(0, element.indexOf(">")) ?? "";
}

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
      viewport={TEST_LAYOUT_VIEWPORT}
      obstacles={[]}
      annotations={annotations}
      projections={annotations.map((entry, index) => ({
        id: getAnnotationProjectionId(entry.id),
        x: 100 + index * 60,
        y: 80,
      }))}
      hoveredAnnotation={null}
      hoverTarget={null}
      selection={[]}
      annotationContext={null}
      definition={null}
      interactive
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

/** A session with one tool's geometry drawn through the session API. */
function drawnSession(
  toolId: Parameters<typeof beginSketchTool>[1],
  points: readonly [number, number][],
) {
  let session = startSketchDraw(
    beginSketchTool(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      toolId,
    ),
    points[0]!,
  );
  for (const point of points.slice(1)) {
    session = acceptSketchDraw(session, point);
  }
  return finalizeSketchDraw(session);
}

function makeConstraintDescriptor(
  id: string,
  affectedGeometryRefs: readonly PrimitiveRef[],
  overrides: Partial<SketchAnnotationDescriptor> = {},
): SketchAnnotationDescriptor {
  return {
    id,
    target: { kind: "constraint", sketchId: "sketch_draft", constraintId: id },
    glyphKind: "constraintFixed",
    anchor: { kind: "sketchPoint", point: [0, 0], offset: { x: 18, y: -18 } },
    affectedGeometryRefs,
    constraintDisplay: {
      state: "underconstrained",
      isAffectedOverconstraint: false,
    },
    label: id,
    detail: `${id} detail`,
    status: "constraint",
    ...overrides,
  } as SketchAnnotationDescriptor;
}

function renderAnnotations(
  annotations: readonly SketchAnnotationDescriptor[],
  context: {
    hoveredAnnotation?: SketchAnnotationDescriptor["target"] | null;
    annotationContext?: SketchAnnotationContext | null;
    hoverTarget?: PrimitiveRef | null;
    selection?: readonly PrimitiveRef[];
    definition?: SketchSessionState["definition"] | null;
    interactive: boolean;
    showAll?: boolean;
  },
) {
  return renderToStaticMarkup(
    <SketchConstraintAnnotations
      viewport={TEST_LAYOUT_VIEWPORT}
      obstacles={[]}
      annotations={annotations}
      projections={annotations.map((entry, index) => ({
        id: getAnnotationProjectionId(entry.id),
        x: 100 + index * 200,
        y: 80,
      }))}
      hoveredAnnotation={context.hoveredAnnotation ?? null}
      annotationContext={context.annotationContext ?? null}
      hoverTarget={context.hoverTarget ?? null}
      selection={context.selection ?? []}
      definition={context.definition ?? null}
      interactive={context.interactive}
      showAll={context.showAll}
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  );
}

/** The opening tags of every rendered annotation element. */
function renderedAnnotationTags(markup: string) {
  return [
    ...markup.matchAll(/<(button|div)[^>]*data-sketch-annotation-kind[^>]*>/g),
  ].map((match) => match[0]);
}

// T14b T-5/R-6, UI lane (component markup seam): every rendered annotation
// class is a control only in the idle select context; otherwise it stays
// visible but passive (no button, no name, pointer-events none).
test("T14b T-5/R-6: outside the idle select context every annotation class renders passive", () => {
  const line: PrimitiveRef = {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: "sketch_entity_1_line",
  };
  const selected = makeConstraintDescriptor("constraint_selected", []);
  const hovered = makeConstraintDescriptor("constraint_hovered", [line]);
  const annotations = [
    makeConstraintDescriptor("constraint_pinned", [line]),
    makeConstraintDescriptor("dimension_chip", [], {
      target: {
        kind: "dimension",
        sketchId: "sketch_draft",
        dimensionId: "dimension_chip",
      },
      glyphKind: "dimensionDistance",
      status: "dimension",
      visibleLabel: "10.00",
      dragHandle: {
        id: "dimension_chip-annotation-drag",
        dimensionId: "dimension_chip",
      },
    } as Partial<SketchAnnotationDescriptor>),
    makeConstraintDescriptor("constraint_problem", [], {
      constraintDisplay: {
        state: "overconstrained",
        isAffectedOverconstraint: true,
      },
    }),
    selected,
    hovered,
  ];
  // T14c: the active annotation is `selection[0]`; the line is its owner.
  const context = {
    selection: [selected.target],
    annotationContext: { owners: [line], last: selected.target },
    hoveredAnnotation: hovered.target,
  };

  const idle = renderedAnnotationTags(
    renderAnnotations(annotations, { ...context, interactive: true }),
  );
  expect(idle, "premise: all five classes render").toHaveLength(5);
  expect(
    idle.every((tag) => tag.startsWith("<button")),
    "In the idle select context each class is a button.",
  ).toBe(true);

  const passive = renderedAnnotationTags(
    renderAnnotations(annotations, { ...context, interactive: false }),
  );
  expect(passive, "Every class stays visible.").toHaveLength(5);
  for (const tag of passive) {
    expect(tag).toMatch(/^<div /);
    expect(tag).toContain('aria-hidden="true"');
    expect(tag).toContain("pointer-events-none");
    expect(tag).toContain('data-sketch-annotation-interactive="false"');
    expect(tag).not.toContain("pointer-events-auto");
    expect(tag).not.toContain("aria-label");
    expect(tag).not.toContain("title=");
  }
});

// T14b T-5/R-6, UI lane (visibility module seam): the idle select context.
test("T14b T-5/R-6: a tool, edit tool, special mode, annotation edit, geometry drag or open chooser leaves the idle select context", () => {
  const idle: SketchSessionState = {
    ...drawnSession("line", [
      [0, 0],
      [4, 0],
    ]),
    activeTool: null,
    activeEditTool: null,
    activeSpecialMode: null,
    activeAnnotationEdit: null,
    activeDrag: null,
  };
  const busy = <K extends keyof SketchSessionState>(key: K) =>
    ({ ...idle, [key]: {} }) as SketchSessionState;

  expect(isSketchAnnotationIdleContext(idle, false)).toBe(true);
  expect(isSketchAnnotationIdleContext(null, false), "no sketch").toBe(false);
  expect(
    isSketchAnnotationIdleContext({ ...idle, activeTool: "line" }, false),
    "tool armed",
  ).toBe(false);
  expect(
    isSketchAnnotationIdleContext(busy("activeEditTool"), false),
    "edit tool armed",
  ).toBe(false);
  expect(
    isSketchAnnotationIdleContext(busy("activeSpecialMode"), false),
    "special mode",
  ).toBe(false);
  expect(
    isSketchAnnotationIdleContext(busy("activeAnnotationEdit"), false),
    "annotation edit",
  ).toBe(false);
  expect(
    isSketchAnnotationIdleContext(busy("activeDrag"), false),
    "geometry drag",
  ).toBe(false);
  expect(isSketchAnnotationIdleContext(idle, true), "pick chooser open").toBe(
    false,
  );
});

// T14b T-4, UI lane (visibility module seam): ctx(G).
test("T14b T-4: hovering a line previews the annotations on its end points; a point only its own", () => {
  const session = drawnSession("line", [
    [0, 0],
    [4, 0],
  ]);
  const line = session.definition.entities[0]!;
  const [start, end] = session.definition.points;
  const sketchId = line.target.sketchId;
  const point = (pointId: string): PrimitiveRef => ({
    kind: "sketchPoint",
    sketchId,
    pointId: pointId as never,
  });
  const onStart = makeConstraintDescriptor("constraint_on_start", [
    point(start!.pointId),
  ]);
  const onEnd = makeConstraintDescriptor("constraint_on_end", [
    point(end!.pointId),
  ]);
  const visibility = (
    annotation: SketchAnnotationDescriptor,
    hoverTarget: PrimitiveRef | null,
    selection: readonly PrimitiveRef[] = [],
  ) =>
    resolveSketchAnnotationVisibility(annotation, {
      annotationContext: null,
      hoverTarget,
      selection,
      definition: session.definition,
    });

  expect(visibility(onStart, line.target), "line hover → start").toBe(
    "preview",
  );
  expect(visibility(onEnd, line.target), "line hover → end").toBe("preview");
  expect(
    visibility(onStart, point(start!.pointId)),
    "point hover → the point",
  ).toBe("preview");
  expect(
    visibility(onEnd, point(start!.pointId)),
    "point hover → not the other end",
  ).toBe("hidden");
  expect(
    visibility(onEnd, null, [line.target]),
    "a selected line pins its end points' annotations",
  ).toBe("pinned");

  const markup = renderAnnotations([onStart, onEnd], {
    hoverTarget: line.target,
    definition: session.definition,
    interactive: true,
  });
  const tags = renderedAnnotationTags(markup);
  expect(tags, "both end-point annotations preview").toHaveLength(2);
  expect(
    tags.every(
      (tag) =>
        tag.startsWith("<div") &&
        tag.includes('data-sketch-annotation-visibility="preview"'),
    ),
  ).toBe(true);
});

test("T14b T-4: hovering a tangent handle previews its spline's and its fit point's annotations; a region or datum nothing", () => {
  const session = drawnSession("spline", [
    [0, 0],
    [2, 2],
    [4, 0],
  ]);
  const spline = session.definition.entities[0]!;
  expect(spline.kind, "premise: a spline").toBe("spline");
  const [first, second] = session.definition.points;
  const sketchId = spline.target.sketchId;
  const point = (pointId: string): PrimitiveRef => ({
    kind: "sketchPoint",
    sketchId,
    pointId: pointId as never,
  });
  const handle: PrimitiveRef = {
    kind: "sketchTangentHandle",
    sketchId,
    entityId: spline.entityId,
    occurrenceId: "occurrence",
    pointId: first!.pointId,
  };
  const onSpline = makeConstraintDescriptor("on_spline", [spline.target]);
  const onFitPoint = makeConstraintDescriptor("on_fit_point", [
    point(first!.pointId),
  ]);
  const onOtherFitPoint = makeConstraintDescriptor("on_other_fit_point", [
    point(second!.pointId),
  ]);
  const visibility = (annotation: SketchAnnotationDescriptor) =>
    resolveSketchAnnotationVisibility(annotation, {
      annotationContext: null,
      hoverTarget: handle,
      selection: [],
      definition: session.definition,
    });

  expect(visibility(onSpline)).toBe("preview");
  expect(visibility(onFitPoint)).toBe("preview");
  expect(
    visibility(onOtherFitPoint),
    "another fit point is not the handle's context",
  ).toBe("hidden");
  expect(
    getSketchAnnotationContextRefs(
      { kind: "region", sketchId, regionId: "region_1" as never },
      session.definition,
    ),
  ).toEqual([]);
  expect(
    getSketchAnnotationContextRefs(
      {
        kind: "sketchDatumReference",
        sketchId,
        datumId: "xAxis",
        geometryKind: "lineSegment",
      },
      session.definition,
    ),
  ).toEqual([]);
});

// T14b T-7, UI lane (component over real descriptors): an arc's end bindings
// are never always-visible chips. T14e (Q1/A-9) re-pin: they are not drawn
// in the viewport at all unless they are a problem: not on hover, not when
// the arc is selected, not with Show all.
test("T14b T-7 / T14e Q1: a three-point arc renders no chip; its bindings render on no hover, selection or Show all", () => {
  const session = drawnSession("threePointArc", [
    [2, 0],
    [-2, 0],
    [0, 2],
  ]);
  const arc = session.definition.entities[0]!;
  const annotations = getSketchAnnotationDescriptors(session);
  expect(
    annotations.filter((annotation) => annotation.arcBinding),
    "premise: two binding descriptors",
  ).toHaveLength(2);

  for (const [name, context] of [
    ["nothing hovered or selected", {}],
    ["the arc hovered", { hoverTarget: arc.target }],
    [
      "the arc selected",
      {
        selection: [arc.target],
        annotationContext: { owners: [arc.target], last: null },
      },
    ],
    ["Show all", { showAll: true }],
    [
      "a binding selected from the list",
      {
        selection: [annotations[0]!.target],
        annotationContext: {
          owners: annotations[0]!.affectedGeometryRefs,
          last: annotations[0]!.target,
        },
      },
    ],
  ] as const) {
    const tags = renderedAnnotationTags(
      renderAnnotations(annotations, {
        ...context,
        definition: session.definition,
        interactive: true,
      }),
    );
    expect(
      tags.filter((tag) =>
        tag.includes('data-sketch-annotation-glyph="constraintCoincident"'),
      ),
      `${name}: no binding renders`,
    ).toEqual([]);
    expect(
      tags.some((tag) =>
        tag.includes('data-sketch-annotation-kind="dimension"'),
      ),
      `${name}: no chip`,
    ).toBe(false);
    if (name === "Show all") {
      expect(
        tags.map(
          (tag) => /data-sketch-annotation-glyph="(\w+)"/.exec(tag)?.[1],
        ),
        "contrast: Show all draws the arc's other constraint",
      ).toEqual(["constraintPierce"]);
    }
  }
});

// T14e (Q1, T-17), UI lane (layer model seam): a binding that is a problem is
// drawn like every problem: pinned with nothing selected, interactive idle.
test("T14e Q1/T-17: a problem arc binding is drawn pinned; a quiet one never", () => {
  const arc: PrimitiveRef = {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: "sketch_entity_arc",
  };
  const binding = { arc, arcLabel: "Arc 1" };
  const quiet = makeConstraintDescriptor("constraint_quiet_binding", [arc], {
    glyphKind: "constraintCoincident",
    arcBinding: binding,
  });
  const problem = makeConstraintDescriptor(
    "constraint_problem_binding",
    [arc],
    {
      glyphKind: "constraintCoincident",
      arcBinding: binding,
      constraintDisplay: {
        state: "overconstrained",
        isAffectedOverconstraint: true,
      },
      problem: { status: "conflict", explanation: null },
    },
  );
  const items = resolveSketchAnnotationLayer([quiet, problem], {
    annotationContext: null,
    hoveredAnnotation: null,
    hoverTarget: arc,
    selection: [arc],
    definition: null,
    interactive: true,
    showAll: true,
  }).items;
  expect(
    items.map((item) => [
      item.annotation.id,
      item.visibility,
      item.isInteractive,
    ]),
  ).toEqual([["constraint_problem_binding", "pinned", true]]);
});

// T14e (T-11/A-8, T-5 unchanged), UI lane (component markup seam): Show all
// pins every drawn annotation with nothing selected or hovered: controls in
// the idle select context, passive markup otherwise.
test("T14e T-11: Show all pins every constraint (buttons when idle, passive otherwise); off, they stay hidden", async () => {
  const { state } = await makeAnnotationLifecycleState();
  const annotations = getSketchAnnotationDescriptors(state.session);
  expect(annotations, "premise: four constraints").toHaveLength(4);
  const render = (showAll: boolean, interactive: boolean) =>
    renderedAnnotationTags(
      renderAnnotations(annotations, {
        definition: state.session.definition,
        interactive,
        showAll,
      }),
    );

  expect(render(false, true), "off: nothing selected, nothing shows").toEqual(
    [],
  );
  const idle = render(true, true);
  expect(idle).toHaveLength(4);
  for (const tag of idle) {
    expect(tag).toMatch(/^<button /);
    expect(tag).toContain('data-sketch-annotation-visibility="pinned"');
    expect(tag).toContain('data-sketch-annotation-interactive="true"');
  }
  const armed = render(true, false);
  expect(armed, "still all visible with a tool armed").toHaveLength(4);
  for (const tag of armed) {
    expect(tag).toMatch(/^<div /);
    expect(tag).toContain('data-sketch-annotation-interactive="false"');
  }
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

// T14b review A-1, UI lane (layer model + label drag controller seams): a
// chip that turns passive mid drag no longer carries its drag; it cancels.
test("T14b review A-1: a label drag whose chip turns passive mid drag reports cancel", () => {
  const h = makeLabelDragHarness();
  const layer = (interactive: boolean) =>
    resolveSketchAnnotationLayer([h.annotation], {
      annotationContext: null,
      hoveredAnnotation: null,
      hoverTarget: null,
      selection: [],
      definition: null,
      interactive,
    });
  h.down(10, 10);
  h.move(30, 10);
  h.drag.retainHandles(layer(true).dragHandleIds);
  expect(h.phases, "An interactive chip keeps its drag.").toEqual([
    "start 10,10",
    "move 30,10",
  ]);
  h.drag.retainHandles(layer(false).dragHandleIds);
  expect(h.phases.at(-1), "The chip turned passive.").toBe("cancel 30,10");
});

// T14b review A-2, UI lane (layer model seam): an annotation hover whose chip
// is no longer a control is stale (no pointer leave will clear it).
test("T14b review A-2: the annotation hover is stale once its chip is not a control", () => {
  const line: PrimitiveRef = {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: "sketch_entity_1_line",
  };
  const glyph = makeConstraintDescriptor("constraint_pinned", [line]);
  const stale = (context: {
    hovered: boolean;
    selection: readonly PrimitiveRef[];
    interactive: boolean;
  }) =>
    resolveSketchAnnotationLayer([glyph], {
      annotationContext: null,
      hoveredAnnotation: context.hovered ? glyph.target : null,
      hoverTarget: context.hovered ? glyph.target : null,
      selection: context.selection,
      definition: null,
      interactive: context.interactive,
    }).hoverIsStale;

  expect(
    stale({ hovered: true, selection: [line], interactive: true }),
    "A hovered pinned control is not stale.",
  ).toBe(false);
  expect(
    stale({ hovered: true, selection: [line], interactive: false }),
    "A tool armed under the pointer: the chip turned passive.",
  ).toBe(true);
  expect(
    stale({ hovered: true, selection: [], interactive: true }),
    "The chip is no longer rendered.",
  ).toBe(true);
  expect(
    stale({ hovered: false, selection: [line], interactive: false }),
    "No annotation hover, nothing to clear.",
  ).toBe(false);
});

// T14c (R-5, §2.4), UI lane (component markup seam): after the first blank
// the retained owners keep their contextual annotations pinned and
// interactive (the sibling-reselection defect), and the last selected
// annotation renders subdued; the active annotation renders selected.
test("T14c R-5: after the first blank the retained siblings and the subdued `last` are interactive buttons", async () => {
  const { state, g, a } = await makeAnnotationLifecycleState();
  const annotations = getSketchAnnotationDescriptors(state.session);

  const markup = renderAnnotations(annotations, {
    selection: [],
    annotationContext: { owners: [g], last: a },
    definition: state.session.definition,
    interactive: true,
  });
  const tags = renderedAnnotationTags(markup);
  const labelOf = (tag: string) => /aria-label="([^":]*):/.exec(tag)?.[1];

  expect(
    tags.map(labelOf).sort(),
    "A (Horizontal on G) and its siblings B (Fix on G's start) and C (Parallel G, H); not D (Horizontal on K)",
  ).toEqual(["Fix", "Horizontal", "Parallel"]);
  for (const tag of tags) {
    expect(tag).toMatch(/^<button /);
    expect(tag).toContain('data-sketch-annotation-visibility="pinned"');
    expect(tag).toContain('data-sketch-annotation-interactive="true"');
  }
  const last = tags.filter((tag) =>
    tag.includes('data-sketch-annotation-selection="last"'),
  );
  expect(last.map(labelOf), "exactly A is the subdued last").toEqual([
    "Horizontal",
  ]);
  expect(last[0]).toContain("opacity-80");
  expect(last[0]).not.toContain("border-[var(--cad-accent)]");
  expect(markup, "no annotation is active after the blank").not.toContain(
    'data-sketch-annotation-selection="active"',
  );
});

test("T14c: the active annotation renders selected (not subdued); with a tool armed it stays visible but passive (A2)", async () => {
  const { state, g, h, a, c } = await makeAnnotationLifecycleState();
  const annotations = getSketchAnnotationDescriptors(state.session);

  const active = renderedAnnotationTags(
    renderAnnotations(annotations, {
      selection: [a],
      annotationContext: { owners: [g], last: a },
      definition: state.session.definition,
      interactive: true,
    }),
  );
  const selected = active.filter((tag) =>
    tag.includes('data-sketch-annotation-selection="active"'),
  );
  expect(selected).toHaveLength(1);
  expect(selected[0]).toMatch(/^<button /);
  expect(selected[0]).toContain("Horizontal");
  expect(selected[0]).toContain("border-[var(--cad-accent)]");
  expect(selected[0]).not.toContain("opacity-80");
  expect(
    active.some((tag) =>
      tag.includes('data-sketch-annotation-selection="last"'),
    ),
    "the active annotation is not also rendered as the subdued last",
  ).toBe(false);

  const armed = renderedAnnotationTags(
    renderAnnotations(annotations, {
      selection: [c],
      annotationContext: { owners: [g, h], last: c },
      definition: state.session.definition,
      interactive: false,
    }),
  );
  const refused = armed.filter((tag) =>
    tag.includes('data-sketch-annotation-selection="active"'),
  );
  expect(refused, "the existing duplicate is shown selected").toHaveLength(1);
  expect(refused[0]).toMatch(/^<div /);
  expect(refused[0]).toContain('aria-hidden="true"');
  expect(refused[0]).toContain("pointer-events-none");
});

// T14c (T14b review A-5, decided), UI lane (visibility module seam): the
// datum asymmetry is deliberate. Selecting a datum axis or origin (or
// retaining it as an owner) pins the constraints that reference it; hovering
// it previews nothing, since datums are hovered constantly while drawing.
test("T14c datum asymmetry: a selected or retained datum pins its constraints; a hovered datum previews nothing", () => {
  const xAxis: PrimitiveRef = {
    kind: "sketchDatumReference",
    sketchId: "sketch_draft",
    datumId: "xAxis",
    geometryKind: "lineSegment",
  } as PrimitiveRef;
  const point: PrimitiveRef = {
    kind: "sketchPoint",
    sketchId: "sketch_draft",
    pointId: "sketch_point_1",
  } as PrimitiveRef;
  const onAxis = makeConstraintDescriptor("constraint_on_axis", [point, xAxis]);
  const base = {
    hoverTarget: null,
    selection: [],
    annotationContext: null,
    definition: null,
  };

  expect(
    resolveSketchAnnotationVisibility(onAxis, { ...base, selection: [xAxis] }),
    "selecting the datum pins the constraint referencing it",
  ).toBe("pinned");
  expect(
    resolveSketchAnnotationVisibility(onAxis, {
      ...base,
      annotationContext: { owners: [xAxis], last: null },
    }),
    "a retained datum owner pins it too",
  ).toBe("pinned");
  expect(
    resolveSketchAnnotationVisibility(onAxis, { ...base, hoverTarget: xAxis }),
    "hovering the datum previews nothing",
  ).toBe("hidden");
  expect(
    resolveSketchAnnotationVisibility(onAxis, { ...base, hoverTarget: point }),
    "premise: hovering the point does preview it",
  ).toBe("preview");
});

// T14c, UI lane (component layout-order seam): selecting a dimension chip
// pins its siblings (its affected geometry becomes the owners, §2.4); those
// newly pinned glyphs must not displace the chip just clicked, or the second
// click of a double-click (edit) misses it.
test("T14c: newly pinned siblings never displace an always-visible chip; previews never displace pinned controls", () => {
  const edge: PrimitiveRef = {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: "sketch_entity_2_line",
  };
  const vertical = makeConstraintDescriptor("constraint_vertical", [edge]);
  const length = makeConstraintDescriptor("dimension_length", [edge], {
    target: {
      kind: "dimension",
      sketchId: "sketch_draft",
      dimensionId: "dimension_length",
    },
    glyphKind: "dimensionDistance",
    status: "dimension",
    visibleLabel: "3.60",
  } as Partial<SketchAnnotationDescriptor>);
  const render = (
    annotations: readonly SketchAnnotationDescriptor[],
    context: Parameters<typeof renderAnnotations>[1],
  ) =>
    renderToStaticMarkup(
      <SketchConstraintAnnotations
        viewport={TEST_LAYOUT_VIEWPORT}
        obstacles={[]}
        annotations={annotations}
        projections={annotations.map((entry) => ({
          id: getAnnotationProjectionId(entry.id),
          x: 200,
          y: 80,
        }))}
        hoveredAnnotation={null}
        hoverTarget={context.hoverTarget ?? null}
        selection={context.selection ?? []}
        annotationContext={context.annotationContext ?? null}
        definition={null}
        interactive={context.interactive}
        onHover={() => undefined}
        onClearHover={() => undefined}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
  const leftOf = (markup: string, glyph: string) =>
    /left:(\d+)px/.exec(renderedAnnotation(markup, glyph) ?? "")?.[1];

  expect(
    leftOf(
      render([vertical, length], { interactive: true }),
      "dimensionDistance",
    ),
    "premise: alone, the chip sits at its anchor",
  ).toBe("200");
  const selected = render([vertical, length], {
    selection: [length.target],
    annotationContext: { owners: [edge], last: length.target },
    interactive: true,
  });
  expect(
    renderedAnnotation(selected, "constraintFixed"),
    "premise: the sibling is pinned",
  ).toBeTruthy();
  expect(
    leftOf(selected, "dimensionDistance"),
    "the selected chip stays where it was clicked",
  ).toBe("200");
  expect(
    renderedLabelRects(selected, [vertical, length]).find(
      (entry) => entry.id === vertical.id,
    )?.centre,
    "the newly pinned sibling is displaced off the shared anchor",
  ).not.toEqual({ x: 200, y: 80 });
  expectLabelsSeparated(
    renderedLabelRects(selected, [vertical, length]),
    "the sibling does not overlap the chip",
  );

  const preview = makeConstraintDescriptor("constraint_preview", [
    {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: "sketch_entity_9_line",
    },
  ]);
  const hovered = render([preview, vertical], {
    selection: [edge],
    hoverTarget: {
      kind: "sketchEntity",
      sketchId: "sketch_draft",
      entityId: "sketch_entity_9_line",
    },
    interactive: true,
  });
  expect(
    /left:(\d+)px/.exec(
      renderedAnnotationTags(hovered).find((tag) =>
        tag.includes('data-sketch-annotation-visibility="pinned"'),
      ) ?? "",
    )?.[1],
    "a hover preview never displaces a pinned control",
  ).toBe("200");
});

/** Rendered labels: id, placed centre and estimated rect (T14d). */
function renderedLabelRects(
  markup: string,
  annotations: readonly SketchAnnotationDescriptor[],
) {
  return annotations.flatMap((annotation) => {
    const tag = renderedAnnotationTags(markup).find((entry) =>
      entry.includes(`data-sketch-annotation-glyph="${annotation.glyphKind}"`),
    );
    const match = tag ? /left:([\d.]+)px;top:([\d.]+)px/.exec(tag) : null;
    if (!match) return [];
    const centre = { x: Number(match[1]), y: Number(match[2]) };
    // The rendered box: a 32 × 32 glyph; a chip is its 40 px frame plus
    // 7 px per label character (T14d estimate, pinned against the DOM in E2E).
    const width =
      annotation.status === "dimension"
        ? 40 + [...(annotation.visibleLabel ?? "")].length * 7
        : 32;
    const height = 32;
    return [
      {
        id: annotation.id,
        centre,
        rect: {
          x: centre.x - width / 2,
          y: centre.y - height / 2,
          width,
          height,
        },
      },
    ];
  });
}

function expectLabelsSeparated(
  placed: ReturnType<typeof renderedLabelRects>,
  message: string,
) {
  for (const [index, left] of placed.entries()) {
    for (const right of placed.slice(index + 1)) {
      const gap = Math.max(
        right.rect.x - (left.rect.x + left.rect.width),
        left.rect.x - (right.rect.x + right.rect.width),
        right.rect.y - (left.rect.y + left.rect.height),
        left.rect.y - (right.rect.y + right.rect.height),
      );
      expect(
        gap,
        `${message} (${left.id} / ${right.id})`,
      ).toBeGreaterThanOrEqual(6 - 1e-6);
    }
  }
}

function expectLabelsInside(
  placed: ReturnType<typeof renderedLabelRects>,
  viewport: {
    width: number;
    height: number;
    topInset: number;
    bottomInset: number;
  },
) {
  for (const { id, rect } of placed) {
    expect(rect.x, `${id} inside (left)`).toBeGreaterThanOrEqual(8);
    expect(rect.y, `${id} inside (top)`).toBeGreaterThanOrEqual(
      viewport.topInset + 8,
    );
    expect(rect.x + rect.width, `${id} inside (right)`).toBeLessThanOrEqual(
      viewport.width - 8,
    );
    expect(rect.y + rect.height, `${id} inside (bottom)`).toBeLessThanOrEqual(
      viewport.height - 8,
    );
  }
}

// T14d, UI lane (component layout seam): the annotation layer feeds the
// layout with estimated extents, the viewport and the obstacles, and ranks by
// class (problem > dimension > pinned > preview); selection never changes the
// rank, so a click never reorders labels under the pointer (orchestrator
// option (c)).
function renderLaidOut(
  annotations: readonly SketchAnnotationDescriptor[],
  anchors: readonly { x: number; y: number }[],
  context: {
    selection?: readonly PrimitiveRef[];
    annotationContext?: SketchAnnotationContext | null;
    hoverTarget?: PrimitiveRef | null;
    viewport?: {
      width: number;
      height: number;
      topInset: number;
      bottomInset: number;
    };
    obstacles?: readonly {
      x: number;
      y: number;
      width: number;
      height: number;
    }[];
  } = {},
) {
  return renderToStaticMarkup(
    <SketchConstraintAnnotations
      viewport={context.viewport ?? TEST_LAYOUT_VIEWPORT}
      obstacles={context.obstacles ?? []}
      annotations={annotations}
      projections={annotations.map((entry, index) => ({
        id: getAnnotationProjectionId(entry.id),
        ...anchors[index]!,
      }))}
      hoveredAnnotation={null}
      hoverTarget={context.hoverTarget ?? null}
      selection={context.selection ?? []}
      annotationContext={context.annotationContext ?? null}
      definition={null}
      interactive
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  );
}

const T14D_EDGE: PrimitiveRef = {
  kind: "sketchEntity",
  sketchId: "sketch_draft",
  entityId: "sketch_entity_1_line",
};

function makeDimensionDescriptor(id: string, visibleLabel: string) {
  return makeConstraintDescriptor(id, [T14D_EDGE], {
    target: { kind: "dimension", sketchId: "sketch_draft", dimensionId: id },
    glyphKind: id.endsWith("angle") ? "dimensionAngle" : "dimensionDistance",
    status: "dimension",
    visibleLabel,
  } as Partial<SketchAnnotationDescriptor>);
}

test("T14d: two colliding chips: clicking (selecting) chip B keeps A and B in place", () => {
  const a = makeDimensionDescriptor("dimension_a_distance", "10.00");
  const b = makeDimensionDescriptor("dimension_b_angle", "90.0°");
  const anchors = [
    { x: 500, y: 400 },
    { x: 500, y: 400 },
  ];
  const idle = renderedLabelRects(renderLaidOut([a, b], anchors), [a, b]);
  expect(idle, "premise: both chips render").toHaveLength(2);
  expectLabelsSeparated(idle, "premise: the chips do not overlap");
  expect(
    idle[1]!.centre,
    "premise: B is displaced off the shared anchor",
  ).not.toEqual({ x: 500, y: 400 });

  const clicked = renderedLabelRects(
    renderLaidOut([a, b], anchors, {
      selection: [b.target],
      annotationContext: { owners: [T14D_EDGE], last: b.target },
    }),
    [a, b],
  );
  expect(clicked, "selecting B moves neither chip").toEqual(idle);
});

test("T14d: clicking a pinned glyph among colliding siblings moves no rendered label", () => {
  const siblings = [
    "c_parallel",
    "c_perpendicular",
    "c_horizontal",
    "c_fixed",
  ].map((id, index) =>
    makeConstraintDescriptor(`constraint_${id}`, [T14D_EDGE], {
      glyphKind: (
        [
          "constraintParallel",
          "constraintPerpendicular",
          "constraintHorizontal",
          "constraintFixed",
        ] as const
      )[index],
    }),
  );
  const chipOnTop = makeDimensionDescriptor("dimension_z_distance", "(24.00)");
  const annotations = [...siblings, chipOnTop];
  const anchors = annotations.map(() => ({ x: 600, y: 300 }));
  const pinnedByEdge = renderedLabelRects(
    renderLaidOut(annotations, anchors, { selection: [T14D_EDGE] }),
    annotations,
  );
  expect(pinnedByEdge, "premise: the edge pins every sibling").toHaveLength(5);
  expectLabelsSeparated(pinnedByEdge, "premise: no overlap");

  // Click the last-placed sibling (highest id), then another one.
  for (const clicked of [siblings[3]!, siblings[1]!]) {
    expect(
      renderedLabelRects(
        renderLaidOut(annotations, anchors, {
          selection: [clicked.target],
          annotationContext: { owners: [T14D_EDGE], last: clicked.target },
        }),
        annotations,
      ),
      `clicking ${clicked.id} moves no label`,
    ).toEqual(pinnedByEdge);
  }
});

test("T14d: a problem outranks a dimension and a pinned glyph whatever the input order; a hover preview moves nothing", () => {
  // Review A-2: ids sort against the rank (pinned < dimension < problem), so
  // only the class can put the problem first.
  const problem = makeConstraintDescriptor("problem_z_parallel", [T14D_EDGE], {
    glyphKind: "constraintParallel",
    constraintDisplay: {
      state: "overconstrained",
      isAffectedOverconstraint: true,
    },
  });
  const dimension = makeDimensionDescriptor("dimension_y_distance", "(24.00)");
  const pinned = makeConstraintDescriptor("constraint_x_pinned", [T14D_EDGE], {
    glyphKind: "constraintHorizontal",
  });
  const preview = makeConstraintDescriptor(
    "constraint_a_preview",
    [
      {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: "sketch_entity_9_line",
      },
    ],
    { glyphKind: "constraintVertical" },
  );
  const all = [preview, pinned, dimension, problem];
  const anchors = all.map(() => ({ x: 300, y: 300 }));
  const hovered = renderedLabelRects(
    renderLaidOut(all, anchors, {
      selection: [T14D_EDGE],
      hoverTarget: {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: "sketch_entity_9_line",
      },
    }),
    all,
  );
  expect(hovered).toHaveLength(4);
  expectLabelsSeparated(hovered, "no overlap");
  const centreOf = (id: string) =>
    hovered.find((entry) => entry.id === id)?.centre;
  expect(centreOf(problem.id), "the problem keeps the anchor").toEqual({
    x: 300,
    y: 300,
  });
  const withoutPreview = renderedLabelRects(
    renderLaidOut(all.slice(1), anchors.slice(1), { selection: [T14D_EDGE] }),
    all,
  );
  expect(
    hovered.filter((entry) => entry.id !== preview.id),
    "A-14: the hover preview moved no higher-priority label",
  ).toEqual(withoutPreview);
});

test("T14d: labels avoid the obstacles they are given and clamp into the viewport", () => {
  const dimension = makeDimensionDescriptor("dimension_a_distance", "(24.00)");
  const glyphAtEdge = makeConstraintDescriptor(
    "constraint_b_edge",
    [T14D_EDGE],
    {
      glyphKind: "constraintHorizontal",
    },
  );
  const viewport = { width: 800, height: 600, topInset: 76, bottomInset: 60 };
  const panel = { x: 268, y: 76, width: 260, height: 140 };
  const placed = renderedLabelRects(
    renderLaidOut(
      [dimension, glyphAtEdge],
      [
        { x: 300, y: 150 },
        { x: 795, y: 80 },
      ],
      { selection: [T14D_EDGE], viewport, obstacles: [panel] },
    ),
    [dimension, glyphAtEdge],
  );
  expect(placed).toHaveLength(2);
  expectLabelsInside(placed, viewport);
  const chipRect = placed[0]!.rect;
  expect(
    chipRect.x + chipRect.width <= panel.x ||
      chipRect.x >= panel.x + panel.width ||
      chipRect.y >= panel.y + panel.height,
    "the chip is not under the tool panel",
  ).toBe(true);
});

// T14e (T14d re-review note), UI lane (component layout seam): a glyph
// selected from the Constraints list may not be under the pointer; it is
// identifiable by its active styling, and its rank is not raised: it is
// placed where it is when merely pinned by its owner.
test("T14e: a glyph selected from the list renders active at the place it has when merely pinned", () => {
  const siblings = ["c_parallel", "c_perpendicular", "c_horizontal"].map(
    (id, index) =>
      makeConstraintDescriptor(`constraint_${id}`, [T14D_EDGE], {
        glyphKind: (
          [
            "constraintParallel",
            "constraintPerpendicular",
            "constraintHorizontal",
          ] as const
        )[index],
      }),
  );
  const anchors = siblings.map(() => ({ x: 600, y: 300 }));
  const pinned = renderedLabelRects(
    renderLaidOut(siblings, anchors, { selection: [T14D_EDGE] }),
    siblings,
  );
  expect(pinned, "premise: all three pinned by their edge").toHaveLength(3);

  // The list selects the last-ranked sibling: selection = [it], owners = its
  // affected geometry (T14c "select an annotation").
  const listed = siblings[2]!;
  const markup = renderLaidOut(siblings, anchors, {
    selection: [listed.target],
    annotationContext: { owners: [T14D_EDGE], last: listed.target },
  });
  expect(renderedLabelRects(markup, siblings), "no label moved").toEqual(
    pinned,
  );
  const active = renderedAnnotationTags(markup).filter((tag) =>
    tag.includes('data-sketch-annotation-selection="active"'),
  );
  expect(active, "exactly the listed glyph is active").toHaveLength(1);
  expect(active[0]).toContain(
    'data-sketch-annotation-glyph="constraintHorizontal"',
  );
  expect(active[0]).toContain("border-[var(--cad-accent)]");
});

// T14f (T-9), UI lane (component markup seam): the layer clusters pinned
// glyphs and hover previews, expands at most K of each cluster (4, or 2 for a
// small context extent) and renders one `+N` per collapsed cluster: a
// focusable button when pinned and idle, passive markup otherwise.
const T14F_POINT: PrimitiveRef = {
  kind: "sketchPoint",
  sketchId: "sketch_draft",
  pointId: "t14f_p",
};
const T14F_LINE: PrimitiveRef = {
  kind: "sketchEntity",
  sketchId: "sketch_draft",
  entityId: "t14f_line",
};
/** The line through the dense endpoint, so the point's context is the line. */
const T14F_DEFINITION = {
  entities: [
    {
      entityId: "t14f_line",
      kind: "lineSegment",
      startPointId: "t14f_p",
      endPointId: "t14f_q",
    },
  ],
} as unknown as SketchSessionState["definition"];
const t14fExtents = (lineDiagonal: number) =>
  new Map([[getPrimitiveRefKey(T14F_LINE), lineDiagonal]]);

function makeDenseConstraints(count: number, prefix = "constraint_c") {
  return Array.from({ length: count }, (_, index) =>
    makeConstraintDescriptor(`${prefix}${String(index).padStart(2, "0")}`, [
      T14F_POINT,
    ]),
  );
}

function renderDense(
  annotations: readonly SketchAnnotationDescriptor[],
  context: {
    selection?: readonly PrimitiveRef[];
    annotationContext?: SketchAnnotationContext | null;
    hoverTarget?: PrimitiveRef | null;
    interactive?: boolean;
    showAll?: boolean;
    entityScreenExtents?: ReadonlyMap<string, number>;
    anchors?: readonly { x: number; y: number }[];
  } = {},
) {
  return renderToStaticMarkup(
    <SketchConstraintAnnotations
      viewport={TEST_LAYOUT_VIEWPORT}
      obstacles={[]}
      annotations={annotations}
      projections={annotations.map((entry, index) => ({
        id: getAnnotationProjectionId(entry.id),
        ...(context.anchors?.[index] ?? { x: 600, y: 400 }),
      }))}
      hoveredAnnotation={null}
      hoverTarget={context.hoverTarget ?? null}
      selection={context.selection ?? []}
      annotationContext={context.annotationContext ?? null}
      definition={T14F_DEFINITION}
      interactive={context.interactive ?? true}
      showAll={context.showAll}
      entityScreenExtents={context.entityScreenExtents}
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  );
}

/** Interactive glyph labels (their accessible-name prefix), in markup order. */
function denseButtons(markup: string) {
  return [
    ...markup.matchAll(
      /<button[^>]*data-sketch-annotation-kind[^>]*aria-label="([^":]+):/g,
    ),
  ].map((match) => match[1]);
}

/** Every rendered `+N` element's opening tag. */
function overflowTags(markup: string) {
  return [
    ...markup.matchAll(
      /<(button|div)[^>]*data-sketch-annotation-overflow[^>]*>/g,
    ),
  ].map((match) => match[0]);
}

/** Every label's opening tag with its placed centre (glyphs, chips, `+N`). */
function placedTags(markup: string) {
  return [
    ...markup.matchAll(
      /<(button|div)[^>]*data-sketch-annotation-(?:kind|overflow)[^>]*>/g,
    ),
  ].map((match) => {
    const position = /left:([\d.]+)px;top:([\d.]+)px/.exec(match[0]);
    const name = /aria-label="([^"]*)"/.exec(match[0]);
    return `${name?.[1] ?? "passive"}@${position?.[1]},${position?.[2]}`;
  });
}

test("T14f: 10 constraints on one selected endpoint: 4 glyphs and an interactive `+6`; a small context: 2 and `+8`", () => {
  const dense = makeDenseConstraints(10);
  const markup = renderDense(dense, { selection: [T14F_POINT] });
  expect(denseButtons(markup)).toEqual([
    "constraint_c00",
    "constraint_c01",
    "constraint_c02",
    "constraint_c03",
  ]);
  const [chip, ...otherChips] = overflowTags(markup);
  expect(otherChips).toEqual([]);
  expect(chip).toMatch(/^<button/);
  expect(chip).toContain('aria-label="6 more constraints"');
  expect(chip).toContain('data-sketch-annotation-overflow="6"');
  expect(chip).toContain('data-sketch-annotation-interactive="true"');
  expect(chip).toContain("pointer-events-auto");
  expect(markup).toContain(">+6</button>");
  expect(markup).toContain('data-sketch-annotation-pinned-limit="4"');

  // The point's incident line spans 140 px on screen: K = 2.
  const small = renderDense(dense, {
    selection: [T14F_POINT],
    entityScreenExtents: t14fExtents(140),
  });
  expect(denseButtons(small)).toEqual(["constraint_c00", "constraint_c01"]);
  expect(overflowTags(small)).toHaveLength(1);
  expect(overflowTags(small)[0]).toContain('aria-label="8 more constraints"');
  expect(small).toContain('data-sketch-annotation-pinned-limit="2"');
  expect(small).toContain('data-sketch-annotation-pinned-extent="140"');

  // A large one keeps K = 4.
  expect(
    denseButtons(
      renderDense(dense, {
        selection: [T14F_POINT],
        entityScreenExtents: t14fExtents(400),
      }),
    ),
  ).toHaveLength(4);
});

test("T14f: Show all collapses dense groups too (no selection: the extent of the geometry they affect)", () => {
  const dense = makeDenseConstraints(10);
  const markup = renderDense(dense, { showAll: true });
  expect(denseButtons(markup)).toHaveLength(4);
  expect(
    overflowTags(markup).map((tag) =>
      tag.includes('aria-label="6 more constraints"'),
    ),
  ).toEqual([true]);

  const small = renderDense(dense, {
    showAll: true,
    entityScreenExtents: t14fExtents(100),
  });
  expect(denseButtons(small)).toHaveLength(2);
  expect(overflowTags(small)[0]).toContain('aria-label="8 more constraints"');
});

test("T14f: a hover preview collapses into a passive `+N`; with a tool armed a pinned `+N` is passive too", () => {
  const dense = makeDenseConstraints(10);
  const preview = renderDense(dense, { hoverTarget: T14F_LINE });
  expect(preview, "previews are never buttons").not.toContain("<button");
  expect(
    renderedAnnotationTags(preview).filter((tag) =>
      tag.includes('data-sketch-annotation-visibility="preview"'),
    ),
    "4 previews",
  ).toHaveLength(4);
  const [previewChip] = overflowTags(preview);
  expect(previewChip).toMatch(/^<div aria-hidden="true"/);
  expect(previewChip).toContain('data-sketch-annotation-overflow="6"');
  expect(previewChip).toContain('data-sketch-annotation-visibility="preview"');
  expect(previewChip).toContain("pointer-events-none");
  expect(previewChip).not.toContain("pointer-events-auto");
  expect(previewChip).not.toContain("aria-label");

  const armed = renderDense(dense, {
    selection: [T14F_POINT],
    interactive: false,
  });
  expect(armed).not.toContain("<button");
  const [armedChip] = overflowTags(armed);
  expect(armedChip).toMatch(/^<div aria-hidden="true"/);
  expect(armedChip).toContain('data-sketch-annotation-visibility="pinned"');
  expect(armedChip).toContain('data-sketch-annotation-interactive="false"');
  expect(armedChip).toContain("pointer-events-none");
});

test("T14f: a selected or `last` glyph is always expanded and counts toward K", () => {
  const dense = makeDenseConstraints(10);
  const listed = dense[8]!;
  const selected = renderDense(dense, {
    selection: [listed.target],
    annotationContext: { owners: [T14F_POINT], last: listed.target },
  });
  expect(denseButtons(selected)).toEqual([
    "constraint_c00",
    "constraint_c01",
    "constraint_c02",
    "constraint_c08",
  ]);
  expect(overflowTags(selected)[0]).toContain(
    'aria-label="6 more constraints"',
  );

  // After the first blank: `last` (subdued) stays expanded at K = 2.
  const last = renderDense(dense, {
    annotationContext: { owners: [T14F_POINT], last: listed.target },
    entityScreenExtents: t14fExtents(120),
  });
  expect(denseButtons(last)).toEqual(["constraint_c00", "constraint_c08"]);
  expect(last).toContain('data-sketch-annotation-selection="last"');
  expect(overflowTags(last)[0]).toContain('aria-label="8 more constraints"');
});

test("T14f: a viewport click on an expanded glyph changes neither the expanded set nor any label position", () => {
  const dense = makeDenseConstraints(10);
  const pinned = placedTags(renderDense(dense, { selection: [T14F_POINT] }));
  expect(pinned, "premise: 4 glyphs and the +N").toHaveLength(5);
  for (const clicked of [dense[3]!, dense[0]!]) {
    const after = placedTags(
      renderDense(dense, {
        selection: [clicked.target],
        annotationContext: { owners: [T14F_POINT], last: clicked.target },
      }),
    );
    expect(after, `clicking ${clicked.id}`).toEqual(pinned);
  }
});

test("T14f: dimensions and problems on a dense endpoint are never clustered", () => {
  const constraints = makeDenseConstraints(6);
  const dimensions = Array.from({ length: 6 }, (_, index) =>
    makeConstraintDescriptor(`dimension_d${index}`, [T14F_POINT], {
      target: {
        kind: "dimension",
        sketchId: "sketch_draft",
        dimensionId: `dimension_d${index}`,
      },
      glyphKind: "dimensionDistance",
      status: "dimension",
      visibleLabel: `${index}.00`,
    } as Partial<SketchAnnotationDescriptor>),
  );
  const problems = makeDenseConstraints(6, "constraint_problem_").map(
    (entry) => ({
      ...entry,
      constraintDisplay: {
        state: "overconstrained" as const,
        isAffectedOverconstraint: true,
      },
    }),
  );
  const markup = renderDense([...constraints, ...dimensions, ...problems], {
    selection: [T14F_POINT],
    entityScreenExtents: t14fExtents(100),
  });
  const kinds = renderedAnnotationTags(markup);
  expect(
    kinds.filter((tag) =>
      tag.includes('data-sketch-annotation-kind="dimension"'),
    ),
    "every dimension chip",
  ).toHaveLength(6);
  expect(
    denseButtons(markup).filter((label) =>
      label!.startsWith("constraint_problem_"),
    ),
    "every problem",
  ).toHaveLength(6);
  expect(
    denseButtons(markup).filter((label) => /^constraint_c\d\d$/.test(label!)),
    "K = 2 of the quiet constraints",
  ).toHaveLength(2);
  expect(overflowTags(markup)).toHaveLength(1);
  expect(overflowTags(markup)[0]).toContain('aria-label="4 more constraints"');
});

test("T14f: a selected fillet arc shows its 2 tangents and no `+N`, even at K = 2", () => {
  let session = drawnSession("rectangle", [
    [1, 1],
    [5, 4],
  ]);
  const edge = (label: string) =>
    session.definition.entities.find((entry) => entry.label === label)!;
  session = patchSketchEditToolValue(
    selectSketchEditToolTarget(
      selectSketchEditToolTarget(
        beginSketchTool(session, "sketchFillet"),
        edge("Rectangle 1 bottom").target,
      ),
      edge("Rectangle 1 right").target,
    ),
    { value: 0.3 },
  );
  session = patchSketchEditToolValue(session, {
    intent: "commitSketchEditOperator",
  });
  const arc = session.definition.entities.find((entry) => entry.kind === "arc");
  expect(arc, "premise: the fillet arc").toBeTruthy();
  const annotations = getSketchAnnotationDescriptors(session);
  // 20 px per unit: the arc's two tangent anchors are within 40 px (one
  // cluster), and the arc spans far less than 150 px (K = 2).
  const anchors = annotations.map((annotation) => {
    const anchor = annotation.anchor as {
      point: readonly [number, number];
      offset?: { x: number; y: number };
    };
    return {
      x: 200 + anchor.point[0] * 20 + (anchor.offset?.x ?? 0),
      y: 600 - anchor.point[1] * 20 + (anchor.offset?.y ?? 0),
    };
  });
  const tangentAnchors = annotations.flatMap((annotation, index) =>
    annotation.glyphKind === "constraintTangent" ? [anchors[index]!] : [],
  );
  expect(
    tangentAnchors,
    "premise: the fillet authored 2 tangents",
  ).toHaveLength(2);
  expect(
    Math.hypot(
      tangentAnchors[0]!.x - tangentAnchors[1]!.x,
      tangentAnchors[0]!.y - tangentAnchors[1]!.y,
    ),
    "premise: the tangent anchors are within the 40 px cluster link",
  ).toBeLessThanOrEqual(40);
  const markup = renderToStaticMarkup(
    <SketchConstraintAnnotations
      viewport={TEST_LAYOUT_VIEWPORT}
      obstacles={[]}
      annotations={annotations}
      projections={annotations.map((entry, index) => ({
        id: getAnnotationProjectionId(entry.id),
        ...anchors[index]!,
      }))}
      hoveredAnnotation={null}
      hoverTarget={null}
      selection={[arc!.target]}
      annotationContext={{ owners: [arc!.target], last: null }}
      definition={session.definition}
      interactive
      entityScreenExtents={new Map([[getPrimitiveRefKey(arc!.target), 17]])}
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  );
  expect(markup).toContain('data-sketch-annotation-pinned-limit="2"');
  const glyphs = renderedAnnotationTags(markup).map(
    (tag) => /data-sketch-annotation-glyph="([^"]+)"/.exec(tag)?.[1],
  );
  expect(glyphs, "the 2 tangents, no binding glyph").toEqual([
    "constraintTangent",
    "constraintTangent",
  ]);
  expect(overflowTags(markup)).toEqual([]);
});

test("T14f review R-3: with Show all on, a selected small entity elsewhere does not set K (the affected geometry does)", () => {
  const dense = makeDenseConstraints(10);
  const shortLine: PrimitiveRef = {
    kind: "sketchEntity",
    sketchId: "sketch_draft",
    entityId: "t14f_short",
  };
  const extents = new Map([
    [getPrimitiveRefKey(T14F_LINE), 400],
    [getPrimitiveRefKey(shortLine), 40],
  ]);
  const showAll = renderDense(dense, {
    showAll: true,
    selection: [shortLine],
    annotationContext: { owners: [shortLine], last: null },
    entityScreenExtents: extents,
  });
  expect(showAll).toContain('data-sketch-annotation-pinned-limit="4"');
  expect(showAll).toContain('data-sketch-annotation-pinned-extent="400"');
  expect(denseButtons(showAll)).toHaveLength(4);
  expect(overflowTags(showAll)[0]).toContain('aria-label="6 more constraints"');

  // Contrast, Show all off: the selection is the context (the short line
  // pins nothing here, so nothing renders and no K applies to these glyphs);
  // selecting the dense point with a 40 px incident line gives K = 2.
  const selected = renderDense(dense, {
    selection: [T14F_POINT],
    entityScreenExtents: new Map([[getPrimitiveRefKey(T14F_LINE), 40]]),
  });
  expect(denseButtons(selected)).toHaveLength(2);
});
