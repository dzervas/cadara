import { expect, test } from "vitest";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchEntityId, SketchId } from "@/contracts/shared/ids";
import {
  createLineEntityDefinition,
  createPointDefinition,
} from "@/domain/editor/sketch-session/internals";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { SketchPickHint } from "@/components/cad/sketch-pick-hint";
import {
  createSketchPickHint,
  getSketchPickHintText,
  getSketchPickTargetLabel,
  handleSketchPickChooserKeyDown,
  SKETCH_PICK_HINT_LEFT_PX,
} from "@/components/cad/sketch-pick-hint-model";
import {
  createShortcutCommandRegistry,
  getShortcutCommandDefinitions,
} from "@/core/shortcuts/commands";
import { createEffectiveKeymap } from "@/core/shortcuts/keymap";
import { createShortcutResolver } from "@/core/shortcuts/resolver";
import {
  VIEWPORT_FLOATING_PANEL_LEFT_PX,
  VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX,
} from "@/components/cad/viewport-overlay-layout";

// Lane: ui (docs/testing.md). Seam: the overlap hint (T11d, T11-D7): its
// model from a hovered pick stack, its text and its render, including the
// seam for T11e's "Choose…" button.

const sketchId = "sketch_primary" as SketchId;
const definition = (() => {
  const points = [
    createPointDefinition(sketchId, "p_a" as never, "A", [-4, 0]),
    createPointDefinition(sketchId, "p_b" as never, "B", [4, 0]),
  ];
  const base = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  ).definition;
  return {
    ...base,
    points,
    pointIds: points.map((entry) => entry.pointId),
    entities: [
      createLineEntityDefinition(
        sketchId,
        "sketch_entity_1_line" as SketchEntityId,
        "Line 1",
        points[0]!.pointId,
        points[1]!.pointId,
        true,
      ),
      createLineEntityDefinition(
        sketchId,
        "sketch_entity_2_line" as SketchEntityId,
        "Line 2",
        points[0]!.pointId,
        points[1]!.pointId,
      ),
    ],
  };
})();
const construction = definition.entities[0]!.target;
const line = definition.entities[1]!.target;
const xAxis = {
  kind: "sketchDatumReference",
  sketchId,
  datumId: "xAxis",
  geometryKind: "lineSegment",
} satisfies PrimitiveRef;

const render = (node: ReactNode) =>
  renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

test("the hint names the next click's pick and counts the others; one candidate shows none", () => {
  const stack = [line, construction, xAxis];
  const hint = createSketchPickHint({
    stack,
    previewTarget: line,
    cycles: true,
    definition,
  });
  expect(hint).toEqual({ label: "Line 2", more: 2, cycles: true });
  expect(getSketchPickHintText(hint!)).toBe(
    "«Line 2» · 2 more here — click again to cycle · Alt+click to choose",
  );
  expect(
    createSketchPickHint({
      stack,
      previewTarget: construction,
      cycles: true,
      definition,
    })?.label,
    "While a cycle is armed it names the armed next pick.",
  ).toBe("Construction line 1");
  expect(
    createSketchPickHint({
      stack: [line],
      previewTarget: line,
      cycles: true,
      definition,
    }),
    "A single eligible candidate needs no hint.",
  ).toBeNull();
  expect(
    getSketchPickHintText(
      createSketchPickHint({
        stack,
        previewTarget: line,
        cycles: false,
        definition,
      })!,
    ),
    "Immediate-action contexts do not teach a cycle they do not have.",
  ).toBe("«Line 2» · 2 more here · Alt+click to choose");
  expect(getSketchPickTargetLabel(xAxis, definition)).toBe("X axis");
  // T12d: tangent handle label in the chooser.
  const handleTarget: import("@/core/editor/schema").PrimitiveRef = {
    kind: "sketchTangentHandle",
    sketchId: "sketch_1" as import("@/contracts/shared/ids").SketchId,
    entityId: "e1" as import("@/contracts/shared/ids").SketchEntityId,
    occurrenceId: "occ_0",
    pointId: "p1" as import("@/contracts/shared/ids").SketchPointId,
  };
  expect(
    getSketchPickTargetLabel(handleTarget, definition),
    "T12d: tangent handle should be labelled 'Tangent handle' in the chooser.",
  ).toBe("Tangent handle");
});

test("the hint chip renders top-left, beside the tool panel slot, with a Choose… seam for T11e", () => {
  const hint = { label: "Line 2", more: 2, cycles: true };
  const markup = render(<SketchPickHint hint={hint} />);
  expect(markup).toContain('data-testid="sketch-pick-hint"');
  expect(markup).toContain(
    "«Line 2» · 2 more here — click again to cycle · Alt+click to choose",
  );
  expect(markup, "No chooser yet: no button.").not.toContain("Choose…");
  expect(markup).toContain("pointer-events-none");
  const withChooser = render(
    <SketchPickHint hint={hint} onChoose={() => undefined} />,
  );
  expect(withChooser).toContain("Choose…");
  expect(withChooser).toContain("pointer-events-auto");
  expect(render(<SketchPickHint hint={null} />)).not.toContain(
    "sketch-pick-hint",
  );
  expect(
    SKETCH_PICK_HINT_LEFT_PX,
    "Past the tool panel (one shared width) in the floating panel slot.",
  ).toBeGreaterThan(
    VIEWPORT_FLOATING_PANEL_LEFT_PX + VIEWPORT_SKETCH_TOOL_PANEL_WIDTH_PX,
  );
});

// T11e (UI lane). Seam: the chooser's keydown handler composed with the
// window shortcut resolver in the order the browser runs them: the
// chooser's window capture-phase listener, then (unless propagation was
// stopped) the shortcut provider's bubble listener (review R-1).
test("T11e review A-5(b)/R-1: the open chooser consumes Escape before the global editor.cancel; other keys pass", () => {
  const registry = createShortcutCommandRegistry(
    getShortcutCommandDefinitions(),
  );
  const resolver = createShortcutResolver(
    registry,
    createEffectiveKeymap(registry),
  );
  const makeEvent = (key: string) => {
    const event = {
      key,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
    };
    return event;
  };
  const resolve = (event: ReturnType<typeof makeEvent>) => {
    const executed: string[] = [];
    resolver.handleKeyDown(event, {
      activeScopes: ["global", "sketch"],
      executeCommand: (command) => executed.push(command.id),
      isCommandEnabled: () => true,
    });
    return executed;
  };
  const press = (key: string, chooserOpen: boolean) => {
    const event = makeEvent(key);
    let closed = 0;
    if (chooserOpen) handleSketchPickChooserKeyDown(event, () => (closed += 1));
    return {
      closed,
      stopped: event.propagationStopped,
      executed: event.propagationStopped ? [] : resolve(event),
    };
  };

  expect(
    press("Escape", false).executed,
    "Control: without the chooser Escape runs editor.cancel.",
  ).toEqual(["editor.cancel"]);
  expect(
    press("Escape", true),
    "With the chooser open, Escape only closes it and stops there.",
  ).toEqual({ closed: 1, stopped: true, executed: [] });
  const prevented = makeEvent("Escape");
  handleSketchPickChooserKeyDown(prevented, () => undefined);
  expect(
    resolve(prevented),
    "Even if it reached the shortcut layer, the prevented Escape runs nothing.",
  ).toEqual([]);
  expect(
    press("ArrowDown", true),
    "Arrow keys are the menu's: no close, not stopped.",
  ).toMatchObject({ closed: 0, stopped: false });
});
