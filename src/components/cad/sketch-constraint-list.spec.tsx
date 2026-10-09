import { expect, test } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import type { PrimitiveRef } from "@/core/editor/schema";
import {
  getSketchAnnotationListRows,
  type SketchAnnotationDescriptor,
} from "@/domain/editor/sketch-session";
import { SketchConstraintList } from "./sketch-constraint-list";

// T14e, UI lane (component markup seam `SketchConstraintList`, rows from the
// list model): problem mark and status text, the reference "(value)" row,
// arc-binding rows under their arc without delete, native buttons, and the
// Show all switch that stays visible when the list is collapsed.

const arc: PrimitiveRef = {
  kind: "sketchEntity",
  sketchId: "sketch_draft",
  entityId: "sketch_entity_arc",
} as PrimitiveRef;

function constraint(
  id: string,
  overrides: Partial<SketchAnnotationDescriptor> = {},
): SketchAnnotationDescriptor {
  return {
    id,
    target: { kind: "constraint", sketchId: "sketch_draft", constraintId: id },
    glyphKind: "constraintHorizontal",
    anchor: { kind: "sketchPoint", point: [0, 0], offset: { x: 0, y: 0 } },
    affectedGeometryRefs: [],
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

const plain = constraint("Horizontal");
const reference = constraint("Diameter", {
  target: {
    kind: "dimension",
    sketchId: "sketch_draft",
    dimensionId: "Diameter",
  },
  glyphKind: "dimensionDistance",
  status: "dimension",
  visibleLabel: "(5.00)",
  reference: true,
  detail: "5.00 mm reference diameter",
} as Partial<SketchAnnotationDescriptor>);
const binding = (id: string) =>
  constraint(id, {
    target: { kind: "dimension", sketchId: "sketch_draft", dimensionId: id },
    glyphKind: "constraintCoincident",
    detail: "Arc start coincident",
    arcBinding: { arc, arcLabel: "Arc 1" },
  } as Partial<SketchAnnotationDescriptor>);
const problem = constraint("Vertical", {
  constraintDisplay: {
    state: "overconstrained",
    isAffectedOverconstraint: true,
  },
  problem: {
    status: "conflict",
    explanation: "Vertical, Horizontal conflict.",
  },
});
const rows = getSketchAnnotationListRows([
  plain,
  binding("ArcStart"),
  reference,
  binding("ArcEnd"),
  problem,
]);

function render(
  options: {
    showAll?: boolean;
    defaultCollapsed?: boolean;
    selection?: readonly PrimitiveRef[];
  } = {},
) {
  return renderToStaticMarkup(
    <MantineProvider>
      <SketchConstraintList
        rows={rows}
        selection={options.selection ?? []}
        hoverTarget={null}
        showAll={options.showAll ?? false}
        defaultCollapsed={options.defaultCollapsed}
        onShowAllChange={() => undefined}
        onHover={() => undefined}
        onClearHover={() => undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
      />
    </MantineProvider>,
  );
}

/** The markup of one row (its `<li>`), by annotation id. */
function rowMarkup(markup: string, id: string) {
  const start = markup.indexOf(`data-sketch-constraint-row="${id}"`);
  expect(start, `row ${id} renders`).toBeGreaterThan(-1);
  return markup.slice(start, markup.indexOf("</li>", start));
}

test("T14e: the problem row is first with its mark and status text; every row is a native button", () => {
  const markup = render();
  const order = [
    ...markup.matchAll(/data-sketch-constraint-row="([^"]+)"/g),
  ].map((match) => match[1]);
  expect(order).toEqual([
    "Vertical",
    "Horizontal",
    "Diameter",
    "ArcStart",
    "ArcEnd",
  ]);

  const problemRow = rowMarkup(markup, "Vertical");
  expect(problemRow).toContain("data-sketch-constraint-problem=");
  expect(problemRow).toContain("data-sketch-constraint-problem-text=");
  expect(problemRow).toContain("Conflict: Vertical, Horizontal conflict.");
  expect(
    problemRow,
    "the reason is in the row button's accessible name",
  ).toMatch(
    /<button[^>]*aria-label="Vertical: Vertical detail\. Conflict: Vertical, Horizontal conflict\."/,
  );
  expect(rowMarkup(markup, "Horizontal")).not.toContain(
    "data-sketch-constraint-problem",
  );
  expect(
    markup,
    "the header counts the problem (visible even when collapsed)",
  ).toContain('data-sketch-constraint-problem-count="1"');
  for (const id of order) {
    expect(rowMarkup(markup, id!)).toMatch(
      /<button type="button" aria-label="[^"]+" aria-pressed="false"/,
    );
  }
});

test("T14e A3: a reference dimension row reads '(value)' with 'reference' in its accessible name", () => {
  const row = rowMarkup(render(), "Diameter");
  expect(row).toContain(">(5.00)<");
  expect(row).toMatch(/aria-label="Diameter: 5\.00 mm reference diameter"/);
});

test("T14e Q1/A-9: arc bindings list under their arc and have no delete button; other rows do", () => {
  const markup = render();
  const headers = [
    ...markup.matchAll(/data-sketch-constraint-group="">([^<]*)</g),
  ];
  expect(
    headers.map((match) => match[1]),
    "one header for both bindings",
  ).toEqual(["Arc 1"]);
  expect(markup.indexOf("data-sketch-constraint-group")).toBeLessThan(
    markup.indexOf('data-sketch-constraint-row="ArcStart"'),
  );
  expect(markup.indexOf('data-sketch-constraint-row="Diameter"')).toBeLessThan(
    markup.indexOf("data-sketch-constraint-group"),
  );
  for (const id of ["ArcStart", "ArcEnd"]) {
    expect(rowMarkup(markup, id), `${id} has no delete`).not.toContain(
      'aria-label="Delete',
    );
  }
  for (const id of ["Vertical", "Horizontal", "Diameter"]) {
    expect(rowMarkup(markup, id)).toContain(`aria-label="Delete ${id}"`);
  }
});

test("T14e T-11/A-8: the Show all switch reflects the flag and stays visible with the list collapsed", () => {
  const off = render();
  const on = render({ showAll: true });
  const switchInput = (markup: string) =>
    /<input[^>]*role="switch"[^>]*>/.exec(markup)?.[0] ?? "";
  expect(off).toContain("Show all constraints");
  expect(switchInput(off), "a switch input renders").not.toBe("");
  expect(switchInput(off)).toContain('data-checked="false"');
  expect(switchInput(off)).not.toMatch(/ checked=""/);
  expect(switchInput(on)).toMatch(/ checked=""/);

  const collapsed = render({ defaultCollapsed: true, showAll: true });
  expect(collapsed).toContain('data-collapsed="true"');
  expect(collapsed, "no rows while collapsed").not.toContain(
    "data-sketch-constraint-row",
  );
  expect(collapsed, "the switch stays visible").toContain(
    "Show all constraints",
  );
  expect(switchInput(collapsed)).toMatch(/ checked=""/);
  expect(collapsed).toContain('data-sketch-constraint-problem-count="1"');
  expect(collapsed).toMatch(
    /aria-expanded="false"[^>]*aria-label="Expand the constraints list"|aria-label="Expand the constraints list"[^>]*aria-expanded="false"/,
  );
});

test("T14e: the selected annotation's row is pressed", () => {
  const markup = render({ selection: [reference.target] });
  expect(rowMarkup(markup, "Diameter")).toContain('aria-pressed="true"');
  expect(rowMarkup(markup, "Diameter")).toContain(
    "data-sketch-constraint-selected=",
  );
  expect(rowMarkup(markup, "Horizontal")).toContain('aria-pressed="false"');
});

test("T14e review A-5: a problem binding names its arc inline; its arc's quiet bindings keep one header", () => {
  const problemBinding = constraint("ArcProblem", {
    target: {
      kind: "dimension",
      sketchId: "sketch_draft",
      dimensionId: "ArcProblem",
    },
    glyphKind: "constraintCoincident",
    detail: "Arc end coincident",
    arcBinding: { arc, arcLabel: "Arc 1" },
    constraintDisplay: {
      state: "overconstrained",
      isAffectedOverconstraint: true,
    },
    problem: { status: "conflict", explanation: null },
  } as Partial<SketchAnnotationDescriptor>);
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchConstraintList
        rows={getSketchAnnotationListRows([
          binding("ArcStart"),
          problemBinding,
          plain,
        ])}
        selection={[]}
        hoverTarget={null}
        showAll={false}
        onShowAllChange={() => undefined}
        onHover={() => undefined}
        onClearHover={() => undefined}
        onSelect={() => undefined}
        onDelete={() => undefined}
      />
    </MantineProvider>,
  );
  expect(
    [...markup.matchAll(/data-sketch-constraint-group="">([^<]*)</g)].map(
      (match) => match[1],
    ),
    "one header, for the quiet binding",
  ).toEqual(["Arc 1"]);
  expect(markup.indexOf("data-sketch-constraint-group")).toBeGreaterThan(
    markup.indexOf('data-sketch-constraint-row="Horizontal"'),
  );
  expect(rowMarkup(markup, "ArcProblem")).toContain(
    "Arc 1 · Arc end coincident",
  );
});
