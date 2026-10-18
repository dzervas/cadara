/** @param {import("cadara-cli/sdk").SemanticDocument} doc */
export default async function (doc) {
  await doc.ops.document.rename({ label: "SDK plate" });
  await doc.ops.variable.add({ name: "thickness", valueText: "4" });
  await doc.ops.sketch.begin({ plane: "xy" });
  await doc.ops.sketch.author({
    primitive: { kind: "rectangle", start: [0, 0], end: [40, 20] },
    construction: false,
  });
  const published = await doc.ops.sketch.publish({ requireProfiles: true });
  const owner = { kind: "sketch", sketchId: published.discovery.sketch.sketchId };
  const profile = doc.references({ owner, kind: "region" })[0].target;
  await doc.ops.extrude.create({ profile, depth: "thickness" });
  const probe = await doc.probe([{
    operation: "variable.update",
    fields: { variableId: { label: "thickness" }, name: "thickness", valueText: "6" },
  }]);
  if (probe.results[0]?.outcome.kind !== "completed" || probe.cleanup.kind !== "closed" || probe.facts.bounds[0]?.max[2] !== 6)
    throw new Error("Thickness probe did not certify the requested rebuild");
  await doc.ops.document.save({ path: "plate.cadara" });
  return { facts: doc.inspect(["bounds", "topologyCounts"]), probe: probe.facts };
}
