// Run from the repository root:
// bun scripts/build-cli.mjs /tmp/cadara-cli
// bun landing/scripts/build-enclosure.ts /tmp/cadara-cli
// Only the built production CLI authors native data and tessellates exports.
import { buildExample } from "./build-example";
import { finishBodyAppearance, type Finish } from "../finishes";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluate } from "mathjs";
import type { SemanticResult } from "../../src/contracts/semantic/schema";

type Discovery = NonNullable<SemanticResult["discovery"]>;
type Operation = Record<string, unknown> & {
  operation: string;
  commandId: string;
  as: string;
};
type Envelope = {
  results: SemanticResult[];
  unexecuted: string[];
  cleanup: { kind: string; resourcesReleased: boolean };
};
type Point = [number, number];
type Shape = {
  primitive: Record<string, unknown>;
  coordinates: Map<string, string>;
  radius?: string;
};
type Sketch = {
  id: string;
  name: string;
  plane: string;
  shapes: Shape[];
  beveled?: boolean;
};
type Dimension = {
  tool: string;
  labels: string[];
  value: number;
  expression: string;
};
const cli = resolve(process.argv[2] ?? "dist-cli", "main.js");
if (!existsSync(cli))
  throw new Error(
    "Build the CLI package first; pass its directory as argv[2].",
  );

