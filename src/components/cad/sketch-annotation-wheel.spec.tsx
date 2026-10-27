import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchAnnotationWheel } from "@/components/cad/sketch-annotation-wheel";
import type { SketchAnnotationLayerItem } from "@/components/cad/sketch-constraint-annotation-visibility";
import type { SketchAnnotationDescriptor } from "@/core/editor/sketch-session";

// Lane: ui (docs/testing.md: `src/components/`). Seam: the wheel component's
// markup (`renderToStaticMarkup`): native buttons in tab order (centre, then
// clockwise spokes, then "More…"), each named; the subdued `last` spoke;
// passive markup outside the idle context.

function item(
  id: string,
  state: { isSelected?: boolean; isLast?: boolean } = {},
): SketchAnnotationLayerItem {
  return {
    annotation: {
      id,
      target: {
        kind: "constraint",
        sketchId: "sketch_draft",
        constraintId: id,
      },
      glyphKind: "constraintParallel",
      anchor: { kind: "sketchPoint", point: [0, 0] },
      affectedGeometryRefs: [],
      constraintDisplay: {
        state: "underconstrained",
        isAffectedOverconstraint: false,
      },
      label: id,
      detail: `${id} detail`,
      status: "constraint",
    } as unknown as SketchAnnotationDescriptor,
    visibility: "pinned",
    isInteractive: true,
    isSelected: state.isSelected ?? false,
    isLast: state.isLast ?? false,
  };
}

function render(interactive: boolean) {
  const items = new Map([
    ["annotation:a", item("a", { isSelected: true })],
    ["annotation:b", item("b", { isLast: true })],
    ["annotation:c", item("c")],
  ]);
  return renderToStaticMarkup(
    <SketchAnnotationWheel
      clusterKey="annotation:a"
      layout={{
        centre: { x: 300, y: 200 },
        centreId: "annotation:a",
        spokes: [
          { kind: "member", id: "annotation:b", x: 300, y: 118 },
          { kind: "member", id: "annotation:c", x: 382, y: 200 },
          { kind: "more", ids: ["annotation:d"], x: 300, y: 282 },
        ],
      }}
      items={items}
      collapseCount={2}
      interactive={interactive}
      hoveredAnnotation={null}
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
      onCollapse={() => undefined}
      onMore={() => undefined}
      onFocusWithinChange={() => undefined}
    />,
  );
}

test("T14g: the wheel's controls are named native buttons in tab order: centre, clockwise spokes, More…", () => {
  const markup = render(true);
  const buttons = [
    ...markup.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*>/g),
  ];
  expect(buttons.map((match) => match[1])).toEqual([
    "a: a detail",
    "b: b detail",
    "c: c detail",
    "More: 1 more in the Constraints list",
  ]);
  for (const [tag] of buttons) {
    expect(tag).toContain('type="button"');
    expect(tag).not.toContain("tabindex");
  }
  expect(buttons[0]![0]).toContain(
    'data-sketch-annotation-wheel-slot="centre"',
  );
  expect(buttons[0]![0]).toContain('data-sketch-annotation-selection="active"');
  expect(buttons[1]![0], "the subdued `last` stays a spoke").toContain(
    'data-sketch-annotation-selection="last"',
  );
  expect(buttons[1]![0]).toContain("opacity-80");
  expect(markup).toContain('data-sketch-annotation-wheel="annotation:a"');
});

test("T14g (T-5): a passive wheel has no buttons, names or pointer events", () => {
  const markup = render(false);
  expect(markup).not.toContain("<button");
  expect(markup).not.toContain("aria-label");
  expect(markup).not.toContain("pointer-events-auto");
  expect(markup).toContain('data-sketch-annotation-interactive="false"');
});
