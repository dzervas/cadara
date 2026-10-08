import { describe, expect, test } from "vitest";

import {
  nextSuppressionHeld,
  type SuppressionHeldEvent,
} from "@/components/cad/use-sketch-inference-suppression";

// Lane: UI (docs/testing.md). Seam: the pure held-state step behind the
// viewport's passive key/pointer/blur listeners (T13-D22): Shift down
// holds, Shift up releases, repeats and other keys change nothing, a
// pointer event's `shiftKey` is the truth, blur and a hidden page release.
describe("nextSuppressionHeld (T13-D22)", () => {
  const rows: readonly [string, boolean, SuppressionHeldEvent, boolean][] = [
    [
      "Shift down holds",
      false,
      { kind: "keydown", key: "Shift", repeat: false, inTextField: false },
      true,
    ],
    [
      "a Shift down typed into a text field does not hold",
      false,
      { kind: "keydown", key: "Shift", repeat: false, inTextField: true },
      false,
    ],
    ["Shift up releases", true, { kind: "keyup", key: "Shift" }, false],
    [
      "a Shift auto-repeat changes nothing (released)",
      false,
      { kind: "keydown", key: "Shift", repeat: true, inTextField: false },
      false,
    ],
    [
      "a Shift auto-repeat changes nothing (held)",
      true,
      { kind: "keydown", key: "Shift", repeat: true, inTextField: false },
      true,
    ],
    [
      "another key down changes nothing",
      true,
      { kind: "keydown", key: "a", repeat: false, inTextField: false },
      true,
    ],
    [
      "another key down does not hold",
      false,
      { kind: "keydown", key: "Enter", repeat: false, inTextField: false },
      false,
    ],
    [
      "another key up changes nothing",
      true,
      { kind: "keyup", key: "Alt" },
      true,
    ],
    [
      "a pointer event with shiftKey holds",
      false,
      { kind: "pointer", shiftKey: true },
      true,
    ],
    [
      "a pointer event without shiftKey releases",
      true,
      { kind: "pointer", shiftKey: false },
      false,
    ],
    ["a window blur releases", true, { kind: "blur" }, false],
    [
      "a hidden page releases",
      true,
      { kind: "visibility", hidden: true },
      false,
    ],
    [
      "a visible page changes nothing",
      true,
      { kind: "visibility", hidden: false },
      true,
    ],
  ];

  test.each(rows)("%s", (_name, previous, event, expected) => {
    expect(nextSuppressionHeld(previous, event)).toBe(expected);
  });
});
