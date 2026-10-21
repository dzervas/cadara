// Run from repository root: bun landing/scripts/build-wheel.ts
// Only production CLI subprocesses author geometry. Multiple stages are needed
// because region labels ("Outer region") are not sketch-qualified CLI aliases.
// Each saved stage's exact discovered references feed the following recipe.
import { buildExample } from "./build-example";
import { finishBodyAppearance, type Finish } from "../finishes";

const wheelFinish = (i: number): Finish =>
  i === 0 ? "silver" : i === 1 ? "gold" : "black";
import { join } from "node:path";
await buildExample("wheel", async (dir, repoRoot) => {
  type RecordValue = Record<string, unknown>;
  type Reference = {
    label: string;
    target: RecordValue & {
      kind: string;
      bodyId?: string;
      sketchId?: string;
      regionId?: string;
      edgeId?: string;
    };
  };
  type Topology = {
    entityClass: string;
    geometryType: string;
    definingData?: { radius?: number; center?: number[] };
    reference: Reference["target"];
  };
  type Body = {
    bodyId: string;
    kind: string;
    bounds: { min: number[]; max: number[] };
    topology: Topology[];
  };
  type Discovery = {
    references: Reference[];
    model: {
      bodies: Body[];
      features: {
        featureId: string;
        kind: string;
        producedTargets: Reference["target"][];
      }[];
    };
  };
  type Result = {
    correlation: { commandId: string };
    outcome: { kind: string };
    completion: {
      file: { kind: string };
      geometry: { kind: string };
      persistence: { kind: string };
    };
    discovery?: Discovery;
    diagnostics: unknown[];
  };
  type Envelope = {
    results: Result[];
    unexecuted: string[];
    cleanup: { resourcesReleased: boolean };
  };
  const ref = (alias: string, label: string) => ({ alias, label });
  const literal = (value: number | string) => ({ source: "literal", value });
  let operations: RecordValue[] = [];
  let current = "";
  function reset() {
    operations = [];
    current = "";
  }
  function add(operation: string, fields: RecordValue = {}) {
    const id = `wheel-${operations.length + 1}`;
    operations.push({
      version: 1,
      commandId: id,
      operation,
      basis: current ? { alias: current } : null,
      ...fields,
      as: id,
    });
    current = id;
    return id;
  }
  function resultDiscovery(result: Result): Discovery {
    if (!result.discovery) throw new Error("Missing authoritative discovery");
    return result.discovery;
  }
  async function run(name: string): Promise<Envelope> {
    const path = join(dir, `wheel${name}.recipe.json`);
    await Bun.write(
      path,
      JSON.stringify({ version: 1, operations }, null, 2) + "\n",
    );
    const child = Bun.spawn(
      ["bun", "run", "cli", "--", "document", "recipe", path],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await Bun.write(join(dir, `wheel${name}.log`), stdout + stderr);
    const envelope = JSON.parse(stdout) as Envelope;
    if (
      exit !== 0 ||
      envelope.unexecuted.length ||
      !envelope.cleanup.resourcesReleased ||
      envelope.results.some((r) => r.outcome.kind !== "completed")
    )
      throw new Error(`CLI stage ${name} failed; see wheel${name}.log`);
    console.log(
      `CLI ${name || "final"}: ${envelope.results.length} successful operations`,
    );
    return envelope;
  }
  const path = (name: string) => join(dir, name);
  const save = (name: string) => add("document.save", { path: path(name) });
  const open = (name: string) =>
    add("document.open", { path: path(name), basis: null });
  const publishCommands = new Map<string, string>();
  function begin() {
    add("sketch.begin", { plane: "xy" });
  }
  function author(primitive: RecordValue) {
    return add("sketch.author", {
      draft: { alias: current },
      primitive,
      construction: false,
      intent: "fulfill",
    });
  }
  function publish(name: string) {
    const id = add("sketch.publish", {
      draft: { alias: current },
      requireProfiles: true,
    });
    publishCommands.set(name, id);
  }
  function circle(name: string, center: number[], radius: number) {
    begin();
    author({ kind: "circle", center, radius });
    publish(name);
  }
  const screws = Array.from({ length: 3 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 3;
    return [16.5 * Math.cos(a), 16.5 * Math.sin(a)];
  });
  add("document.create", {
    label: "Six-spoke control wheel · Ø80",
    basis: null,
  });
  circle("wheel", [0, 0], 40);
  circle("bore", [0, 0], 6);
  circle("hub-flange", [0, 0], 19.4);
  circle("hub-upper", [0, 0], 14);
  for (let i = 0; i < 6; i++) {
    const a = ((30 + 60 * i) * Math.PI) / 180;
    const point = (r: number) => [r * Math.cos(a), r * Math.sin(a)];
    begin();
    author({ kind: "line", start: point(23), end: point(29) });
    // Keep each seed label globally unique, even across committed sketches.
    const seed = `Window ${i + 1} axis`;
    add("sketch.label.set", {
      draft: { alias: current },
      target: ref(current, "Line 1"),
      label: seed,
      intent: "fulfill",
    });
    add("sketch.geometry.build", {
      draft: { alias: current },
      targets: [ref(current, seed)],
      kind: "slot",
      width: 12,
      intent: "fulfill",
    });
    add("sketch.construction.set", {
      draft: { alias: current },
      target: ref(current, seed),
      construction: true,
      intent: "fulfill",
    });
    publish(`window-${i}`);
  }
  for (const [i, center] of screws.entries()) {
    circle(`shaft-${i}`, center, 1.4);
    circle(`clearance-${i}`, center, 1.65);
    circle(`head-${i}`, center, 2.3);
    begin();
    author({ kind: "inscribedPolygon", center, radius: 1.25 });
    publish(`socket-${i}`);
  }
  save("wheel-sketches.cadara");
  const sketchEnvelope = await run("-sketches");
  const profiles = new Map<string, Reference["target"]>();
  for (const [name, command] of publishCommands) {
    const index = sketchEnvelope.results.findIndex(
      (r) => r.correlation.commandId === command,
    );
    // Compare exact discovered identities rather than relying on list order.
    const published = resultDiscovery(sketchEnvelope.results[index]);
    const earlier = new Set([...profiles.values()].map((p) => p.sketchId));
    const sketches = published.references.filter(
      (r) => r.target.kind === "sketch" && !earlier.has(r.target.sketchId),
    );
    if (sketches.length !== 1)
      throw new Error(`Expected one new sketch for ${name}`);
    const sketch = sketches[0].target;
    const regions = published.references.filter(
      (r) =>
        r.target.kind === "region" && r.target.sketchId === sketch?.sketchId,
    );
    const outer = regions.filter((r) => r.label === "Outer region");
    if (outer.length !== 1)
      throw new Error(
        `Expected one outer profile for ${name}; got ${JSON.stringify(regions)}`,
      );
    profiles.set(name, outer[0].target);
  }
  function extrusion(
    profileName: string,
    z: number,
    depth: number,
    operation = "newBody",
    body?: string,
  ) {
    const profile = profiles.get(profileName);
    if (!profile) throw new Error(`Missing profile ${profileName}`);
    return add("extrude.create", {
      parameters: {
        resultBodyType: "solid",
        profiles: [profile],
        startExtent:
          z === 0
            ? { kind: "profilePlane" }
            : {
                kind: "blindOffset",
                distance: literal(z),
                direction: "positive",
              },
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: literal(depth),
          },
        },
        operation: literal(operation),
        booleanScope: body
          ? { kind: "targetBody", bodyId: ref(current, body) }
          : { kind: "standalone" },
      },
      intent: "fulfill",
    });
  }
  reset();
  open("wheel-sketches.cadara");
  const bodyCommands = [
    extrusion("wheel", 0, 8),
    extrusion("hub-flange", 8, 4),
  ];
  for (let i = 0; i < 3; i++) bodyCommands.push(extrusion(`shaft-${i}`, 3, 9));
  save("wheel-bodies.cadara");
  const bodiesEnvelope = await run("-bodies");
  const labels = ["Wheel", "Hub", "Screw 1", "Screw 2", "Screw 3"];
  const baseDiscovery = resultDiscovery(bodiesEnvelope.results.at(-1)!);
  reset();
  open("wheel-bodies.cadara");
  const bodiesByLabel = new Map<string, Body>();
  for (const [i, command] of bodyCommands.entries()) {
    const result = bodiesEnvelope.results.find(
      (r) => r.correlation.commandId === command,
    )!;
    const before =
      bodiesEnvelope.results[bodiesEnvelope.results.indexOf(result) - 1];
    const oldFeatures = new Set(
      resultDiscovery(before).model.features.map((f) => f.featureId),
    );
    const features = resultDiscovery(result).model.features.filter(
      (f) => !oldFeatures.has(f.featureId),
    );
    if (features.length !== 1)
      throw new Error("Expected one newly produced feature");
    const body = features[0].producedTargets.find((t) => t.kind === "body");
    if (!body?.bodyId) throw new Error("Missing produced body identity");
    const topology = baseDiscovery.model.bodies.find(
      (b) => b.bodyId === body.bodyId,
    );
    if (!topology) throw new Error(`Missing discovered body ${body.bodyId}`);
    bodiesByLabel.set(labels[i], topology);
    add("body.rename", {
      bodyId: body.bodyId,
      label: labels[i],
      intent: "fulfill",
    });
  }
  function chamferCircle(body: Body, radius: number, distance: number) {
    const edges = body.topology.filter(
      (t) =>
        t.entityClass === "edge" &&
        t.geometryType === "circle" &&
        t.definingData?.radius === radius,
    );
    if (edges.length !== 2)
      throw new Error(`Expected two circular edges at radius ${radius}`);
    add("chamfer.create", {
      parameters: {
        participants: [
          { role: "edge", targets: edges.map((e) => e.reference) },
        ],
        options: { widthForm: "equalOffsets", distance },
      },
      intent: "fulfill",
    });
  }
  const wheel = bodiesByLabel.get("Wheel");
  const hub = bodiesByLabel.get("Hub");
  if (!wheel || !hub) throw new Error("Missing mapped Wheel or Hub body");
  chamferCircle(wheel, 40, 0.8);
  extrusion("bore", 0, 8, "cut", "Wheel");
  for (let i = 0; i < 6; i++) extrusion(`window-${i}`, 0, 8, "cut", "Wheel");
  for (let i = 0; i < 3; i++) extrusion(`clearance-${i}`, 3, 5, "cut", "Wheel");
  // Flange starts exactly at the wheel's top: contact, not volume overlap.
  // Head/shaft clearance is 0.25 mm radially; head clears Ø28 hub by 0.2 mm.
  chamferCircle(hub, 19.4, 0.35);
  extrusion("hub-upper", 11.6, 8.4, "join", "Hub");
  extrusion("bore", 8, 12, "cut", "Hub");
  for (let i = 0; i < 3; i++) extrusion(`clearance-${i}`, 8, 4, "cut", "Hub");
  for (let i = 0; i < 3; i++) {
    extrusion(`head-${i}`, 11.8, 3.2, "join", `Screw ${i + 1}`);
    extrusion(`socket-${i}`, 13.1, 1.9, "cut", `Screw ${i + 1}`);
  }
  // Screws' heads start below flange top only inside the clearance's void? The
  // clearance is enlarged below to counterbore heads, avoiding any solid overlap.
  for (let i = 0; i < 3; i++) extrusion(`head-${i}`, 11.75, 0.25, "cut", "Hub");
  for (const [i, label] of labels.entries())
    add("body.color.set", {
      bodyId: ref(current, label),
      appearance: finishBodyAppearance(wheelFinish(i)),
      intent: "fulfill",
    });
  save("wheel.cadara");
  add("document.inspect");
  await run("");
  // The only preview exports are performed after reopening the FINAL native file.
  reset();
  open("wheel.cadara");
  add("document.inspect");
  const parts = labels.map((label, i) => ({
    file:
      i === 0
        ? "wheel.stl"
        : i === 1
          ? "wheel-hub.stl"
          : `wheel-screw-${i - 1}.stl`,
    label,
    finish: wheelFinish(i),
    explode: [0, 0, i === 0 ? 0 : i === 1 ? 25 : 40],
  }));
  for (const part of parts)
    add("export.stl", {
      target: ref(current, part.label),
      path: path(part.file),
      options: {
        meshAccuracy: { chordTolerance: 0.05, angleToleranceRadians: 0.1 },
        encoding: "binary",
      },
    });
  const exported = await run("-export-reopen");
  const reopened = resultDiscovery(exported.results[1]);
  if (reopened.model.bodies.length !== 5)
    throw new Error("Expected five reopened native bodies");
  const nativeLabels = reopened.references
    .filter((r) => r.target.kind === "body")
    .map((r) => r.label);
  if (labels.some((label) => !nativeLabels.includes(label)))
    throw new Error("Missing native body label");
  for (const part of parts) {
    const bytes = Buffer.from(await Bun.file(path(part.file)).arrayBuffer());
    if (bytes.length < 84 || bytes.length !== 84 + 50 * bytes.readUInt32LE(80))
      throw new Error(`Invalid binary STL: ${part.file}`);
  }
  await Bun.write(
    path("wheel.model.json"),
    JSON.stringify(
      {
        name: "Six-spoke control wheel",
        dimensions: "Ø80 × 20 mm · Ø12 bore · 8 mm web",
        parts,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Verified final reopened native wheel: five bodies, five binary STL exports.",
  );
});
