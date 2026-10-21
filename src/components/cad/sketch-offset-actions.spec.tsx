/**
 * T17c ([TECH] T17-5): the Offset panel. UI lane; seam: the component's
 * rendered markup and its click wiring (no DOM test library in the repo:
 * the Remove button's `onClick` is read from the rendered element tree and
 * invoked), and its place in the selection-context column (the T16a
 * Mirror panel pattern).
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { SketchOffsetActionEntry } from "@/domain/editor/sketch-session";
import { SketchMirrorActions } from "./sketch-mirror-actions";
import { SketchOffsetActions } from "./sketch-offset-actions";
import { SketchSelectionContextStack } from "./sketch-selection-context";

const sized: SketchOffsetActionEntry = {
  derivationId: "derivation_sized",
  label: "offset 3",
  health: { kind: "healthy" },
  outputCount: 3,
  requirementCount: 4,
  sizingRequirementCount: 2,
  brokenDownstreamLabels: [],
};
const chained: SketchOffsetActionEntry = {
  derivationId: "derivation_chained",
  label: "offset 7",
  health: { kind: "checking" },
  outputCount: 1,
  requirementCount: 1,
  sizingRequirementCount: 0,
  brokenDownstreamLabels: ["offset 8", "mirror 9"],
};
const render = (node: ReactNode) =>
  renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);
const text = (markup: string) => markup.replace(/<[^>]*>/g, "|");

test("T17c: each offset row shows its label, Remove offset and the consequence line", () => {
  const markup = render(
    <SketchOffsetActions entries={[sized, chained]} onRemove={() => {}} onEditDistance={() => {}} />,
  );
  const visible = text(markup);
  for (const expected of [
    "|Offset|",
    "|offset 3|",
    "|Removes 3 offset curves, 4 requirements on the offset curves, 2 of which currently size the originals.|",
    "|offset 7|",
    "|Removes 1 offset curve, 1 requirement on the offset curves. Leaves ‘offset 8’, ‘mirror 9’ broken.|",
  ])
    expect(visible, expected).toContain(expected);
  expect(
    visible,
    "no sizing clause when nothing sizes the originals",
  ).not.toContain("0 of which");
  expect(markup.match(/data-testid="offset-remove"/g)).toHaveLength(2);
  expect(visible.match(/\|Remove offset\|/g)).toHaveLength(2);
  expect(
    visible.indexOf("|offset 3|"),
    "rows keep the state's order",
  ).toBeLessThan(visible.indexOf("|offset 7|"));
  expect(visible, "labels, never ids").not.toContain("derivation_");
});

test("T17c: the consequence line: no requirements, singular sizing", () => {
  const visible = text(
    render(
      <SketchOffsetActions
        entries={[
          {
            ...sized,
            derivationId: "a",
            requirementCount: 0,
            sizingRequirementCount: 0,
          },
          { ...sized, derivationId: "b", sizingRequirementCount: 1 },
        ]}
        onRemove={() => {}}
        onEditDistance={() => {}}
      />,
    ),
  );
  expect(visible).toContain("|Removes 3 offset curves.|");
  expect(visible).toContain(
    "|Removes 3 offset curves, 4 requirements on the offset curves, 1 of which currently sizes the originals.|",
  );
});

test("T17c review R-1: the health line: Healthy, Checking…, or Broken with its label-based reason and recovery in the danger colour; an offset with no output left reads as removing the broken offset", () => {
  const markup = render(
    <SketchOffsetActions
      entries={[
        sized,
        chained,
        {
          ...sized,
          derivationId: "derivation_broken",
          label: "offset 9",
          health: {
            kind: "broken",
            reason: "the offset curve of ‘free’ was deleted",
          },
          outputCount: 0,
          requirementCount: 0,
          sizingRequirementCount: 0,
        },
      ]}
      onRemove={() => {}}
      onEditDistance={() => {}}
    />,
  );
  const visible = text(markup);
  expect(visible).toContain("|offset 3||Healthy|");
  expect(visible).toContain("|offset 7||Checking…|");
  expect(markup).toContain(
    '<p class="text-[var(--workbench-shell-danger-text)]">Broken: the offset curve of ‘free’ was deleted. Undo, or remove the offset.</p>',
  );
  expect(visible).toContain("|Removes the broken offset.|");
  expect(visible.match(/Healthy|Checking…|Broken:/g)).toEqual([
    "Healthy",
    "Checking…",
    "Broken:",
  ]);
});

/** Every element of a rendered tree (function components not rendered). */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

test("T17c: Remove offset calls onRemove with that row's offset id", () => {
  const removed: string[] = [];
  const tree = SketchOffsetActions({
    entries: [sized, chained],
    onRemove: (derivationId) => removed.push(derivationId),
    onEditDistance: () => {},
  });
  const buttons = elements(tree).filter(
    (element) =>
      (element.props as Record<string, unknown>)["data-testid"] ===
      "offset-remove",
  );
  expect(buttons).toHaveLength(2);
  (buttons[1]!.props as { onClick: () => void }).onClick();
  (buttons[0]!.props as { onClick: () => void }).onClick();
  expect(removed).toEqual(["derivation_chained", "derivation_sized"]);
});

test("T17c: the Offset panel flows in the selection-context column after Mirror; it is not positioned on its own", () => {
  const markup = render(
    <SketchSelectionContextStack>
      <SketchMirrorActions
        entries={[
          {
            derivationId: "derivation_mirror",
            label: "mirror 3",
            brokenReason: null,
            copyCount: 1,
            requirementCount: 0,
            sizingRequirementCount: 0,
            brokenDownstreamLabels: [],
            replaceOriginalOutputId: null,
          },
        ]}
        onRemove={() => {}}
        onReplace={() => {}}
      />
      <SketchOffsetActions entries={[sized]} onRemove={() => {}} onEditDistance={() => {}} />
    </SketchSelectionContextStack>,
  );
  const positioned = (markup.match(/<[a-z]+ [^>]*>/g) ?? []).filter((tag) =>
    /class="[^"]*\b(absolute|fixed)\b/.test(tag),
  );
  expect(positioned, "exactly one positioned element").toHaveLength(1);
  expect(positioned[0]).toContain(
    'data-testid="sketch-selection-context-stack"',
  );
  expect(markup.indexOf('data-testid="sketch-offset-actions"')).toBeGreaterThan(
    markup.indexOf('data-testid="sketch-mirror-actions"'),
  );
});

test("Edit distance invokes the row's relationship edit action", () => {
  const edited: string[] = [];
  const tree = SketchOffsetActions({
    entries: [sized, chained],
    onRemove: () => {},
    onEditDistance: id => edited.push(id),
  });
  const buttons = elements(tree).filter(element =>
    (element.props as Record<string, unknown>)["data-testid"] === "offset-edit-distance",
  );
  expect(buttons).toHaveLength(2);
  (buttons[1]!.props as { onClick: () => void }).onClick();
  expect(edited).toEqual([chained.derivationId]);
  expect(text(render(tree))).toContain("Edit distance");
});
