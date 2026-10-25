import { expect, test } from "vitest";

import {
  getSelectionClickRequestMode,
  getSelectionMarqueeMode,
  parseSelectionClickMode,
} from "./selection-click-mode";

// Logic lane (core seam): the selection click setting (cadara-h026.1).

const plain = { shiftKey: false, ctrlKey: false, metaKey: false };

test("additive (default): every click toggles; Shift-to-add: only a modified click does", () => {
  expect(parseSelectionClickMode(null)).toBe("additive");
  expect(parseSelectionClickMode("bogus")).toBe("additive");
  expect(getSelectionClickRequestMode("additive", plain)).toBe("toggle");
  expect(
    getSelectionClickRequestMode("additive", { ...plain, shiftKey: true }),
  ).toBe("toggle");
  expect(getSelectionClickRequestMode("shiftToAdd", plain)).toBe("replace");
  for (const key of ["shiftKey", "ctrlKey", "metaKey"] as const) {
    expect(
      getSelectionClickRequestMode("shiftToAdd", { ...plain, [key]: true }),
      key,
    ).toBe("toggle");
  }
  expect(getSelectionMarqueeMode("additive", plain)).toBe("add");
  expect(getSelectionMarqueeMode("shiftToAdd", plain)).toBe("replace");
  expect(
    getSelectionMarqueeMode("shiftToAdd", { ...plain, shiftKey: true }),
  ).toBe("add");
});
