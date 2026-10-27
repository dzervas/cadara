export type PointingDeviceScheme = "mouse" | "touchpad";

export interface WheelCameraInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  scheme: PointingDeviceScheme;
}

export interface WheelCameraIntent {
  kind: "pan" | "orbit" | "zoom" | "none";
  dx: number;
  dy: number;
  scale: number;
}

export function wheelCameraIntent(input: WheelCameraInput): WheelCameraIntent {
  // Mouse wheels are deliberately left to OrbitControls, byte-for-byte.
  if (input.scheme === "mouse") return { kind: "none", dx: 0, dy: 0, scale: 1 };
  // WheelEvent does not supply a line/page size; use consistent CSS-pixel units.
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 800 : 1;
  const dx = input.deltaX * unit;
  const dy = input.deltaY * unit;
  if (dx === 0 && dy === 0) return { kind: "none", dx, dy, scale: 1 };
  if (input.ctrlKey) {
    return {
      kind: "zoom",
      dx,
      dy,
      scale: Math.exp(Math.max(-1, Math.min(1, dy * 0.01))),
    };
  }
  return { kind: input.shiftKey ? "orbit" : "pan", dx, dy, scale: 1 };
}