await buildExample("enclosure", async (dir, repoRoot) => {
  // Preserve the existing 100 × 70 × 32 assembly, including its intentional
  // 0.3 mm lid gap and 0.6 mm diametral screw clearance. These are independent
  // fit choices, not aliases for wall thickness or screw diameter.
  const variables: Record<string, number> = {
    width: 100,
    depth: 70,
    height: 32,
    wall: 3,
    lidThickness: 3,
    lidGap: 0.3,
    cornerBevel: 1.5,
    mountingInset: 8,
    bossDiameter: 9,
    screwDiameter: 3,
    screwClearance: 0.6,
    screwLength: 10,
    screwHeadDiameter: 5.6,
    screwHeadHeight: 2,
    headClearance: 0.5,
    headSeatDepth: 2.3,
    socketDiameter: 2.6,
    socketFloor: 0.7,
    bossOverlap: 1,
    boreFloor: 7,
    ventWidth: 3,
    ventPitch: 7.5,
    ventHeight: 12,
    ventBottom: 10,
    connectorWidth: 16,
    connectorHeight: 9,
    connectorCenterY: -11,
    connectorCenterZ: 14.5,
    roundConnectorDiameter: 8.5,
    roundConnectorY: 15,
  };
  const value = (expression: string) => {
    // Seed evaluation is authoring convenience only. The final document retains
    // expressions in driving dimensions and feature scalars; no native patching.
    return evaluate(expression, variables) as number;
  };
  const coordinates = (points: [string, string][]) =>
    new Map(
      points.map(([x, y]) => [
        JSON.stringify([value(x), value(y)]),
        JSON.stringify([x, y]),
      ]),
    );
  const rectangle = (
    x0: string,
    y0: string,
    x1: string,
    y1: string,
  ): Shape => ({
    primitive: {
      kind: "rectangle",
      start: [value(x0), value(y0)],
      end: [value(x1), value(y1)],
    },
    coordinates: coordinates([
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]),
  });
  const circle = (
    x: string,
    y: string,
    diameter: string,
    polygon = false,
  ): Shape => ({
    primitive: {
      kind: polygon ? "inscribedPolygon" : "circle",
      center: [value(x), value(y)],
      radius: value(diameter) / 2,
    },
    coordinates: coordinates([[x, y]]),
    radius: `(${diameter}) / 2`,
  });
  const corners: [string, string][] = [
    ["-width/2+mountingInset", "-depth/2+mountingInset"],
    ["width/2-mountingInset", "-depth/2+mountingInset"],
    ["width/2-mountingInset", "depth/2-mountingInset"],
    ["-width/2+mountingInset", "depth/2-mountingInset"],
  ];
  const sketches: Sketch[] = [];
  const plan = (
    id: string,
    name: string,
    shapes: Shape[],
    plane = "xy",
    beveled = false,
  ) => sketches.push({ id, name, shapes, plane, beveled });
  const footprint = rectangle("-width/2", "-depth/2", "width/2", "depth/2");
  // Chamfer construction is not associative. Dimension its resulting vertices
  // instead, so cornerBevel remains a real driver rather than a baked edit.
  footprint.coordinates = coordinates([
    ["-width/2+cornerBevel", "-depth/2"],
    ["width/2-cornerBevel", "-depth/2"],
    ["width/2", "-depth/2+cornerBevel"],
    ["width/2", "depth/2-cornerBevel"],
    ["width/2-cornerBevel", "depth/2"],
    ["-width/2+cornerBevel", "depth/2"],
    ["-width/2", "depth/2-cornerBevel"],
    ["-width/2", "-depth/2+cornerBevel"],
  ]);
  plan("footprint", "Enclosure footprint", [footprint], "xy", true);
  plan("cavity", "Shell cavity", [
    rectangle("-width/2+wall", "-depth/2+wall", "width/2-wall", "depth/2-wall"),
  ]);
  plan(
    "bosses",
    "Mounting bosses",
    corners.map(([x, y]) => circle(x, y, "bossDiameter")),
  );
  plan(
    "bores",
    "Shell screw-hole layout",
    corners.map(([x, y]) => circle(x, y, "screwDiameter+screwClearance")),
  );
  // The bounded sketch pattern has numeric-only pitch and only one copy. Shared
  // expression dimensions preserve editable pitch/width for all eight apertures.
  plan(
    "vents",
    "Side ventilation array",
    Array.from({ length: 8 }, (_, i) =>
      rectangle(
        `(${i}-3.5)*ventPitch-ventWidth/2`,
        "ventBottom",
        `(${i}-3.5)*ventPitch+ventWidth/2`,
        "ventBottom+ventHeight",
      ),
    ),
    "xz",
  );
  plan(
    "connectors",
    "Front connector openings",
    [
      rectangle(
        "connectorCenterY-connectorWidth/2",
        "connectorCenterZ-connectorHeight/2",
        "connectorCenterY+connectorWidth/2",
        "connectorCenterZ+connectorHeight/2",
      ),
      circle("roundConnectorY", "connectorCenterZ", "roundConnectorDiameter"),
    ],
    "yz",
  );
  plan("lid", "Lid footprint", [
    rectangle("-width/2", "-depth/2", "width/2", "depth/2"),
  ]);
  plan(
    "lidHoles",
    "Lid screw-hole layout",
    corners.map(([x, y]) => circle(x, y, "screwDiameter+screwClearance")),
  );
  plan(
    "headSeats",
    "Lid screw-head seats",
    corners.map(([x, y]) => circle(x, y, "screwHeadDiameter+headClearance")),
  );
  // Skill-trial limitation (cadara-ppa): the default model saves/reopens/exports,
  // but width 100→104 followed by depth 70→74 collapses the production polygon
  // solver's six socket edges; each edit alone passes save/reopen checks.
  // Green solveStatus alone is insufficient (cadara-8kv).
  // Keep this defect visible: do not freeze sockets or substitute assembly
  // transforms here. Shared-variable editability remains only partly qualified.
  for (const [i, [x, y]] of corners.entries()) {
    // Separate supports/responsibilities here are intentional: each physical
    // screw has its own new-body identity and downstream boolean scope.
    plan(`shaft${i}`, `Screw ${i + 1} shank`, [circle(x, y, "screwDiameter")]);
    plan(`head${i}`, `Screw ${i + 1} head`, [
      circle(x, y, "screwHeadDiameter"),
    ]);
    plan(`socket${i}`, `Screw ${i + 1} hex socket`, [
      circle(x, y, "socketDiameter", true),
    ]);
  }
  let ops: Operation[] = [],
    current = "";
  const ref = (alias: string, label: string, sketch?: string) => ({
    alias,
    label,
    ...(sketch ? { sketch } : {}),
  });
  function command(
    id: string,
    operation: string,
    args: Record<string, unknown> = {},
  ) {
    ops.push({
      version: 1,
      commandId: id,
      operation,
      basis: current ? { alias: current } : null,
      ...args,
      as: id,
    });
    current = id;
    return id;
  }
  const draft = (
    id: string,
    operation: string,
    args: Record<string, unknown> = {},
  ) =>
    command(id, operation, {
      draft: { alias: current },
      ...(operation === "sketch.inspect" || operation === "sketch.publish"
        ? {}
        : { intent: "fulfill" }),
      ...args,
    });
  async function run(name: string) {
    const path = `${dir}/${name}.recipe.json`;
    await writeFile(
      path,
      JSON.stringify({ version: 1, operations: ops }, null, 2) + "\n",
    );
    const result = spawnSync("bun", [cli, "document", "recipe", path], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 512,
    });
    await writeFile(`${dir}/${name}.stdout.json`, result.stdout);
    await writeFile(`${dir}/${name}.stderr.txt`, result.stderr);
    if (result.status !== 0)
      throw new Error(
        `${name}: exit ${result.status}; inspect retained stdout/stderr receipts`,
      );
    const envelope = JSON.parse(result.stdout) as Envelope;
    if (
      envelope.unexecuted.length ||
      envelope.cleanup.kind !== "closed" ||
      !envelope.cleanup.resourcesReleased ||
      envelope.results.some((r) => r.outcome.kind !== "completed")
    )
      throw new Error(`${name}: incomplete recipe`);
    for (const op of ops.filter(
      (o) =>
        o.operation === "document.save" || o.operation.startsWith("export."),
    )) {
      if (
        envelope.results.find((r) => r.correlation.commandId === op.commandId)
          ?.completion.file.kind !== "written"
      )
        throw new Error(`${name}: missing write receipt for ${op.commandId}`);
    }
    return new Map(
      envelope.results.map((r) => [r.correlation.commandId, r.discovery!]),
    );
  }
  function reset() {
    ops = [];
    current = "";
    command("create", "document.create", {
      label: "VENT / 100 — electronics enclosure",
    });
    for (const [name, n] of Object.entries(variables))
      command(`variable-${name}`, "variable.add", {
        name,
        valueText: String(n),
        intent: "fulfill",
      });
  }
  const dimensions = new Map<string, Dimension[]>();
  let seeds: Map<string, Discovery> | undefined;
  let numeric: Map<string, Discovery> | undefined;
  // Discovery passes do not save or reopen to evade selection or persistence.
  // They learn generated labels; final authoring remains one uninterrupted recipe.
  for (const pass of ["discover", "dimensions", "model"] as const) {
    reset();
    let extrusion = 0;
    const scalar = (expression: string) => ({
      source: "expression",
      valueText: expression,
    });
    function extrude(
      id: string,
      depth: string,
      offset: string,
      operation = "newBody",
      body?: string,
      symmetric = false,
      direction = "positive",
    ) {
      const published = `${id}-publish`;
      const d = numeric!.get(published)!;
      const labels = d.references
        .filter(
          (r) =>
            r.target.kind === "region" &&
            r.target.sketchId === d.sketch!.sketchId,
        )
        .map((r) => r.label);
      if (labels.length !== sketches.find((s) => s.id === id)!.shapes.length)
        throw new Error(`${id}: unexpected region count ${labels.length}`);
      extrusion++;
      command(`${id}-extrude`, "extrude.create", {
        intent: "fulfill",
        parameters: {
          resultBodyType: "solid",
          profiles: labels.map((label) => ref(published, label, published)),
          startExtent:
            offset === "0"
              ? { kind: "profilePlane" }
              : { kind: "blindOffset", distance: scalar(offset), direction },
          extent: {
            mode: symmetric ? "symmetric" : "oneSide",
            end: {
              kind: "blind",
              direction: "positive",
              distance: scalar(depth),
            },
          },
          operation: { source: "literal", value: operation },
          booleanScope: body
            ? { kind: "targetBody", bodyId: ref(current, body) }
            : { kind: "standalone" },
        },
      });
    }
    function rename(id: string, label: string) {
      command(`${id}-body-name`, "body.rename", {
        bodyId: ref(current, `Extrude ${extrusion}`),
        label,
        intent: "fulfill",
      });
    }
    const shell = "Graphite enclosure shell",
      lid = "Gold lid";
    for (const sketch of sketches) {
      const { id } = sketch;
      command(`${id}-begin`, "sketch.begin", { plane: sketch.plane });
      draft(`${id}-name`, "sketch.label.set", {
        target: ref(current, "Sketch Draft"),
        label: sketch.name,
      });
      for (const [i, shape] of sketch.shapes.entries())
        draft(`${id}-shape${i}`, "sketch.author", {
          primitive: shape.primitive,
          construction: false,
        });
      if (sketch.beveled)
        for (const [i, pair] of [
          ["bottom", "right"],
          ["right", "top"],
          ["top", "left"],
          ["left", "bottom"],
        ].entries()) {
          // Label is taken from the qualified rectangle probe; unchanged source
          // entities survive all four chamfer construction operations.
          draft(`${id}-bevel${i}`, "sketch.geometry.build", {
            targets: pair.map((side) => ref(current, `Rectangle 1 ${side}`)),
            kind: "chamfer",
            distance: variables.cornerBevel,
          });
        }
      draft(`${id}-seed`, "sketch.inspect");
      if (pass !== "discover") {
        if (id.startsWith("socket")) {
          const d = seeds!.get(`${id}-seed`)!;
          const s = d.sketch!;
          const circle = s.entities.find((e) => e.kind === "circle")!;
          const center = s.points.find(
            (p) => p.pointId === circle.pointIds[0],
          )!;
          const vertical = s.entities.filter((e) => {
            if (e.kind !== "lineSegment") return false;
            const [a, b] = e.pointIds.map(
              (id) => s.points.find((p) => p.pointId === id)!,
            );
            return (
              Math.abs(a.position[0] - b.position[0]) < 1e-7 &&
              a.position[0] > center.position[0]
            );
          });
          if (vertical.length !== 1)
            throw new Error(`${id}: expected one right vertical socket side`);
          const side = d.references.find(
            (r) =>
              r.target.kind === "sketchEntity" &&
              r.target.entityId === vertical[0].entityId,
          )!;
          // Regularity plus center/radius leaves rotation free; anchor the hex
          // orientation geometrically, without fixing the polygon in space.
          draft(`${id}-orientation`, "sketch.requirement.add", {
            targets: [ref(current, side.label, current)],
            tool: "constraintVertical",
            mode: "driving",
            value: null,
          });
        }
        const ds = dimensions.get(id)!;
        for (const [i, dim] of ds.entries())
          draft(`${id}-dim${i}`, "sketch.requirement.add", {
            targets: dim.labels.map((label) => ref(current, label, current)),
            tool: dim.tool,
            mode: "driving",
            value: dim.value,
          });
        if (pass === "model")
          for (const [i, dim] of ds.entries()) {
            const d = numeric!.get(`${id}-dim${i}`)!;
            const previous = i
              ? numeric!.get(`${id}-dim${i - 1}`)!
              : seeds!.get(`${id}-seed`)!;
            const prior = new Set(
              previous.sketch!.requirements.map((r) => r.label),
            );
            const added = d.sketch!.requirements.filter(
              (r) => !prior.has(r.label),
            );
            if (added.length !== 1)
              throw new Error(
                `${id}: expected a unique newly discovered dimension`,
              );
            draft(`${id}-expression${i}`, "sketch.dimension.update", {
              dimensionId: ref(current, added[0].label, current),
              value: dim.expression,
            });
            draft(`${id}-dimension-name${i}`, "sketch.label.set", {
              target: ref(current, added[0].label, current),
              label: `${sketch.name} ${i + 1}: ${dim.expression}`,
            });
          }
      }
      draft(`${id}-solved`, "sketch.inspect");
      draft(`${id}-publish`, "sketch.publish", { requireProfiles: true });
    }
    // All supports are base planes. Publish their independent sketches before
    // solids so private dimension edits do not repeatedly rebuild the assembly.
    // The +1 / +0.5 cutter overtravel constants only clear boolean boundaries;
    // they are not independent part dimensions or hidden fit parameters.
    if (pass === "model") {
      for (const { id } of sketches) {
        if (id === "footprint") {
          extrude(id, "height-lidThickness-lidGap", "0");
          rename(id, shell);
        } else if (id === "cavity") extrude(id, "height", "wall", "cut", shell);
        else if (id === "bosses")
          extrude(
            id,
            "height-lidThickness-lidGap-wall+bossOverlap",
            "wall-bossOverlap",
            "join",
            shell,
          );
        else if (id === "bores")
          extrude(id, "height-boreFloor", "boreFloor", "cut", shell);
        else if (id === "vents")
          extrude(id, "depth/2+1", "0", "cut", shell, true);
        else if (id === "connectors")
          extrude(id, "wall+1", "width/2+0.5", "cut", shell, false, "negative");
        else if (id === "lid") {
          extrude(id, "lidThickness", "height-lidThickness");
          rename(id, lid);
        } else if (id === "lidHoles")
          extrude(
            id,
            "lidThickness+1",
            "height-lidThickness-lidGap/2",
            "cut",
            lid,
          );
        else if (id === "headSeats")
          extrude(id, "lidThickness", "height-headSeatDepth", "cut", lid);
        else {
          const i = Number(id.replace(/\D/g, "")),
            screw = `Black socket-head screw ${i + 1}`;
          if (id.startsWith("shaft")) {
            extrude(id, "screwLength", "height-screwHeadHeight-screwLength");
            rename(id, screw);
          } else if (id.startsWith("head"))
            extrude(
              id,
              "screwHeadHeight",
              "height-screwHeadHeight",
              "join",
              screw,
            );
          else
            extrude(
              id,
              "screwHeadHeight",
              "height-screwHeadHeight+socketFloor",
              "cut",
              screw,
            );
        }
      }
    }
    if (pass === "model") {
      const finishByLabel: [string, Finish][] = [
        [shell, "graphite"],
        [lid, "gold"],
        ...corners.map((_, i): [string, Finish] => [
          `Black socket-head screw ${i + 1}`,
          "black",
        ]),
      ];
      for (const [i, [label, finish]] of finishByLabel.entries())
        command(`color-${i}`, "body.color.set", {
          bodyId: ref(current, label),
          appearance: finishBodyAppearance(finish),
          intent: "fulfill",
        });
      command("save", "document.save", { path: `${dir}/enclosure.cadara` });
    }
    const results = await run(pass);
    if (pass === "discover") {
      seeds = results;
      for (const sketch of sketches) {
        const d = results.get(`${sketch.id}-seed`)!,
          s = d.sketch!;
        const label = (kind: string, id: string) => {
          const matches = d.references.filter(
            (r) =>
              r.target.kind === kind && Object.values(r.target).includes(id),
          );
          if (matches.length !== 1)
            throw new Error(`Expected unique ${kind} label for ${id}`);
          return matches[0].label;
        };
        const ds: Dimension[] = [];
        // Horizontal/vertical primitive constraints already equate coordinates.
        // Dimension each connected coordinate class once, avoiding redundancy.
        for (const axis of [0, 1]) {
          const parent = new Map<string, string>(
            s.points.map((p) => [p.pointId, p.pointId]),
          );
          const root = (id: string): string =>
            parent.get(id) === id ? id : root(parent.get(id)!);
          for (const e of s.entities.filter((e) => e.kind === "lineSegment")) {
            const [a, b] = e.pointIds.map(
              (id) => s.points.find((p) => p.pointId === id)!,
            );
            const hasConstraint = s.constraints.some(
              (c) =>
                c.kind === (axis === 0 ? "vertical" : "horizontal") &&
                c.label.includes(label("sketchEntity", e.entityId)),
            );
            if (hasConstraint && a.position[axis] === b.position[axis])
              parent.set(root(a.pointId), root(b.pointId));
          }
          const seen = new Set<string>();
          for (const p of s.points) {
            // Polygon vertices belong to its regularity owner; its construction
            // circle's center and radius are the correct independent drivers.
            const shape = sketch.shapes.find((shape) =>
              [...shape.coordinates.keys()].some((key) => {
                const xy = JSON.parse(key) as Point;
                return xy.every((v, i) => Math.abs(v - p.position[i]) < 1e-7);
              }),
            );
            if (!shape || seen.has(root(p.pointId))) continue;
            seen.add(root(p.pointId));
            const entry = [...shape.coordinates].find(([key]) =>
              (JSON.parse(key) as Point).every(
                (v, i) => Math.abs(v - p.position[i]) < 1e-7,
              ),
            )!;
            const expression = (JSON.parse(entry[1]) as [string, string])[axis];
            if (Math.abs(p.position[axis]) < 1e-8)
              throw new Error(
                "Use a datum coincidence for zero coordinates, not a zero dimension",
              );
            ds.push({
              tool: axis === 0 ? "dimensionHorizontal" : "dimensionVertical",
              labels: [label("sketchPoint", p.pointId), "Sketch origin"],
              value: Math.abs(p.position[axis]),
              expression: `abs(${expression})`,
            });
          }
        }
        for (const e of s.entities.filter((e) => e.kind === "circle")) {
          const p = s.points.find((p) => p.pointId === e.pointIds[0])!;
          const shape = sketch.shapes.find(
            (shape) =>
              shape.radius &&
              [...shape.coordinates.keys()].some((key) =>
                (JSON.parse(key) as Point).every(
                  (v, i) => Math.abs(v - p.position[i]) < 1e-7,
                ),
              ),
          )!;
          ds.push({
            tool: "dimensionRadius",
            labels: [label("sketchEntity", e.entityId)],
            value: e.radius!,
            expression: shape.radius!,
          });
        }
        dimensions.set(sketch.id, ds);
      }
    } else if (pass === "dimensions") numeric = results;
    else {
      for (const sketch of sketches)
        console.log(
          sketch.name,
          results.get(`${sketch.id}-solved`)!.sketch!.solveStatus,
        );
    }
  }
  const parts = [
    {
      file: "enclosure-shell.stl",
      label: "Graphite enclosure shell",
      finish: "graphite",
      explode: [0, 0, 0],
    },
    {
      file: "enclosure-lid.stl",
      label: "Gold lid",
      finish: "gold",
      explode: [0, 0, 25],
    },
    ...corners.map((_, i) => ({
      file: `enclosure-screw-${i + 1}.stl`,
      label: `Black socket-head screw ${i + 1}`,
      finish: "black",
      explode: [0, 0, 40],
    })),
  ];
  ops = [];
  current = "";
  command("reopen", "document.open", { path: `${dir}/enclosure.cadara` });
  command("inspect", "document.inspect");
  for (const [i, part] of parts.entries())
    command(`export-${i}`, "export.stl", {
      target: ref(current, part.label),
      path: `${dir}/${part.file}`,
      options: {
        meshAccuracy: { chordTolerance: 0.05, angleToleranceRadians: 0.1 },
        encoding: "binary",
      },
    });
  const reopened = await run("reopen-exports");
  const d = reopened.get("inspect")!;
  if (
    d.model!.bodies.length !== 6 ||
    d.model!.bodies.some((b) => !b.bounds || !b.topology?.length)
  )
    throw new Error("Expected six exact native bodies");
  console.log(
    JSON.stringify(
      d.model!.bodies.map((b) => ({
        label: d.references.find(
          (r) => r.target.kind === "body" && r.target.bodyId === b.bodyId,
        )?.label,
        bounds: b.bounds,
        faces: b.topology!.filter((t) => t.entityClass === "face").length,
      })),
      null,
      2,
    ),
  );
  await writeFile(
    `${dir}/enclosure.model.json`,
    JSON.stringify(
      { name: "VENT / 100", dimensions: "100 × 70 × 32 mm", parts },
      null,
      2,
    ) + "\n",
  );
});
