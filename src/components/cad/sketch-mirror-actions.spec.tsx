/**
 * T16a ([TECH] T16-2): the Mirror panel. UI lane; seam: the components' rendered markup and their click
 * wiring (no DOM test library in the repo: the Remove button's `onClick` is
 * read from the rendered element tree and invoked).
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { SketchMirrorActionEntry } from "@/domain/editor/sketch-session";
import { SketchMirrorActions } from "./sketch-mirror-actions";

const healthy: SketchMirrorActionEntry = {
  derivationId: "derivation_healthy",
  label: "mirror 3",
  brokenReason: null,
  copyCount: 4,
  requirementCount: 3,
  sizingRequirementCount: 2,
  brokenDownstreamLabels: [],
};
const broken: SketchMirrorActionEntry = {
  derivationId: "derivation_broken",
  label: "mirror 7",
  brokenReason: "mirror line missing",
  copyCount: 1,
  requirementCount: 1,
  sizingRequirementCount: 0,
  brokenDownstreamLabels: ["offset 8", "mirror 9"],
};
const render = (node: ReactNode) =>
  renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);
const text = (markup: string) => markup.replace(/<[^>]*>/g, "|");

test("T16a: each mirror row shows its label, health, Remove mirror and the consequence line", () => {
  const markup = render(
    <SketchMirrorActions entries={[healthy, broken]} onRemove={() => {}} />,
  );
  const visible = text(markup);
  for (const expected of [
    "|Mirror|",
    "|mirror 3|",
    "|Healthy|",
    "|Removes 4 copies, 3 requirements on the copies, 2 of which currently size the originals.|",
    "|mirror 7|",
    "|Broken: mirror line missing|",
    "|Removes 1 copy, 1 requirement on the copies. Leaves ‘offset 8’, ‘mirror 9’ broken.|",
  ])
    expect(visible, expected).toContain(expected);
  expect(
    visible,
    "no sizing clause when nothing sizes the originals",
  ).not.toContain("0 of which");
  expect(markup.match(/data-testid="mirror-remove"/g)).toHaveLength(2);
  expect(visible.match(/\|Remove mirror\|/g)).toHaveLength(2);
  expect(
    visible.indexOf("|mirror 3|"),
    "rows keep the state's order",
  ).toBeLessThan(visible.indexOf("|mirror 7|"));
});

test("T16a: the consequence line: no requirements, singular sizing", () => {
  const visible = text(
    render(
      <SketchMirrorActions
        entries={[
          {
            ...healthy,
            derivationId: "a",
            requirementCount: 0,
            sizingRequirementCount: 0,
          },
          { ...healthy, derivationId: "b", sizingRequirementCount: 1 },
        ]}
        onRemove={() => {}}
      />,
    ),
  );
  expect(visible).toContain("|Removes 4 copies.|");
  expect(visible).toContain(
    "|Removes 4 copies, 3 requirements on the copies, 1 of which currently sizes the originals.|",
  );
});

/** Every element of a rendered tree (function components not rendered). */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

test("T16a: Remove mirror calls onRemove with that row's mirror id", () => {
  const removed: string[] = [];
  const tree = SketchMirrorActions({
    entries: [healthy, broken],
    onRemove: (derivationId) => removed.push(derivationId),
  });
  const buttons = elements(tree).filter(
    (element) =>
      (element.props as Record<string, unknown>)["data-testid"] ===
      "mirror-remove",
  );
  expect(buttons).toHaveLength(2);
  (buttons[1]!.props as { onClick: () => void }).onClick();
  (buttons[0]!.props as { onClick: () => void }).onClick();
  expect(removed).toEqual(["derivation_broken", "derivation_healthy"]);
});
