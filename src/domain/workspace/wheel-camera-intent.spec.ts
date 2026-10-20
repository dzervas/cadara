import { expect, test } from "vitest";
import {
  wheelCameraIntent,
  type WheelCameraInput,
} from "./wheel-camera-intent";

const scroll: WheelCameraInput = {
  scheme: "touchpad",
  deltaX: 12,
  deltaY: 20,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

test.each([
  [{}, "pan", 12, 20],
  [{ deltaMode: 1 }, "pan", 192, 320],
  [{ deltaMode: 2 }, "pan", 9600, 16000],
  [{ deltaY: 0 }, "pan", 12, 0],
  [{ deltaX: -12, deltaY: -20 }, "pan", -12, -20],
  [{ shiftKey: true }, "orbit", 12, 20],
  [{ metaKey: true }, "pan", 12, 20],
  [{ ctrlKey: true }, "zoom", 12, 20],
  [{ ctrlKey: true, shiftKey: true }, "zoom", 12, 20],
  [{ deltaX: 0, deltaY: 0 }, "none", 0, 0],
  [{ scheme: "mouse" }, "none", 0, 0],
  [
    { scheme: "mouse", ctrlKey: true, shiftKey: true, deltaMode: 2 },
    "none",
    0,
    0,
  ],
] as const)("wheel policy %j → %s", (patch, kind, dx, dy) => {
  expect(wheelCameraIntent({ ...scroll, ...patch })).toMatchObject({
    kind,
    dx,
    dy,
  });
});

test("pinch is proportional, direction-preserving and bounded", () => {
  const pinch = (deltaY: number) =>
    wheelCameraIntent({ ...scroll, ctrlKey: true, deltaY }).scale;
  expect(pinch(10)).toBeCloseTo(Math.exp(0.1));
  expect(pinch(-10) * pinch(10)).toBeCloseTo(1);
  expect(pinch(10000)).toBe(Math.E);
  expect(pinch(-10000)).toBe(Math.exp(-1));
});
