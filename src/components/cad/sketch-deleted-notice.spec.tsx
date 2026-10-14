/**
 * T17-20 (T17k2): the deleted-sketch notice. UI lane; seam: the component's
 * rendered markup and its click wiring (no DOM test library in the repo:
 * a button's `onClick` is read from the rendered element tree and invoked,
 * as `sketch-offset-actions.spec.tsx` does). The notice names the sketch by
 * label; leaving needs an explicit confirmation; only the confirmation
 * discards.
 */
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import {
  SketchDeletedNoticeView,
  type SketchDeletedNoticeViewProps,
} from "./sketch-deleted-notice";

const MESSAGE =
  "‘Sketch Draft’ was deleted by another session; your changes can't be published.";
const render = (node: ReactNode) =>
  renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);
const text = (markup: string) =>
  markup.replace(/<[^>]*>/g, "|").replace(/&#x27;/g, "'");

/** Every element of a rendered tree (function components not rendered). */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

function view(confirming: boolean) {
  const calls: string[] = [];
  const props: SketchDeletedNoticeViewProps = {
    message: MESSAGE,
    confirming,
    onAsk: () => calls.push("ask"),
    onKeepEditing: () => calls.push("keep"),
    onDiscard: () => calls.push("discard"),
  };
  const button = (label: string) => {
    const found = elements(SketchDeletedNoticeView(props)).filter(
      (element) =>
        (element.props as { children?: ReactNode }).children === label,
    );
    expect(found, label).toHaveLength(1);
    (found[0]!.props as { onClick: () => void }).onClick();
  };
  return {
    markup: render(<SketchDeletedNoticeView {...props} />),
    calls,
    button,
  };
}

test("the notice names the sketch by label as an alert and offers to discard and leave, asking first", () => {
  const { markup, calls, button } = view(false);
  expect(markup).toContain(`role="alert"`);
  const visible = text(markup);
  expect(visible).toContain(`|${MESSAGE}|`);
  expect(visible).toContain("|Discard changes and leave…|");
  expect(visible, "nothing is discarded before the confirmation").not.toContain(
    "|Discard changes and leave|",
  );
  expectNoInternalIds([MESSAGE]);
  button("Discard changes and leave…");
  expect(calls, "the first press only asks").toEqual(["ask"]);
});

test("the confirmation discards; Keep editing does not", () => {
  const { markup, calls, button } = view(true);
  const visible = text(markup);
  expect(visible).toContain("|Your changes in this sketch will be lost.|");
  expect(visible).toContain("|Discard changes and leave|");
  expect(visible).toContain("|Keep editing|");
  button("Keep editing");
  expect(calls).toEqual(["keep"]);
  button("Discard changes and leave");
  expect(calls).toEqual(["keep", "discard"]);
});
