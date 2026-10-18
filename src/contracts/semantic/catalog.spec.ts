import { expect, it } from "vitest";
import { contractJsonSchemas } from "./catalog.runtime-schema";

it("publishes readable hole option components and resolvable schema references", () => {
  const schemas = contractJsonSchemas.components.schemas!;
  expect(
    Object.keys(schemas).filter(
      (name) => name.length > 80 || name.startsWith("Omit"),
    ),
  ).toEqual([]);
  expect(schemas.SemanticRevolveSolidParameters).toBeDefined();
  expect(schemas.SimpleBlindHoleOptions).toBeDefined();
  expect(schemas.CounterboreThroughHoleOptions).toBeDefined();
  expect(schemas.CountersinkBlindHoleOptions).toBeDefined();
  function checkReferences(node: unknown) {
    if (Array.isArray(node)) node.forEach(checkReferences);
    else if (node && typeof node === "object") {
      if ("$ref" in node)
        expect(
          schemas[String(node.$ref).replace("#/components/schemas/", "")],
        ).toBeDefined();
      Object.values(node).forEach(checkReferences);
    }
  }
  checkReferences(contractJsonSchemas);
});
