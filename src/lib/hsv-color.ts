/** Hue in degrees [0, 360), saturation and value in [0, 1]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [channel(5), channel(3), channel(1)];
}

/** Lowercase `#rrggbb`. */
export function hsvToHex(hsv: Hsv) {
  return `#${hsvToRgb(hsv)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function hexToHsv(hex: string): Hsv {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const h =
    delta === 0
      ? 0
      : max === r
        ? 60 * (((g - b) / delta + 6) % 6)
        : max === g
          ? 60 * ((b - r) / delta + 2)
          : 60 * ((r - g) / delta + 4);
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/**
 * Lowercase `#rrggbb` from user input: 3 or 6 hex digits with an optional
 * leading `#`, case-insensitive. Null when the input is not a colour.
 */
export function normalizeHexInput(value: string) {
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.replace(/./g, (digit) => digit + digit)}`.toLowerCase();
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw}`.toLowerCase() : null;
}
