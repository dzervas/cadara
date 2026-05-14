import { test, expect } from "vitest";

import { getMeasurementWitnessStyleConfig } from "@/components/cad/measurement-witness-style";

test("src/components/cad/measurement-witness-style.spec.ts", () => {
  const style = getMeasurementWitnessStyleConfig();

  expect(
    style.core.color,
    "Measurement witness core lines should use the bright yellow accent.",
  ).toBe(0xffde59);
  expect(
    style.halo.lineWidth > style.core.lineWidth,
    "Measurement witness halo should render wider than the core line.",
  ).toBeTruthy();
  expect(
    style.halo.opacity < style.core.opacity,
    "Measurement witness halo should stay softer than the core line.",
  ).toBeTruthy();
  expect(
    style.marker.scale > 1,
    "Measurement witness markers should be emphasized over default point markers.",
  ).toBeTruthy();
});
