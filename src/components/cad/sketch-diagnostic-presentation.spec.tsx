import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SketchValidationStatus } from "./sketch-selection-context";
import { SketchSpecialModePanel } from "./sketch-special-mode-panel";

test("session diagnostics use the generic error presentation with selectable text and Undo", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchValidationStatus
        message="Cannot form a region."
        onUndo={() => {}}
      />
    </MantineProvider>,
  );
  expect(markup).toContain('data-notification-type="error"');
  expect(markup).toContain("user-select:text");
  expect(markup).toContain(">Undo<");
});

test("the existing action panel can flow inline without claiming a special-mode heading", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchSpecialModePanel
        inline
        schema={{ title: "Spline selection", sections: [] }}
        onAction={() => {}}
      />
    </MantineProvider>,
  );
  expect(markup).not.toMatch(/class="[^"]*\babsolute\b/);
  expect(markup).not.toContain(">Special mode<");
});

test("diagnostic hover and Undo callbacks are wired to the message and existing action", () => {
  const calls: string[] = [];
  const tree = SketchValidationStatus({
    message: "Cannot form a region.",
    onHover: () => calls.push("hover"),
    onClearHover: () => calls.push("clear"),
    onUndo: (...args: unknown[]) =>
      calls.push(args.length === 0 ? "undo" : "unexpected history sequence"),
  })!;
  tree.props.onPointerEnter();
  tree.props.onPointerLeave();
  // Mantine passes the click event, but history Undo accepts an optional sequence.
  tree.props.children.props.action.onClick({ type: "click" });
  expect(calls).toEqual(["hover", "clear", "undo"]);
});
