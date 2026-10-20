import { expect, test } from "vitest";
import { createSemanticSessionWorkflow } from "../../../test/helpers/semantic-session-workflow";
import { SemanticDocument } from "./sdk";

// Real OCC modeling, probe, and replay take ~5 s alone and ~12 s under
// `bun run test` load; the static graph transforms before the test, so moving
// imports cannot remove this execution cost from its budget (cadara-5hk).
test("native reference extents and multi-body scopes remain portable through SDK probes and replay", async () => {
  const makeDocument = async (): Promise<SemanticDocument> => {
    const workflow = await createSemanticSessionWorkflow("sdk-native-extent");
    return new SemanticDocument(workflow.session, undefined, makeDocument);
  };
  const doc = await makeDocument();
  const copy = await makeDocument();
  const rectangle = async (plane: "xy" | "yz", end: readonly [number, number], start: readonly [number, number] = [0, 0]) => {
    await doc.ops.sketch.begin({ plane });
    await doc.ops.sketch.author({ primitive: { kind: "rectangle", start, end }, construction: false });
    const sketch = await doc.ops.sketch.publish({ requireProfiles: true });
    return doc.references({ kind: "region", owner: { kind: "sketch", sketchId: sketch.discovery!.sketch!.sketchId! } })[0]!.target;
  };
  try {
    await doc.ops.document.create({ label: "Reference extent" });
    await doc.ops.variable.add({ name: "height", valueText: "10" });
    await doc.ops.extrude.create({ profile: await rectangle("xy", [20, 10]), depth: "height" });
    const base = doc.references({ kind: "body" })[0]!.target;
    await doc.ops.extrude.create({ parameters: {
      resultBodyType: "solid", profiles: [await rectangle("xy", [6, 5], [2, 2])], startExtent: { kind: "profilePlane" },
      extent: { mode: "oneSide", end: { kind: "upToPart", direction: "positive", target: base } },
      operation: { source: "literal", value: "newBody" }, booleanScope: { kind: "standalone" },
    } });
    const bodies = doc.references({ kind: "body" }).map((r) => r.target);
    await doc.ops.extrude.create({ parameters: {
      resultBodyType: "solid", profiles: [await rectangle("yz", [3, 30])], startExtent: { kind: "profilePlane" },
      extent: { mode: "oneSide", end: { kind: "throughAll", direction: "positive" } },
      operation: { source: "literal", value: "cut" }, booleanScope: { kind: "targetBodies", bodyIds: bodies },
    } });
    const facts = doc.inspect(["bounds"]);
    expect(facts.bounds).toEqual([{ min: [0, 3, 0], max: [20, 10, 10] }, { min: [2, 3, 0], max: [6, 5, 10] }]);
    const source = JSON.stringify(doc.current!.result);
    const probe = await doc.probe([{ operation: "variable.update", fields: { variableId: { label: "height" }, name: "height", valueText: "12" } }]);
    expect(probe.results[0]!.outcome.kind).toBe("completed");
    expect(probe.facts.bounds.map((b) => b!.max[2])).toEqual([12, 12]);
    expect(JSON.stringify(doc.current!.result)).toBe(source);
    const results = await copy.replay(doc.trace());
    expect(results.every((r) => r.outcome.kind === "completed")).toBe(true);
    expect(copy.inspect(["bounds"])).toEqual(facts);
  } finally { await doc.close(); await copy.close(); }
}, 60_000);
