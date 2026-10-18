import { expect, test } from "vitest";
import { semanticOperationMetadata } from "@/contracts/semantic/operation-metadata";
import type { SemanticCommand } from "@/contracts/semantic/schema";
import type { OperationCall, Operations } from "@/application/semantic/sdk-types";

// Typechecked by typecheck:specs: each closed union member has exactly one callable path.
type Flatten<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends (...args: never[]) => unknown ? `${Prefix}${K}` : Flatten<T[K], `${Prefix}${K}.`>
}[keyof T & string];
type Equal<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
const exhaustive: Equal<Flatten<Operations>, SemanticCommand["operation"]> = true;
const undo: Equal<Operations["history"]["undo"], OperationCall<"history.undo">> = true;
const redo: Equal<Operations["history"]["redo"], OperationCall<"history.redo">> = true;
const svg: Equal<Operations["export"]["svg"], OperationCall<"export.svg">> = true;
const dxf: Equal<Operations["export"]["dxf"], OperationCall<"export.dxf">> = true;
function typing(ops: Operations) {
  void ops.document.create({ label: "Typed" });
  void ops.sketch.author({ primitive: { kind: "point", position: [0, 0] }, construction: false });
  void ops.history.undo({});
  void ops.extrude.create({ parameters: { resultBodyType: "solid", profiles: [{ label: "Profile" }], startExtent: { kind: "entityOffset", target: { label: "Start face" } }, extent: { mode: "oneSide", end: { kind: "upToVertex", direction: "positive", target: { label: "End point" } } }, operation: { source: "literal", value: "cut" }, booleanScope: { kind: "targetBodies", bodyIds: [{ label: "Body" }] } } });
  // @ts-expect-error owner selection belongs only to the inspection operation
  void ops.document.create({ label: "Typed", owner: { label: "Wrong" } });
  // @ts-expect-error mandatory modelling fields are not erased with chaining authority
  void ops.sketch.author({ construction: false });
  // @ts-expect-error SDK callers never supply command identity or basis
  void ops.document.create({ label: "Typed", commandId: "manual" });
  // @ts-expect-error wrong family fields cannot leak into another operation
  void ops.document.create({ depth: 4 });
  // @ts-expect-error misspelled names are not a dynamic fluent fallback
  void ops.sketch.notAnOperation({});
}

test("generated SDK operation typing exhausts the semantic union, including shared-literal arms", () => {
  expect([exhaustive, undo, redo, svg, dxf]).toEqual([true, true, true, true, true]);
  expect(semanticOperationMetadata.has("history.undo")).toBe(true);
  expect(semanticOperationMetadata.has("history.redo")).toBe(true);
  expect(semanticOperationMetadata.has("export.svg")).toBe(true);
  expect(semanticOperationMetadata.has("export.dxf")).toBe(true);
  expect(typeof typing).toBe("function");
});
