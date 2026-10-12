/**
 * T17c2 ([TECH] T17-16): the Close spline panel. UI lane; seam: the
 * selection-context panel state rendered by `SketchCloseSplineAction`
 * (enabled / disabled with its reason / hidden), its click wiring (no DOM
 * test library in the repo: the button's `onClick` is read from the
 * rendered element tree and invoked) and its place in the column. The
 * states are the session's own (`computeSketchCloseSplineState`) for
 * splines drawn with the Spline tool on an entered session; the refusal
 * rules themselves are pinned in the logic lane (`close-spline.spec.ts`).
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { PrimitiveRef } from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  computeSketchCloseSplineState,
  createNewSketchSession,
  finalizeSketchDraw,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { entityRef } from "@/domain/editor/sketch-mirror.fixtures";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { SketchCloseSplineAction } from "./sketch-close-spline-action";
import { SketchSelectionContextStack } from "./sketch-selection-context";
import { SketchTangentActions } from "./sketch-tangent-actions";

function drawn(points: readonly (readonly [number, number])[]) {
  let next = startSketchDraw(
    beginSketchTool(
      withSketchSnapScale(
        enterSketchSession(
          createNewSketchSession(
            createStandardPlaneDefinition("xy"),
            OCC_KERNEL_SETTINGS,
          ),
        ),
        SPEC_SKETCH_UNITS_PER_PIXEL,
      ),
      "spline",
    ),
    points[0]!,
  );
  for (const point of points.slice(1)) next = acceptSketchDraw(next, point);
  return clearActiveSketchTool(finalizeSketchDraw(next));
}
const splineOf = (session: SketchSessionState) =>
  session.definition.entities.find((entity) => entity.kind === "spline")!;
const selected = (session: SketchSessionState): PrimitiveRef[] => [
  entityRef(session, splineOf(session).entityId),
];
/** The panel as the workbench mounts it: only for a non-null state. */
const panel = (session: SketchSessionState) => {
  const state = computeSketchCloseSplineState(session, selected(session));
  return renderToStaticMarkup(
    <MantineProvider>
      {state ? (
        <SketchCloseSplineAction state={state} onClose={() => {}} />
      ) : null}
    </MantineProvider>,
  );
};
const text = (markup: string) => markup.replace(/<[^>]*>/g, "|");
const closeButton = (markup: string) =>
  markup.match(/<button[^>]*data-testid="spline-close"[^>]*>/)?.[0] ?? null;

const open = drawn([
  [1, 1],
  [3, 2.5],
  [5, 1.5],
  [3, -0.5],
]);

test("T17c2: an open spline that can close: Close spline enabled, no reason", () => {
  const markup = panel(open);
  expect(text(markup)).toContain("|Spline|");
  expect(text(markup)).toContain("|Close spline|");
  expect(closeButton(markup)).not.toBeNull();
  expect(closeButton(markup)).not.toContain("disabled");
  expect(markup).not.toContain('data-testid="spline-close-refusal"');
});

test("T17c2: a refused Close spline is shown disabled with its label-based reason", () => {
  const short = drawn([
    [1, 1],
    [4, 2],
  ]);
  const markup = panel(short);
  expect(closeButton(markup)).toContain("disabled");
  expect(markup).toContain(
    `<p data-testid="spline-close-refusal">${splineOf(short).label} has 2 fit points; closing a spline needs at least 3.</p>`,
  );
  expect(markup, "labels, never ids").not.toContain("sketch_entity_");
});

test("T17c2: a closed spline (smooth or positional) shows no panel", () => {
  for (const closure of ["smooth", "positional"] as const) {
    const closed = rebuildSessionForDefinition(open, {
      definition: {
        ...open.definition,
        entities: open.definition.entities.map((entity) =>
          entity.kind === "spline" ? { ...entity, closure } : entity,
        ),
      },
    });
    expect(panel(closed), closure).not.toContain(
      'data-testid="sketch-close-spline-action"',
    );
  }
});

/** Every element of a rendered tree (function components not rendered). */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

test("T17c2: Close spline calls onClose", () => {
  let closed = 0;
  const tree = SketchCloseSplineAction({
    state: computeSketchCloseSplineState(open, selected(open))!,
    onClose: () => (closed += 1),
  });
  const [button] = elements(tree).filter(
    (element) =>
      (element.props as Record<string, unknown>)["data-testid"] ===
      "spline-close",
  );
  (button!.props as { onClick: () => void }).onClick();
  expect(closed).toBe(1);
});

test("T17c2: the Spline panel flows in the selection-context column before Tangent; it is not positioned on its own", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchSelectionContextStack>
        <SketchCloseSplineAction
          state={computeSketchCloseSplineState(open, selected(open))!}
          onClose={() => {}}
        />
        <SketchTangentActions
          resetEnabled={false}
          zeroEnabled
          onReset={() => {}}
          onZero={() => {}}
        />
      </SketchSelectionContextStack>
    </MantineProvider>,
  );
  const positioned = (markup.match(/<[a-z]+ [^>]*>/g) ?? []).filter((tag) =>
    /class="[^"]*\b(absolute|fixed)\b/.test(tag),
  );
  expect(positioned, "exactly one positioned element").toHaveLength(1);
  expect(
    markup.indexOf('data-testid="sketch-close-spline-action"'),
  ).toBeLessThan(markup.indexOf('data-testid="sketch-tangent-actions"'));
});
