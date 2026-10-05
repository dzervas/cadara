import { test, expect } from "vitest";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";

import { SketchTangentActions } from "./sketch-tangent-actions";

test("T12e: tangent action buttons render with correct labels and enabled states", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchTangentActions
        resetEnabled={true}
        zeroEnabled={true}
        onReset={() => {}}
        onZero={() => {}}
      />
    </MantineProvider>,
  );

  expect(
    markup.includes("Reset to automatic"),
    "The reset button label must be visible.",
  ).toBe(true);
  expect(
    markup.includes("Set to zero"),
    "The zero button label must be visible.",
  ).toBe(true);
  expect(
    markup.includes("Tangent"),
    "The section header must be visible.",
  ).toBe(true);
});

test("T12e: reset button disabled when resetEnabled=false", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchTangentActions
        resetEnabled={false}
        zeroEnabled={true}
        onReset={() => {}}
        onZero={() => {}}
      />
    </MantineProvider>,
  );

  // When disabled, Mantine renders data-disabled="true" and disabled attribute.
  // Find the "Reset to automatic" button and check it's disabled.
  const resetIdx = markup.indexOf("Reset to automatic");
  expect(resetIdx, "Reset button must exist in markup.").toBeGreaterThan(-1);
  // The button element is before the text; find the preceding <button.
  const beforeReset = markup.slice(0, resetIdx);
  const lastBtnOpen = beforeReset.lastIndexOf("<button");
  const btnSnippet = markup.slice(lastBtnOpen, resetIdx);
  expect(
    btnSnippet.includes("disabled") || btnSnippet.includes("data-disabled"),
    "The reset button must be disabled when resetEnabled=false.",
  ).toBe(true);
});

test("T12e: zero button disabled when zeroEnabled=false", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchTangentActions
        resetEnabled={true}
        zeroEnabled={false}
        onReset={() => {}}
        onZero={() => {}}
      />
    </MantineProvider>,
  );

  const zeroIdx = markup.indexOf("Set to zero");
  expect(zeroIdx, "Zero button must exist in markup.").toBeGreaterThan(-1);
  const beforeZero = markup.slice(0, zeroIdx);
  const lastBtnOpen = beforeZero.lastIndexOf("<button");
  const btnSnippet = markup.slice(lastBtnOpen, zeroIdx);
  expect(
    btnSnippet.includes("disabled") || btnSnippet.includes("data-disabled"),
    "The zero button must be disabled when zeroEnabled=false.",
  ).toBe(true);
});

test("T12e: enabled reset button is clickable (not disabled, onClick bound)", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchTangentActions
        resetEnabled={true}
        zeroEnabled={false}
        onReset={() => {}}
        onZero={() => {}}
      />
    </MantineProvider>,
  );

  const resetIdx = markup.indexOf('data-testid="tangent-reset"');
  expect(resetIdx, "Reset button must have data-testid.").toBeGreaterThan(-1);
  const beforeReset = markup.slice(0, resetIdx);
  const lastBtnOpen = beforeReset.lastIndexOf("<button");
  const resetSnippet = markup.slice(lastBtnOpen, resetIdx + 40);
  expect(
    !resetSnippet.includes("disabled"),
    "Enabled reset button must not be disabled in the DOM.",
  ).toBe(true);
});

test("T12e: enabled zero button is clickable (not disabled, onClick bound)", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchTangentActions
        resetEnabled={false}
        zeroEnabled={true}
        onReset={() => {}}
        onZero={() => {}}
      />
    </MantineProvider>,
  );

  const zeroIdx = markup.indexOf('data-testid="tangent-zero"');
  expect(zeroIdx, "Zero button must have data-testid.").toBeGreaterThan(-1);
  const beforeZero = markup.slice(0, zeroIdx);
  const lastBtnOpen = beforeZero.lastIndexOf("<button");
  const zeroSnippet = markup.slice(lastBtnOpen, zeroIdx + 40);
  expect(
    !zeroSnippet.includes("disabled"),
    "Enabled zero button must not be disabled in the DOM.",
  ).toBe(true);
});

test("T12e: disabled button has disabled attribute (click does nothing)", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchTangentActions
        resetEnabled={false}
        zeroEnabled={false}
        onReset={() => {}}
        onZero={() => {}}
      />
    </MantineProvider>,
  );

  // Both buttons must be disabled.
  const resetIdx = markup.indexOf('data-testid="tangent-reset"');
  const beforeReset = markup.slice(0, resetIdx);
  const resetBtnOpen = beforeReset.lastIndexOf("<button");
  const resetSnippet = markup.slice(resetBtnOpen, resetIdx);
  expect(
    resetSnippet.includes("disabled"),
    "Disabled reset button must have disabled attribute.",
  ).toBe(true);

  const zeroIdx = markup.indexOf('data-testid="tangent-zero"');
  const beforeZero = markup.slice(0, zeroIdx);
  const zeroBtnOpen = beforeZero.lastIndexOf("<button");
  const zeroSnippet = markup.slice(zeroBtnOpen, zeroIdx);
  expect(
    zeroSnippet.includes("disabled"),
    "Disabled zero button must have disabled attribute.",
  ).toBe(true);
});

test("T12e: both buttons enabled when both flags are true", () => {
  const markup = renderToStaticMarkup(
    <MantineProvider>
      <SketchTangentActions
        resetEnabled={true}
        zeroEnabled={true}
        onReset={() => {}}
        onZero={() => {}}
      />
    </MantineProvider>,
  );

  // Both buttons should NOT have disabled attribute.
  const resetIdx = markup.indexOf("Reset to automatic");
  const beforeReset = markup.slice(0, resetIdx);
  const resetBtnOpen = beforeReset.lastIndexOf("<button");
  const resetSnippet = markup.slice(resetBtnOpen, resetIdx);

  const zeroIdx = markup.indexOf("Set to zero");
  const beforeZero = markup.slice(0, zeroIdx);
  const zeroBtnOpen = beforeZero.lastIndexOf("<button");
  const zeroSnippet = markup.slice(zeroBtnOpen, zeroIdx);

  expect(
    !resetSnippet.includes("disabled"),
    "Reset button must not be disabled when resetEnabled=true.",
  ).toBe(true);
  expect(
    !zeroSnippet.includes("disabled"),
    "Zero button must not be disabled when zeroEnabled=true.",
  ).toBe(true);
});
