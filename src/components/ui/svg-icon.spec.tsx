/**
 * UI lane (docs/testing.md: `src/components`, render-local behaviour). Seam:
 * `SvgIcon`'s rendered element. React re-assigns `innerHTML` whenever the
 * `dangerouslySetInnerHTML` object changes identity, so an icon whose parent
 * re-renders (the whole workbench on every sketch drag move) must hand React
 * the same markup object each time, or every icon's SVG is re-parsed and its
 * DOM replaced on every update.
 */
import type { ReactElement } from "react";
import { expect, test } from "vitest";

import { SvgIcon } from "@/components/ui/svg-icon";

type IconElement = ReactElement<{
  dangerouslySetInnerHTML: { __html: string };
}>;

test("an icon re-render hands React the same inner-HTML object", () => {
  const first = SvgIcon({ fileName: "bezierCurve.svg" }) as IconElement;
  const second = SvgIcon({
    fileName: "bezierCurve.svg",
    size: 16,
  }) as IconElement;

  expect(first.props.dangerouslySetInnerHTML.__html).toContain("<svg");
  expect(
    second.props.dangerouslySetInnerHTML,
    "the markup object is shared, so React leaves the icon's DOM alone",
  ).toBe(first.props.dangerouslySetInnerHTML);
});

test("an unknown icon file still throws", () => {
  expect(() => SvgIcon({ fileName: "no-such-icon.svg" })).toThrow(
    "Unknown icon asset: no-such-icon.svg",
  );
});
