import { expect, test } from "vitest";
import { placeSketchFloatingInput } from "./sketch-viewport-feedback-model";

// Lane: UI. Screen-space chip placement uses the same obstacle contract as
// sketch annotations; no scene geometry or solver assumptions belong here.
test.each([
  {
    name: "interior",
    anchor: { x: 928, y: 442 },
    previewX: 760,
    previewY: 280,
  },
  {
    name: "top edge",
    anchor: { x: 928, y: 180 },
    previewX: 760,
    previewY: 100,
  },
  {
    name: "right edge",
    anchor: { x: 1400, y: 442 },
    previewX: 1100,
    previewY: 280,
  },
  {
    name: "chrome-covered origin",
    anchor: { x: 1100, y: 442 },
    previewX: 760,
    previewY: 280,
  },
])(
  "a floating editor at $name clears preview geometry and chrome",
  ({ anchor, previewX, previewY }) => {
    const preview = { x: previewX, y: previewY, width: 340, height: 300 };
    const viewport = {
      width: 1440,
      height: 900,
      topInset: 126,
      bottomInset: 112,
    };
    // DOMRect measurements expose dimensions through prototype getters.
    const extent = Object.create({ width: 220, height: 190 }) as {
      width: number;
      height: number;
    };
    const chrome = { x: 1144, y: 240, width: 280, height: 130, chrome: true };
    const position = placeSketchFloatingInput(anchor, extent, viewport, [
      preview,
      chrome,
    ]);
    for (const obstacle of [preview, chrome]) {
      expect(
        position.x + extent.width <= obstacle.x ||
          position.x >= obstacle.x + obstacle.width ||
          position.y + extent.height <= obstacle.y ||
          position.y >= obstacle.y + obstacle.height,
      ).toBe(true);
    }
    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.x + extent.width).toBeLessThanOrEqual(viewport.width);
    expect(position.y).toBeGreaterThanOrEqual(viewport.topInset);
    expect(position.y + extent.height).toBeLessThanOrEqual(
      viewport.height - viewport.bottomInset,
    );
  },
);
