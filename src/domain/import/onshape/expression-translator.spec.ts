import { test, expect } from "vitest";

import { translateOnshapeExpression } from "@/domain/import/onshape/expression-translator";

test("src/domain/import/onshape/expression-translator.spec.ts", () => {
  expect(
    translateOnshapeExpression({ expression: "4 mm" }),
    "A unit length literal should normalize to a bare millimeter number.",
  ).toEqual({ valueText: "4", translated: true });

  expect(
    translateOnshapeExpression({ expression: "0.5 in" }),
    "Inch literals should convert to millimeters.",
  ).toEqual({ valueText: "12.7", translated: true });

  expect(
    translateOnshapeExpression({ expression: "30 deg" }),
    "Angle literals should normalize to degrees regardless of a declared quantity.",
  ).toEqual({ valueText: "30", translated: true });

  expect(
    translateOnshapeExpression({ expression: "#nail * 2" }),
    "Variable references should drop the Onshape sigil and keep arithmetic.",
  ).toEqual({ valueText: "nail * 2", translated: true });

  expect(
    translateOnshapeExpression({ expression: "#width" }),
    "A bare variable reference should translate to a cadara identifier.",
  ).toEqual({ valueText: "width", translated: true });

  const unknownUnit = translateOnshapeExpression({ expression: "4 furlong" });
  expect(
    !unknownUnit.translated &&
      unknownUnit.valueText === "4" &&
      unknownUnit.diagnostic?.code === "onshape-expression-untranslatable",
    "An unrecognized unit should recover the literal magnitude (4) from the string, not a captured value, with a diagnostic.",
  ).toBeTruthy();

  const angleFallback = translateOnshapeExpression({ expression: "angle = 30 deg" });
  expect(
    !angleFallback.translated &&
      angleFallback.valueText === "30" &&
      angleFallback.diagnostic?.code === "onshape-expression-untranslatable",
    "An untranslatable angle expression should recover 30 (deg) from the string literal, never trusting a captured evaluated value.",
  ).toBeTruthy();

  const noLiteral = translateOnshapeExpression({ expression: "output = input" });
  expect(
    noLiteral.diagnostic?.code === "onshape-expression-missing-literal" &&
      noLiteral.valueText === "0",
    "A non-value expression with no recoverable numeric literal should substitute 0 with an explicit diagnostic.",
  ).toBeTruthy();
});
