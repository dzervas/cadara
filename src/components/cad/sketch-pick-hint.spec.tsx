import { expect, test, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import { findNearGapEndpoints } from "@/domain/sketch-interaction/near-gap";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";
import {
  createLineEntityDefinition,
  createPointDefinition,
} from "@/domain/editor/sketch-session/definition-authoring";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  createDwellHint,
  SKETCH_HINT_DWELL_MS,
  SKETCH_HINT_LINGER_MS,
} from "@/hooks/dwell-hint";
import { SketchPickHint } from "@/components/cad/sketch-pick-hint";
import {
  createSketchNearGapHint,
  getSketchNearGapHintPointIds,
  createSketchPickHint,
  getSketchNearGapHintText,
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

// T13k (D26). Seam: the near-gap hint's model (which end it is about, its
// partner's label by role, and whether Merge Points would refuse the pair)
// over real near gaps, and its chip with or without the Merge… button.
function nearGapFixture(bridge = false) {
  const f = makeSketchFixture();
  f.point("a", 0, 0);
  f.point("b", 4, 0);
  f.point("c", 4.03, 0);
  f.point("d", 4.03, 3);
  f.point("g", 4.08, -3);
  f.point("e", 4.08, 0);
  f.line("L1", "a", "b");
  f.line("L2", "c", "d");
  f.line("L3", "g", "e");
  // Review A3: a construction bridge b–c, so merging them would collapse it.
  if (bridge) f.line("tiny", "b", "c", true);
  const definition = f.definition();
  const gaps = findNearGapEndpoints(
    definition,
    f.build().solvedSnapshot,
    new Map(definition.points.map((point) => [point.pointId, point.position])),
    ([x, y]) => ({ x: x * 100, y: -y * 100 }),
  );
  return { definition, gaps };
}
const fp = (name: string) => `sketch_point_${name}` as SketchPointId;

test("T13k: the near-gap hint names the partner by its role; hovered end first, then the latest selected", () => {
  const { definition, gaps } = nearGapFixture();
  // b~c 3 px, c~e 5 px, b~e 8 px.
  expect(gaps).toHaveLength(3);
  const hint = createSketchNearGapHint({
    gaps,
    pointIds: [fp("a"), fp("e"), fp("b")],
    definition,
  });
  expect(
    hint,
    "the first listed end of a near gap (e), with its nearest partner (c, the start of L2)",
  ).toEqual({
    sourcePointId: fp("e"),
    destinationPointId: fp("c"),
    partnerLabel: "L2 start",
    mergeRefusal: null,
  });
  expect(getSketchNearGapHintText(hint!)).toBe(
    "Near gap to L2 start \u2014 not joined",
  );
  expect(
    createSketchNearGapHint({ gaps, pointIds: [fp("c")], definition }),
    "review Q3: b is the end of L1",
  ).toEqual({
    sourcePointId: fp("c"),
    destinationPointId: fp("b"),
    partnerLabel: "L1 end",
    mergeRefusal: null,
  });
  expect(
    createSketchNearGapHint({ gaps, pointIds: [fp("a")], definition }),
    "an end without a near gap shows none",
  ).toBeNull();
});

test("T13k review A3: a pair Merge Points would refuse keeps its hint but is not offered Merge…", () => {
  const { definition, gaps } = nearGapFixture(true);
  const hint = createSketchNearGapHint({
    gaps,
    pointIds: [fp("c")],
    definition,
  });
  expect(hint).toEqual({
    sourcePointId: fp("c"),
    destinationPointId: fp("b"),
    partnerLabel: "L1 end",
    mergeRefusal:
      "Both points are ends of tiny; merging them would collapse it.",
  });
  const markup = render(
    <SketchPickHint hint={null} nearGap={hint} onMerge={() => undefined} />,
  );
  expect(markup).toContain("Near gap to L1 end \u2014 not joined");
  expect(markup).not.toContain("<button");
  expect(markup).not.toContain("Merge…");
});

test("T13k: the near-gap chip renders its text and a Merge… button, beside or without the overlap hint", () => {
  const nearGap = {
    sourcePointId: "p_c" as SketchPointId,
    destinationPointId: "p_a" as SketchPointId,
    partnerLabel: "Line 4 end",
    mergeRefusal: null,
  };
  const alone = render(
    <SketchPickHint hint={null} nearGap={nearGap} onMerge={() => undefined} />,
  );
  expect(alone).toContain('data-testid="sketch-near-gap-hint"');
  expect(alone).toContain("Near gap to Line 4 end \u2014 not joined");
  expect(alone).toMatch(/<button[^>]*>.*Merge….*<\/button>/);
  expect(alone, "the chip takes the pointer for its button").toMatch(
    /class="pointer-events-auto [^"]*" role="status" data-testid="sketch-near-gap-hint"/,
  );
  expect(alone).not.toContain('data-testid="sketch-pick-hint"');
  const both = render(
    <SketchPickHint
      hint={{ label: "Line 2", more: 1, cycles: true }}
      nearGap={nearGap}
    />,
  );
  expect(both.indexOf('data-testid="sketch-pick-hint"')).toBeGreaterThan(-1);
  expect(both.indexOf('data-testid="sketch-near-gap-hint"')).toBeGreaterThan(
    both.indexOf('data-testid="sketch-pick-hint"'),
  );
  expect(render(<SketchPickHint hint={null} nearGap={null} />)).not.toContain(
    'role="status"',
  );
});

test("D26: a selected gap end keeps Merge over empty space; deselecting starts linger", () => {
  vi.useFakeTimers();
  const { definition, gaps } = nearGapFixture();
  const endpoint = definition.points.find(
    (point) => point.pointId === fp("c"),
  )!.target;
  let visible: ReturnType<typeof createSketchNearGapHint> = null;
  const timing = createDwellHint<
    NonNullable<ReturnType<typeof createSketchNearGapHint>>
  >((value) => {
    visible = value;
  });
  const update = (
    hover: PrimitiveRef | null,
    selection: readonly PrimitiveRef[],
  ) => {
    const hint = createSketchNearGapHint({
      definition,
      gaps,
      pointIds: getSketchNearGapHintPointIds(
        hover,
        selection,
        endpoint.sketchId,
      ),
    });
    if (hint)
      timing.hover(`${hint.sourcePointId}|${hint.destinationPointId}`, hint);
    else timing.leave();
  };
  try {
    update(endpoint, [endpoint]);
    vi.advanceTimersByTime(SKETCH_HINT_DWELL_MS);
    expect(visible).toMatchObject({ sourcePointId: fp("c") });
    update(null, [endpoint]);
    vi.advanceTimersByTime(SKETCH_HINT_LINGER_MS + 1);
    expect(
      visible,
      "selection is deliberate, not a departed hover",
    ).toMatchObject({ sourcePointId: fp("c") });
    update(null, []);
    vi.advanceTimersByTime(SKETCH_HINT_LINGER_MS - 1);
    expect(visible).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(visible).toBeNull();
  } finally {
    timing.dispose();
    vi.useRealTimers();
  }
});
