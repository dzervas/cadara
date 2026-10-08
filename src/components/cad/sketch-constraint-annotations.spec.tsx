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
  startSketchDraw,
  type SketchAnnotationContext,
  type SketchAnnotationDescriptor,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import type { PrimitiveRef } from "@/core/editor/schema";
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
  },
) {
  return renderToStaticMarkup(
    <SketchConstraintAnnotations
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
// are contextual Coincident constraint glyphs, never always-visible chips.
test("T14b T-7: a three-point arc renders no always-visible chip; its bindings preview as Coincident constraints on hover", () => {
  const session = drawnSession("threePointArc", [
    [2, 0],
    [-2, 0],
    [0, 2],
  ]);
  const arc = session.definition.entities[0]!;
  const annotations = getSketchAnnotationDescriptors(session);

  expect(
    renderedAnnotationTags(
      renderAnnotations(annotations, {
        definition: session.definition,
        interactive: true,
      }),
    ),
    "Nothing is visible with nothing hovered or selected.",
  ).toEqual([]);
  const hovered = renderedAnnotationTags(
    renderAnnotations(annotations, {
      hoverTarget: arc.target,
      definition: session.definition,
      interactive: true,
    }),
  );
  const bindings = hovered.filter((tag) =>
    tag.includes('data-sketch-annotation-glyph="constraintCoincident"'),
  );
  expect(bindings, "both bindings preview").toHaveLength(2);
  expect(
    bindings.every(
      (tag) =>
        tag.startsWith("<div") &&
        tag.includes('data-sketch-annotation-kind="constraint"'),
    ),
  ).toBe(true);
  expect(
    hovered.some((tag) =>
      tag.includes('data-sketch-annotation-kind="dimension"'),
    ),
  ).toBe(false);
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
  expect(leftOf(selected, "constraintFixed")).not.toBe("200");

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
