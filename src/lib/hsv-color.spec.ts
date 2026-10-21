import { expect, test } from "vitest";

import { hexToHsv, hsvToHex, normalizeHexInput } from "@/lib/hsv-color";

test("hex input accepts 3 or 6 digits with an optional # in any case and rejects anything else", () => {
  expect(normalizeHexInput("2F6F8F")).toBe("#2f6f8f");
  expect(normalizeHexInput("#2f6f8f")).toBe("#2f6f8f");
  expect(normalizeHexInput(" F0a ")).toBe("#ff00aa");
  for (const invalid of ["", "#", "2F6F8", "2F6F8FF", "GGGGGG", "#12345z"]) {
    expect(normalizeHexInput(invalid), invalid).toBeNull();
  }
});

test("hex survives an HSV round trip, including greys, black and the hue wrap", () => {
  for (const hex of ["#2f6f8f", "#c97ba6", "#ff0000", "#ff00ff", "#808080", "#000000", "#ffffff"]) {
    expect(hsvToHex(hexToHsv(hex)), hex).toBe(hex);
  }
  expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
  expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
  expect(hsvToHex({ h: 240, s: 1, v: 0.5 })).toBe("#000080");
});
