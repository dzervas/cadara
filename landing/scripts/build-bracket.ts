// From repository root: bun landing/scripts/build-bracket.ts
// JSON authoring + production CLI only. Stages are needed because different
// sketches expose identical region labels; typed refs come from saved discovery.
import { buildExample } from "./build-example";
import { finishBodyAppearance } from "../finishes";
import type {
  SemanticDiscovery,
  SemanticResult,
} from "../../src/contracts/semantic/schema";

await buildExample("bracket", async (dir, repoRoot) => {
  type RecordJSON = Record<string, unknown>;
  let operations: RecordJSON[] = [];
  let current = "";
  let sequence = 0;
  function op(operation: string, fields: RecordJSON = {}) {
    const id = `command-${++sequence}`;
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
  function draftOp(operation: string, fields: RecordJSON) {
    return op(operation, {
      draft: { alias: current },
      intent: "fulfill",
      ...fields,
    });
  }
  function author(primitive: RecordJSON) {
    return draftOp("sketch.author", { primitive, construction: false });
  }
  function label(targetLabel: string, value: string) {
    draftOp("sketch.label.set", {
      target: { alias: current, label: targetLabel },
      label: value,
    });
  }
  function publish(name: string) {
    label("Sketch Draft", name);
    op("sketch.publish", { draft: { alias: current }, requireProfiles: true });
  }
  function open() {
    operations = [];
    current = "";
    op("document.open", { path: `${dir}/bracket.cadara` });
  }
  async function execute(stem: string): Promise<SemanticDiscovery> {
    const path = `${dir}/${stem}.recipe.json`;
    await Bun.write(
      path,
      JSON.stringify({ version: 1, operations }, null, 2) + "\n",
    );
    const child = Bun.spawn(
      ["bun", "run", "cli", "--", "document", "recipe", path],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    await Bun.write(`${dir}/${stem}.log`, stdout);
    await Bun.write(`${dir}/${stem}-stderr.log`, stderr);
    if (code)
      throw new Error(
        `CLI failed (${code}); see ${stem}.log and ${stem}-stderr.log`,
      );
    const envelope = JSON.parse(stdout) as {
      results: SemanticResult[];
      unexecuted: string[];
    };
    if (envelope.unexecuted.length) throw new Error("Unexecuted operations");
    const discovery = envelope.results.at(-1)?.discovery;
    if (!discovery) throw new Error("Missing discovery");
    console.log(`${stem}: ${envelope.results.length} CLI operations completed`);
    return discovery;
  }
  function save() {
    op("document.save", { path: `${dir}/bracket.cadara` });
  }
  function profiles(discovery: SemanticDiscovery) {
    const sketch = discovery.model?.timeline
      .filter((t) => t.target.kind === "sketch")
      .at(-1)?.target;
    if (!sketch || sketch.kind !== "sketch")
      throw new Error("Missing published sketch");
    const regions = discovery.references.filter(
      (r) =>
        r.target.kind === "region" && r.target.sketchId === sketch.sketchId,
    );
    if (!regions.length) throw new Error("Missing published profiles");
    return regions.map((r) => r.target);
  }
  function extrude(
    discovery: SemanticDiscovery,
    depth: number,
    operation: string,
    direction = "positive",
  ) {
    op("extrude.create", {
      intent: "fulfill",
      parameters: {
        resultBodyType: "solid",
        profiles: profiles(discovery),
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction,
            distance: { source: "literal", value: depth },
          },
        },
        operation: { source: "literal", value: operation },
        booleanScope:
          operation === "newBody"
            ? { kind: "standalone" }
            : { kind: "targetBody", bodyId: bodyTarget.bodyId },
      },
    });
  }

  op("document.create", {
    label: "Precision gusseted angle bracket · 60 × 44 × 50 mm",
  });
  op("sketch.begin", { plane: "xy" });
  author({ kind: "rectangle", start: [-30, 0], end: [30, 44] });
  publish("Base plate · 60 × 44 × 5");
  save();
  let discovered = await execute("bracket");
  open();
  extrude(discovered, 5, "newBody");
  op("sketch.begin", { plane: "xy" });
  author({ kind: "rectangle", start: [-30, 0], end: [30, 5] });
  publish("Upright · 45 above base, 5 thick");
  save();
  discovered = await execute("bracket-02-upright");
  const body = discovered.references.find((r) => r.target.kind === "body");
  if (!body || body.target.kind !== "body")
    throw new Error("Missing base body discovery");
  const bodyTarget = { ...body.target };
  open();
  extrude(discovered, 50, "join");
  op("sketch.begin", { plane: "xy" });
  for (const x of [-20, 20])
    for (const y of [16, 35])
      author({ kind: "circle", center: [x, y], radius: 3.2 });
  publish("Base mounting pattern · 4 × Ø6.4");
  save();
  discovered = await execute("bracket-03-base-holes");
  open();
  extrude(discovered, 5, "cut");
  op("sketch.begin", { plane: "xz" });
  for (const x of [-20, 20])
    for (const z of [17, 39])
      author({ kind: "circle", center: [x, z], radius: 3.2 });
  author({ kind: "circle", center: [0, 28], radius: 9 });
  publish("Upright bores · 4 × Ø6.4 + Ø18 access");
  save();
  discovered = await execute("bracket-04-upright-holes");

  // Explicit right-handed YZ frames keep both ribs and exports in world Z-up.
  for (const [index, x] of [-28, 25].entries()) {
    open();
    extrude(
      discovered,
      index === 0 ? 5 : 3,
      index === 0 ? "cut" : "join",
      index === 0 ? "negative" : "positive",
    );
    const plane = op("plane.create", {
      intent: "fulfill",
      parameters: {
        mode: "explicitFrame",
        frame: {
          origin: [x, 0, 0],
          xAxis: [0, 1, 0],
          yAxis: [0, 0, 1],
          normal: [1, 0, 0],
          linearUnit: "documentLength",
          handedness: "rightHanded",
        },
      },
    });
    op("document.inspect");
    // Construction references are discovered before selecting the support.
    save();
    const planeDiscovery = await execute(`bracket-0${5 + index * 2}-rib-plane`);
    const feature = planeDiscovery.model?.features
      .filter((f) => f.kind === "plane")
      .at(-1);
    const construction = planeDiscovery.model?.constructions.find(
      (c) => c.ownerFeatureId === feature?.featureId,
    );
    if (!construction) throw new Error(`Missing construction from ${plane}`);
    open();
    op("sketch.begin", {
      support: {
        kind: "construction",
        constructionId: construction.constructionId,
      },
    });
    const side = index === 0 ? "Left" : "Right";
    const vertices = [
      [4, 4],
      [36, 4],
      [4, 43],
    ];
    for (let i = 0; i < 3; i++) {
      author({ kind: "line", start: vertices[i], end: vertices[(i + 1) % 3] });
      label(`Line ${i + 1}`, `${side} rib segment ${i + 1}`);
      label(`Line ${i + 1} start`, `${side} rib ${i + 1} start`);
      label(`Line ${i + 1} end`, `${side} rib ${i + 1} end`);
    }
    for (let i = 0; i < 3; i++)
      draftOp("sketch.geometry.update", {
        edit: {
          kind: "mergePoints",
          target: { alias: current, label: `${side} rib ${i + 1} end` },
          destination: {
            alias: current,
            label: `${side} rib ${((i + 1) % 3) + 1} start`,
          },
        },
      });
    publish(`${side} triangular gusset · 3 thick`);
    save();
    discovered = await execute(`bracket-0${6 + index * 2}-rib-sketch`);
  }
  open();
  extrude(discovered, 3, "join");
  // body.rename currently makes native save reject the repository/payload match.
  // Keep the production body identity; descriptive sketch names remain editable.
  save();
  op("document.inspect");
  discovered = await execute("bracket-09-final");
  const edges = discovered.model?.bodies[0]?.topology
    ?.filter((t) => {
      if (
        t.entityClass !== "edge" ||
        t.geometryType !== "line" ||
        !t.boundingBox
      )
        return false;
      const { low, high } = t.boundingBox;
      return (
        high[0] - low[0] > 59.9 &&
        ((low[2] === 50 && high[2] === 50) ||
          (low[1] === 44 && high[1] === 44 && low[2] === 5 && high[2] === 5))
      );
    })
    .map((t) => t.reference);
  if (!edges || edges.length !== 3)
    throw new Error("Expected three exact outer finishing edges");
  open();
  op("chamfer.create", {
    intent: "fulfill",
    parameters: {
      participants: [{ role: "edge", targets: edges }],
      options: { widthForm: "equalOffsets", distance: 0.6 },
    },
  });
  op("body.color.set", {
    bodyId: { alias: current, label: "Extrude 1" },
    appearance: finishBodyAppearance("silver"),
    intent: "fulfill",
  });
  save();
  op("document.inspect");
  discovered = await execute("bracket-10-edge-breaks");

  // Preview export MUST be from this fresh reopen of the final native file.
  open();
  op("document.inspect");
  op("export.stl", {
    target: bodyTarget,
    path: `${dir}/bracket.stl`,
    options: {
      meshAccuracy: { chordTolerance: 0.05, angleToleranceRadians: 0.1 },
      encoding: "binary",
    },
  });
  op("document.inspect");
  const final = await execute("bracket-export-reopen");
  if (final.model?.bodies.length !== 1)
    throw new Error("Expected one final native body");
  await Bun.write(
    `${dir}/bracket.model.json`,
    JSON.stringify(
      {
        name: "Gusseted angle bracket",
        dimensions: "60 × 44 × 50 mm",
        parts: [
          {
            file: "bracket.stl",
            label: "Extrude 1",
            finish: "silver",
            explode: [0, 0, 0],
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  const finalBody = final.model.bodies[0];
  if (finalBody?.kind !== "solid") throw new Error("Expected native solid");
  const cylinders = finalBody.topology?.filter(
    (t) => t.entityClass === "face" && t.geometryType === "cylinder",
  ).length;
  if (cylinders !== 9) throw new Error("Expected nine native bore cylinders");
  const bytes = new DataView(
    await Bun.file(`${dir}/bracket.stl`).arrayBuffer(),
  );
  const triangles = bytes.getUint32(80, true);
  if (bytes.byteLength !== 84 + triangles * 50)
    throw new Error("Invalid binary STL byte count");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const parents: number[] = [];
  const vertices = new Map<string, number>();
  function root(index: number): number {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!;
      index = parents[index]!;
    }
    return index;
  }
  for (let t = 0; t < triangles; t++) {
    const indices: number[] = [];
    for (let v = 0; v < 3; v++) {
      const xyz = [0, 1, 2].map((a) =>
        bytes.getFloat32(84 + t * 50 + 12 + v * 12 + a * 4, true),
      );
      xyz.forEach((value, a) => {
        min[a] = Math.min(min[a]!, value);
        max[a] = Math.max(max[a]!, value);
      });
      const key = xyz.map((value) => Math.round(value * 10000)).join(",");
      let index = vertices.get(key);
      if (index === undefined) {
        index = parents.length;
        parents.push(index);
        vertices.set(key, index);
      }
      indices.push(index);
    }
    for (const index of indices.slice(1))
      parents[root(index)] = root(indices[0]!);
  }
  const components = new Set(parents.map((_, i) => root(i))).size;
  if (components !== 1)
    throw new Error(
      `Expected connected bracket mesh, found ${components} components`,
    );
  const dimensions = max.map((value, a) => value - min[a]!);
  if (dimensions.some((value, a) => Math.abs(value - [60, 44, 50][a]!) > 0.001))
    throw new Error("Unexpected STL dimensions");
  const summary = {
    bodies: final.model.bodies.length,
    nativeKind: finalBody.kind,
    bounds: finalBody.bounds,
    features: final.model.features.length,
    cylindricalBores: cylinders,
    triangles,
    stlBytes: bytes.byteLength,
    meshComponents: components,
    stlBounds: { min, max },
    dimensions,
    coordinateSystem: "world millimeters, Z-up",
  };
  await Bun.write(
    `${dir}/bracket-validation.log`,
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary));
});
