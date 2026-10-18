import { describe, expect, it } from "vitest";
import type {
  SemanticCommand,
  SemanticDiscovery,
  SemanticRequirementTarget,
} from "@/contracts/semantic/schema";
import type { DurableRef } from "@/contracts/shared/references";
import type { SelectableCommand } from "./target-inputs";
import { SelectionError } from "./selection-error";
import { resolveSemanticCommand } from "./target-resolution";

const sketch = { kind: "sketch", sketchId: "sketch_test" } as const;
const point = {
  kind: "sketchPoint",
  sketchId: "sketch_test",
  pointId: "sketch_point_test",
} as const;
const entity = {
  kind: "sketchEntity",
  sketchId: "sketch_test",
  entityId: "sketch_entity_test",
} as const;
const region = {
  kind: "region",
  sketchId: "sketch_test",
  regionId: "region_test",
} as const;
const dimension = {
  kind: "dimension",
  sketchId: "sketch_test",
  dimensionId: "dimension_test",
} as const;
const image = {
  kind: "sketchOperation",
  sketchId: "sketch_test",
  operationId: "sketch_operation_test",
} as const;
const body = { kind: "body", bodyId: "body_test" } as const;
const face = {
  kind: "face",
  bodyId: "body_test",
  faceId: "face_test",
} as const;
const edge = {
  kind: "edge",
  bodyId: "body_test",
  edgeId: "edge_test",
} as const;
const feature = { kind: "feature", featureId: "feature_test" } as const;
const construction = {
  kind: "construction",
  constructionId: "construction_test",
} as const;
const datum = {
  kind: "sketchDatumReference",
  sketchId: "sketch_test",
  datumId: "xAxis",
  geometryKind: "lineSegment",
} as const;
const projected = {
  kind: "projectedReferenceGeometry",
  referenceId: "ref_test",
  geometryId: "projected_geometry_test",
  geometryKind: "lineSegment",
} as const;
const discovery: SemanticDiscovery = {
  state: {
    documentId: "doc_test",
    revisionId: "rev_test",
    repositoryHeads: ["head_test"],
    editingContext: { kind: "sketch", sketchId: "sketch_test" },
    draft: { commandSessionId: "command_test", generation: 1 },
  },
  references: [],
  history: null,
  sketch: {
    sketchId: "sketch_test",
    plane: "xy",
    solveStatus: { solveState: "solved", constraintState: "underConstrained" },
    validity: { state: "current", diagnostics: [] },
    points: [],
    entities: [],
    derivations: [],
    mirrors: [],
    offsets: [],
    operands: [],
    constraints: [],
    requirements: [],
    measurements: [],
    profiles: [],
  },
  exportProviders: [
    {
      format: "svg",
      label: "SVG",
      extension: "svg",
      mimeType: "image/svg+xml",
      targetKinds: ["sketch", "region"],
      defaultOptions: {},
    },
  ],
};
const common = {
  version: 1,
  commandId: "select",
  basis: discovery.state,
  intent: "fulfill",
} as const;
const draft = { ...common, draft: discovery.state.draft! };
const literal = <const T>(value: T) => ({ source: "literal" as const, value });
const extrude = {
  resultBodyType: "solid",
  profiles: [region],
  startExtent: { kind: "profilePlane" },
  extent: {
    mode: "oneSide",
    end: { kind: "blind", direction: "positive", distance: literal(5) },
  },
  operation: literal("join"),
  booleanScope: { kind: "targetBody", bodyId: body.bodyId },
} as const;

/** Each row names a distinct command selection path, with a canonical expected command. */
interface SelectionCase {
  name: string;
  command: SemanticCommand;
  path: string;
  target: DurableRef | SemanticRequirementTarget;
}
const cases: SelectionCase[] = [
  {
    name: "dimension points",
    command: {
      ...draft,
      operation: "sketch.dimension.add",
      axis: "horizontal",
      mode: "driving",
      value: 5,
      points: [point.pointId, point.pointId],
    },
    path: "points.0",
    target: point,
  },
  {
    name: "feature ID",
    command: {
      ...common,
      operation: "feature.delete",
      featureId: feature.featureId,
    },
    path: "featureId",
    target: feature,
  },
  {
    name: "feature reorder anchor",
    command: {
      ...common,
      operation: "feature.reorder",
      featureId: "feature_other",
      beforeFeatureId: feature.featureId,
    },
    path: "beforeFeatureId",
    target: feature,
  },
  {
    name: "replay source",
    command: {
      ...common,
      operation: "featureReplay.create",
      parameters: {
        sourceFeatureIds: [feature.featureId],
        transform: { kind: "mirror", plane: construction },
      },
    },
    path: "parameters.sourceFeatureIds.0",
    target: feature,
  },
  {
    name: "replay mirror plane",
    command: {
      ...common,
      operation: "featureReplay.create",
      parameters: {
        sourceFeatureIds: [feature.featureId],
        transform: { kind: "mirror", plane: construction },
      },
    },
    path: "parameters.transform.plane",
    target: construction,
  },
  {
    name: "replay direction",
    command: {
      ...common,
      operation: "featureReplay.create",
      parameters: {
        sourceFeatureIds: [feature.featureId],
        transform: {
          kind: "linear",
          direction: construction,
          instanceCount: literal(2),
          spacing: literal(5),
          oppositeDirection: literal(false),
        },
      },
    },
    path: "parameters.transform.direction",
    target: construction,
  },
  {
    name: "body ID",
    command: {
      ...common,
      operation: "body.rename",
      bodyId: body.bodyId,
      label: "Renamed",
    },
    path: "bodyId",
    target: body,
  },
  {
    name: "timeline cursor",
    command: { ...common, operation: "timeline.cursor.set", cursor: sketch },
    path: "cursor",
    target: sketch,
  },
  {
    name: "timeline item",
    command: {
      ...common,
      operation: "timeline.reorder",
      item: feature,
      beforeItem: null,
    },
    path: "item",
    target: feature,
  },
  {
    name: "timeline anchor",
    command: {
      ...common,
      operation: "timeline.reorder",
      item: feature,
      beforeItem: sketch,
    },
    path: "beforeItem",
    target: sketch,
  },
  {
    name: "deletion",
    command: { ...common, operation: "target.delete", target: face },
    path: "target",
    target: face,
  },
  {
    name: "mirror datum axis",
    command: {
      ...draft,
      operation: "sketch.mirror.create",
      targets: [entity],
      axis: datum,
    },
    path: "axis",
    target: datum,
  },
  {
    name: "mirror repair axis",
    command: {
      ...draft,
      operation: "sketch.mirror.repair",
      derivationId: "mirror_test",
      repair: { kind: "axis", target: entity },
    },
    path: "repair.target",
    target: entity,
  },
  {
    name: "mirror repair original",
    command: {
      ...draft,
      operation: "sketch.mirror.repair",
      derivationId: "mirror_test",
      repair: { kind: "original", target: entity, output: entity },
    },
    path: "repair.target",
    target: entity,
  },
  {
    name: "mirror repair output",
    command: {
      ...draft,
      operation: "sketch.mirror.repair",
      derivationId: "mirror_test",
      repair: { kind: "original", target: entity, output: entity },
    },
    path: "repair.output",
    target: entity,
  },
  {
    name: "requirement operand",
    command: {
      ...draft,
      operation: "sketch.requirement.add",
      tool: "constraintHorizontal",
      mode: "driving",
      value: null,
      targets: [projected],
    },
    path: "targets.0",
    target: projected,
  },
  {
    name: "requirement geometry",
    command: {
      ...draft,
      operation: "sketch.requirement.add",
      tool: "constraintFix",
      mode: "driving",
      value: null,
      targets: [point],
    },
    path: "targets.0",
    target: point,
  },
  {
    name: "requirement removal",
    command: {
      ...draft,
      operation: "sketch.requirement.remove",
      targets: [dimension],
    },
    path: "targets.0",
    target: dimension,
  },
  {
    name: "tangent arc source",
    command: {
      ...draft,
      operation: "sketch.author",
      primitive: {
        kind: "tangentArc",
        source: entity,
        start: [0, 0],
        direction: [1, 0],
        end: [5, 5],
      },
      construction: false,
    },
    path: "primitive.source",
    target: entity,
  },
  {
    name: "sketch support",
    command: { ...common, operation: "sketch.begin", support: face },
    path: "support",
    target: face,
  },
  {
    name: "external reference",
    command: { ...draft, operation: "sketch.reference.add", target: face },
    path: "target",
    target: face,
  },
  {
    name: "image operation",
    command: { ...draft, operation: "sketch.image.remove", target: image },
    path: "target",
    target: image,
  },
  {
    name: "construction geometry",
    command: {
      ...draft,
      operation: "sketch.construction.set",
      target: point,
      construction: true,
    },
    path: "target",
    target: point,
  },
  {
    name: "label target",
    command: {
      ...draft,
      operation: "sketch.label.set",
      target: dimension,
      label: "Renamed",
    },
    path: "target",
    target: dimension,
  },
  {
    name: "geometry build",
    command: {
      ...draft,
      operation: "sketch.geometry.build",
      kind: "fillet",
      targets: [entity],
      radius: 2,
    },
    path: "targets.0",
    target: entity,
  },
  {
    name: "derivation geometry",
    command: {
      ...draft,
      operation: "sketch.derivation.create",
      kind: "transform",
      targets: [entity],
      value: 5,
    },
    path: "targets.0",
    target: entity,
  },
  {
    name: "mirror geometry",
    command: {
      ...draft,
      operation: "sketch.mirror.create",
      axis: datum,
      targets: [entity],
    },
    path: "targets.0",
    target: entity,
  },
  {
    name: "offset geometry",
    command: {
      ...draft,
      operation: "sketch.offset.create",
      targets: [entity],
      distance: 2,
      side: "left",
    },
    path: "targets.0",
    target: entity,
  },
  {
    name: "style geometry",
    command: {
      ...draft,
      operation: "sketch.style.patch",
      targets: [region],
      patch: { field: "strokeWidth", value: 2 },
    },
    path: "targets.0",
    target: region,
  },
  {
    name: "geometry deletion",
    command: {
      ...draft,
      operation: "sketch.geometry.delete",
      targets: [point],
    },
    path: "targets.0",
    target: point,
  },
  {
    name: "point edit",
    command: {
      ...draft,
      operation: "sketch.geometry.update",
      edit: { kind: "point", target: point, position: [2, 3] },
    },
    path: "edit.target",
    target: point,
  },
  {
    name: "entity edit",
    command: {
      ...draft,
      operation: "sketch.geometry.update",
      edit: { kind: "translate", target: entity, delta: [2, 3] },
    },
    path: "edit.target",
    target: entity,
  },
  {
    name: "edit boundary",
    command: {
      ...draft,
      operation: "sketch.geometry.update",
      edit: { kind: "extend", target: entity, boundary: entity },
    },
    path: "edit.boundary",
    target: entity,
  },
  {
    name: "merge destination",
    command: {
      ...draft,
      operation: "sketch.geometry.update",
      edit: { kind: "mergePoints", target: point, destination: point },
    },
    path: "edit.destination",
    target: point,
  },
  {
    name: "export",
    command: {
      version: 1,
      commandId: "export",
      basis: discovery.state,
      operation: "export.svg",
      target: region,
      path: "part.svg",
      options: {},
    },
    path: "target",
    target: region,
  },
  {
    name: "solid profile",
    command: { ...common, operation: "extrude.create", parameters: extrude },
    path: "parameters.profiles.0",
    target: region,
  },
  {
    name: "surface profile",
    command: {
      ...common,
      operation: "extrude.create",
      parameters: {
        resultBodyType: "surface",
        profiles: [entity],
        startExtent: extrude.startExtent,
        extent: extrude.extent,
      },
    },
    path: "parameters.profiles.0",
    target: entity,
  },
  {
    name: "boolean body",
    command: { ...common, operation: "extrude.create", parameters: extrude },
    path: "parameters.booleanScope.bodyId",
    target: body,
  },
  {
    name: "fillet edge",
    command: {
      ...common,
      operation: "fillet.create",
      parameters: { edgeTargets: [edge], radius: literal(2) },
    },
    path: "parameters.edgeTargets.0",
    target: edge,
  },
  {
    name: "chamfer edge",
    command: {
      ...common,
      operation: "chamfer.create",
      parameters: {
        participants: [{ role: "edge", targets: [edge] }],
        options: { distance: 2 },
      },
    },
    path: "parameters.participants.0.targets.0",
    target: edge,
  },
  {
    name: "shell body",
    command: {
      ...common,
      operation: "shell.create",
      parameters: {
        bodyTarget: body,
        faceTargets: [face],
        thickness: literal(2),
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
    },
    path: "parameters.bodyTarget",
    target: body,
  },
  {
    name: "shell face",
    command: {
      ...common,
      operation: "shell.create",
      parameters: {
        bodyTarget: body,
        faceTargets: [face],
        thickness: literal(2),
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
    },
    path: "parameters.faceTargets.0",
    target: face,
  },
  {
    name: "thicken source",
    command: {
      ...common,
      operation: "thicken.create",
      parameters: {
        participants: [{ role: "face", targets: [face] }],
        options: {
          thickness: literal(2),
          side: literal("oneSide"),
          direction: "positive",
        },
      },
    },
    path: "parameters.participants.0.targets.0",
    target: face,
  },
  {
    name: "thicken scope",
    command: {
      ...common,
      operation: "thicken.create",
      parameters: {
        participants: [
          { role: "face", targets: [face] },
          { role: "targetBody", targets: [body] },
        ],
        options: {
          thickness: literal(2),
          side: literal("oneSide"),
          direction: "positive",
        },
      },
    },
    path: "parameters.participants.1.targets.0",
    target: body,
  },
  {
    name: "combine body",
    command: {
      ...common,
      operation: "combine.create",
      parameters: {
        participants: [{ role: "targetBody", targets: [body] }],
        operationIntent: literal("add"),
      },
    },
    path: "parameters.participants.0.targets.0",
    target: body,
  },
  {
    name: "split body",
    command: {
      ...common,
      operation: "split.create",
      parameters: { participants: [{ role: "toolBody", targets: [body] }] },
    },
    path: "parameters.participants.0.targets.0",
    target: body,
  },
  {
    name: "delete solid body",
    command: {
      ...common,
      operation: "deleteSolid.create",
      parameters: { participants: [{ role: "body", targets: [body] }] },
    },
    path: "parameters.participants.0.targets.0",
    target: body,
  },
  {
    name: "mirror body",
    command: {
      ...common,
      operation: "mirror.create",
      parameters: {
        participants: [{ role: "body", targets: [body] }],
        options: { copy: true },
      },
    },
    path: "parameters.participants.0.targets.0",
    target: body,
  },
  {
    name: "mirror plane",
    command: {
      ...common,
      operation: "mirror.create",
      parameters: {
        participants: [{ role: "plane", targets: [face] }],
        options: { copy: true },
      },
    },
    path: "parameters.participants.0.targets.0",
    target: face,
  },
  {
    name: "transform reference",
    command: {
      ...common,
      operation: "transform.create",
      parameters: {
        participants: [{ role: "transformReference", targets: [construction] }],
        options: { distance: 2 },
      },
    },
    path: "parameters.participants.0.targets.0",
    target: construction,
  },
  {
    name: "linear direction",
    command: {
      ...common,
      operation: "linearPattern.create",
      parameters: {
        participants: [{ role: "direction", targets: [edge] }],
        options: { instanceCount: 2, spacing: 5, oppositeDirection: false },
      },
    },
    path: "parameters.participants.0.targets.0",
    target: edge,
  },
  {
    name: "circular axis",
    command: {
      ...common,
      operation: "circularPattern.create",
      parameters: {
        participants: [{ role: "axis", targets: [construction] }],
        options: {
          instanceCount: 2,
          angleDegrees: 180,
          equalSpace: true,
          oppositeDirection: false,
        },
      },
    },
    path: "parameters.participants.0.targets.0",
    target: construction,
  },
  {
    name: "loft profile",
    command: {
      ...common,
      operation: "loft.create",
      parameters: { participants: [{ role: "profile", targets: [region] }] },
    },
    path: "parameters.participants.0.targets.0",
    target: region,
  },
  {
    name: "loft path",
    command: {
      ...common,
      operation: "loft.create",
      parameters: { participants: [{ role: "path", targets: [edge] }] },
    },
    path: "parameters.participants.0.targets.0",
    target: edge,
  },
  ...(
    [
      "profile",
      "path",
      "guideCurve",
      "lockProfileFace",
      "lockProfileDirection",
      "targetBody",
    ] as const
  ).map((role) => {
    const target =
      role === "profile"
        ? region
        : role === "lockProfileFace"
          ? face
          : role === "targetBody"
            ? body
            : edge;
    return {
      name: `sweep ${role}`,
      command: {
        ...common,
        operation: "sweep.create",
        parameters: {
          participants: [{ role, targets: [target] }],
          options: {
            profileControl: "none",
            twist: { type: "none" },
            endScale: 1,
          },
        },
      } as SemanticCommand,
      path: "parameters.participants.0.targets.0",
      target,
    };
  }),
  {
    name: "hole location",
    command: {
      ...common,
      operation: "hole.create",
      parameters: {
        participants: [
          { role: "location", targets: [point] },
          { role: "body", targets: [body] },
        ],
        options: { mainDiameter: 2, termination: "throughAll" },
      },
    },
    path: "parameters.participants.0.targets.0",
    target: point,
  },
  {
    name: "hole body",
    command: {
      ...common,
      operation: "hole.create",
      parameters: {
        participants: [
          { role: "location", targets: [point] },
          { role: "body", targets: [body] },
        ],
        options: { mainDiameter: 2, termination: "throughAll" },
      },
    },
    path: "parameters.participants.1.targets.0",
    target: body,
  },
  {
    name: "coplanar reference",
    command: {
      ...common,
      operation: "plane.create",
      parameters: { mode: "coplanar", reference: { target: face } },
    },
    path: "parameters.reference.target",
    target: face,
  },
  {
    name: "revolve axis",
    command: {
      ...common,
      operation: "revolve.create",
      parameters: {
        resultBodyType: "solid",
        profiles: [region],
        axis: entity,
        startAngle: literal(0),
        extent: { mode: "oneSide", end: { kind: "full" } },
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
    },
    path: "parameters.axis",
    target: entity,
  },
  {
    name: "legacy profile",
    command: {
      ...common,
      operation: "extrude.create",
      profile: region,
      depth: 5,
    },
    path: "profile",
    target: region,
  },
  {
    name: "sketch ID",
    command: { ...common, operation: "sketch.open", sketchId: sketch.sketchId },
    path: "sketchId",
    target: sketch,
  },
  {
    name: "reassigned support",
    command: {
      ...common,
      operation: "sketch.support.reassign",
      sketchId: sketch.sketchId,
      support: construction,
    },
    path: "support",
    target: construction,
  },
];

function atPath(
  command: SemanticCommand,
  path: string,
  value: unknown,
): SelectableCommand {
  const copy = structuredClone(command);
  const keys = path.split(".");
  let parent = copy as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    parent = parent[key] as Record<string, unknown>;
  parent[keys.at(-1)!] = value;
  return copy as SelectableCommand;
}
function withTarget(
  target: SelectionCase["target"],
  label = "Chosen",
): SemanticDiscovery {
  if (
    target.kind === "sketchDatumReference" ||
    target.kind === "projectedReferenceGeometry"
  )
    return {
      ...discovery,
      sketch: { ...discovery.sketch!, operands: [{ label, target }] },
    };
  return {
    ...discovery,
    references: [
      { label, target, owner: "sketchId" in target ? sketch : null },
    ],
  };
}
function selectionFailure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (!(error instanceof SelectionError)) throw error;
    return error.selection;
  }
  throw new Error("Expected selection failure before execution");
}

const vertex = { kind: "vertex", bodyId: "body_test", vertexId: "vertex_test" } as const;
const revolveParameters = {
  resultBodyType: "solid", profiles: [region], axis: entity, startAngle: literal(0),
  extent: { mode: "oneSide", end: { kind: "full" } }, operation: literal("newBody"), booleanScope: { kind: "standalone" },
} as const;
for (const operation of ["extrude.create", "revolve.create"] as const) {
  const parameters = operation === "extrude.create" ? extrude : revolveParameters;
  cases.push({ name: `${operation} exact body list`, command: { ...common, operation, parameters: { ...parameters, booleanScope: { kind: "targetBodies", bodyIds: [body.bodyId] } } } as SemanticCommand, path: "parameters.booleanScope.bodyIds.0", target: body });
  for (const location of ["end", "firstEnd", "secondEnd"] as const) {
    const ends = operation === "extrude.create" ? [["upToFace", face], ["upToPart", body], ["upToVertex", vertex], ["upToVertex", point]] as const : [["upToFace", face], ["upToPart", body], ["upToVertex", vertex]] as const;
    for (const [kind, target] of ends) {
      const end = { kind, target, direction: operation === "extrude.create" ? "positive" : "clockwise" };
      const extent = location === "end" ? { mode: "oneSide", end } : { mode: "twoSide", firstEnd: end, secondEnd: end };
      cases.push({ name: `${operation} ${location} ${kind} ${target.kind}`, command: { ...common, operation, parameters: { ...parameters, extent } } as SemanticCommand, path: `parameters.extent.${location}.target`, target });
    }
  }
}
for (const [kind, target] of [["sketchPointOffset", point], ["entityOffset", edge], ["entityOffset", face]] as const) {
  cases.push({ name: `extrude start ${kind} ${target.kind}`, command: { ...common, operation: "extrude.create", parameters: { ...extrude, startExtent: { kind, target } } } as SemanticCommand, path: "parameters.startExtent.target", target });
}

describe.each(cases)("$name", ({ command, path, target }) => {
  it("resolves a unique label from current discovery without mutating input", () => {
    const selector = { label: "Chosen" };
    const input = atPath(command, path, selector);
    const before = structuredClone(input);
    expect(
      resolveSemanticCommand(input, { discovery: withTarget(target) }),
    ).toEqual(command);
    expect(input).toEqual(before);
  });
  it("reports missing selectors and the eligible available target", () => {
    const selector = { label: "Missing" };
    const failure = selectionFailure(() =>
      resolveSemanticCommand(atPath(command, path, selector), {
        discovery: withTarget(target),
      }),
    );
    expect(failure).toMatchObject({
      code: "selection-unresolved",
      selector,
      candidates: [],
      available: [{ label: "Chosen", target }],
      availableCount: 1,
    });
    expect(failure.selector).toBe(selector);
  });
  it("retains every ambiguous candidate instead of picking the first", () => {
    const supplied = withTarget(target);
    const other =
      target.kind === "sketchDatumReference"
        ? { ...target, datumId: "yAxis" as const }
        : ({
            ...target,
            ...Object.fromEntries(
              Object.entries(target)
                .filter(([key]) => key.endsWith("Id"))
                .map(([key, value]) => [key, `${value}_other`]),
            ),
          } as SelectionCase["target"]);
    const second = withTarget(other);
    const duplicate = {
      ...supplied,
      references: [...supplied.references, ...second.references],
      ...(supplied.sketch
        ? {
            sketch: {
              ...supplied.sketch,
              operands: [
                ...supplied.sketch.operands,
                ...second.sketch!.operands,
              ],
            },
          }
        : {}),
    };
    const selector = { alias: "snapshot", label: "Chosen" };
    const failure = selectionFailure(() =>
      resolveSemanticCommand(atPath(command, path, selector), {
        aliases: new Map([["snapshot", duplicate]]),
      }),
    );
    expect(failure).toMatchObject({
      code: "selection-ambiguous",
      selector,
      candidates: [
        { label: "Chosen", target },
        { label: "Chosen", target: other },
      ],
    });
    expect(failure.available).toBeUndefined();
  });
  it("passes canonical typed inputs through without consulting discovery", () => {
    expect(resolveSemanticCommand(command, {})).toEqual(command);
    if (
      typeof target === "object" &&
      [
        "bodyId",
        "featureId",
        "beforeFeatureId",
        "sketchId",
        "points.0",
        "parameters.booleanScope.bodyId",
        "parameters.booleanScope.bodyIds.0",
        "parameters.sourceFeatureIds.0",
      ].includes(path)
    ) {
      const typed = atPath(command, path, target);
      expect(resolveSemanticCommand(typed, {})).toEqual(typed);
    }
  });
  it("honors sketch owner qualification, including rejecting non-sketch-owned targets", () => {
    const supplied = withTarget(target);
    const selector = { alias: "snapshot", label: "Chosen", sketch: "owner" };
    const input = atPath(command, path, selector);
    const context = {
      aliases: new Map([
        ["snapshot", supplied],
        ["owner", discovery],
      ]),
    };
    if ("sketchId" in target || target.kind === "projectedReferenceGeometry") {
      expect(resolveSemanticCommand(input, context)).toEqual(command);
      const foreignOwner: SemanticDiscovery = {
        ...discovery,
        sketch: { ...discovery.sketch!, sketchId: "sketch_foreign" },
      };
      expect(
        selectionFailure(() =>
          resolveSemanticCommand(input, {
            aliases: new Map([
              ["snapshot", supplied],
              ["owner", foreignOwner],
            ]),
          }),
        ).code,
      ).toBe("selection-unresolved");
    } else
      expect(
        selectionFailure(() => resolveSemanticCommand(input, context)).code,
      ).toBe("selection-unresolved");
  });
});

const recordDiscovery: SemanticDiscovery = {
  ...discovery,
  variables: [{ variableId: "variable_test", name: "Chosen", valueText: "5" }],
  sketch: {
    ...discovery.sketch!,
    requirements: [
      {
        dimensionId: "dimension_test",
        label: "Chosen",
        mode: "driving",
        kind: "distance",
        value: 5,
        measuredValue: 5,
      },
    ],
    measurements: [
      {
        dimensionId: "dimension_measurement",
        label: "Measured",
        mode: "reference",
        kind: "distance",
        measuredValue: 5,
      },
    ],
    mirrors: [
      {
        derivationId: "mirror_test",
        label: "Chosen",
        seedEntityIds: [],
        outputEntityIds: [],
        axis: { kind: "sketchDatum", datum: "xAxis" },
        brokenReason: null,
        copyCount: 1,
        requirementCount: 0,
        sizingRequirementCount: 0,
        brokenDownstreamLabels: [],
        currentGeometry: [],
      },
    ],
    offsets: [
      {
        derivationId: "offset_test",
        label: "Chosen",
        seedEntityIds: [],
        outputEntityIds: [],
        distance: literal(2),
        currentGeometry: [],
        health: { kind: "healthy" },
      },
    ],
  },
};
const recordCases: {
  name: string;
  command: SemanticCommand;
  path: string;
  kind: string;
  target: string;
}[] = [
  {
    name: "variable",
    command: {
      ...common,
      operation: "variable.update",
      variableId: "variable_test",
      name: "Chosen",
      valueText: "10",
    },
    path: "variableId",
    kind: "variable",
    target: "variable_test",
  },
  {
    name: "dimension update",
    command: {
      ...draft,
      operation: "sketch.dimension.update",
      dimensionId: "dimension_test",
      value: 10,
    },
    path: "dimensionId",
    kind: "dimension",
    target: "dimension_test",
  },
  {
    name: "dimension reference",
    command: {
      ...draft,
      operation: "sketch.dimension.reference",
      dimensionId: "dimension_test",
    },
    path: "dimensionId",
    kind: "dimension",
    target: "dimension_test",
  },
  {
    name: "mirror removal",
    command: {
      ...draft,
      operation: "sketch.mirror.remove",
      derivationId: "mirror_test",
    },
    path: "derivationId",
    kind: "mirror",
    target: "mirror_test",
  },
  {
    name: "mirror repair",
    command: {
      ...draft,
      operation: "sketch.mirror.repair",
      derivationId: "mirror_test",
      repair: { kind: "axis", target: datum },
    },
    path: "derivationId",
    kind: "mirror",
    target: "mirror_test",
  },
  {
    name: "offset removal",
    command: {
      ...draft,
      operation: "sketch.offset.remove",
      derivationId: "offset_test",
    },
    path: "derivationId",
    kind: "offset",
    target: "offset_test",
  },
];

describe.each(recordCases)(
  "$name labelled record",
  ({ command, path, kind, target }) => {
    it("resolves records, while canonical IDs pass through unchanged", () => {
      expect(
        resolveSemanticCommand(atPath(command, path, { label: "Chosen" }), {
          discovery: recordDiscovery,
        }),
      ).toEqual(command);
      expect(resolveSemanticCommand(command, {})).toEqual(command);
    });
    it("reports eligible records when the label is missing", () => {
      const failure = selectionFailure(() =>
        resolveSemanticCommand(atPath(command, path, { label: "Missing" }), {
          discovery: recordDiscovery,
        }),
      );
      expect(failure).toMatchObject({
        code: "selection-unresolved",
        eligibleKinds: [kind],
        candidates: [],
        available: expect.arrayContaining([
          { label: "Chosen", target, owner: null },
        ]),
      });
    });
    it("retains ambiguous records as candidates", () => {
      const supplied = {
        ...recordDiscovery,
        variables: [
          ...recordDiscovery.variables!,
          {
            ...recordDiscovery.variables![0]!,
            variableId: "variable_test_other" as const,
          },
        ],
        sketch: {
          ...recordDiscovery.sketch!,
          requirements: [
            ...recordDiscovery.sketch!.requirements,
            {
              ...recordDiscovery.sketch!.requirements[0]!,
              dimensionId: "dimension_test_other" as const,
            },
          ],
          mirrors: [
            ...recordDiscovery.sketch!.mirrors,
            {
              ...recordDiscovery.sketch!.mirrors[0]!,
              derivationId: "mirror_test_other",
            },
          ],
          offsets: [
            ...recordDiscovery.sketch!.offsets,
            {
              ...recordDiscovery.sketch!.offsets[0]!,
              derivationId: "offset_test_other",
            },
          ],
        },
      };
      expect(
        selectionFailure(() =>
          resolveSemanticCommand(atPath(command, path, { label: "Chosen" }), {
            discovery: supplied,
          }),
        ),
      ).toMatchObject({
        code: "selection-ambiguous",
        eligibleKinds: [kind],
        candidates: [
          { label: "Chosen", target },
          { label: "Chosen", target: `${target}_other` },
        ],
      });
    });
    it("scopes draft records to their sketch and never treats variables as sketch-owned", () => {
      const input = atPath(command, path, {
        alias: "snapshot",
        sketch: "owner",
        label: "Chosen",
      });
      const context = {
        aliases: new Map([
          ["snapshot", recordDiscovery],
          ["owner", discovery],
        ]),
      };
      if (kind === "variable")
        expect(
          selectionFailure(() => resolveSemanticCommand(input, context)).code,
        ).toBe("selection-unresolved");
      else expect(resolveSemanticCommand(input, context)).toEqual(command);
      const foreignOwner: SemanticDiscovery = {
        ...discovery,
        sketch: { ...discovery.sketch!, sketchId: "sketch_foreign" },
      };
      expect(
        selectionFailure(() =>
          resolveSemanticCommand(input, {
            aliases: new Map([
              ["snapshot", recordDiscovery],
              ["owner", foreignOwner],
            ]),
          }),
        ).code,
      ).toBe("selection-unresolved");
    });
  },
);

it("resolves basis and private draft certificates from historical aliases, not live discovery", () => {
  const input: SelectableCommand = {
    version: 1,
    commandId: "inspect",
    operation: "sketch.inspect",
    basis: { alias: "then" },
    draft: { alias: "then" },
  };
  const current: SemanticDiscovery = {
    ...discovery,
    state: {
      ...discovery.state,
      revisionId: "rev_now",
      draft: { commandSessionId: "command_now", generation: 8 },
    },
  };
  const aliases = new Map([["then", discovery]]);
  expect(
    resolveSemanticCommand(input, { discovery: current, aliases }),
  ).toEqual({
    ...input,
    basis: {
      documentId: "doc_test",
      revisionId: "rev_test",
      repositoryHeads: ["head_test"],
    },
    draft: { commandSessionId: "command_test", generation: 1 },
  });
  expect(aliases.get("then")).toBe(discovery);
  expect(input.basis).toEqual({ alias: "then" });
});

it.each(["basis", "draft"] as const)(
  "reports a missing %s alias without inventing authority",
  (field) => {
    const command: SemanticCommand = {
      version: 1,
      commandId: "inspect",
      operation: "sketch.inspect",
      basis: discovery.state,
      draft: discovery.state.draft!,
    };
    const selector = { alias: "missing" };
    expect(
      selectionFailure(() =>
        resolveSemanticCommand(atPath(command, field, selector), {}),
      ),
    ).toMatchObject({
      code: "selection-unresolved",
      selector,
      eligibleKinds: [],
      availableCount: 0,
    });
  },
);

it("uses each call's current discovery without changing historical target snapshots", () => {
  const command: SemanticCommand = {
    ...common,
    operation: "body.rename",
    bodyId: "body_test",
    label: "Renamed",
  };
  const old = withTarget(body);
  const current = withTarget({ kind: "body", bodyId: "body_now" });
  const input = atPath(command, "bodyId", { label: "Chosen" });
  expect(resolveSemanticCommand(input, { discovery: old })).toEqual(command);
  expect(resolveSemanticCommand(input, { discovery: current })).toEqual({
    ...command,
    bodyId: "body_now",
  });
  expect(
    resolveSemanticCommand(
      atPath(command, "bodyId", { alias: "then", label: "Chosen" }),
      { discovery: current, aliases: new Map([["then", old]]) },
    ),
  ).toEqual(command);
});

it("disambiguates same labels across sketches and preserves owner evidence on ambiguity", () => {
  const otherPoint = {
    ...point,
    sketchId: "sketch_other",
    pointId: "sketch_point_other",
  } as const;
  const supplied: SemanticDiscovery = {
    ...withTarget(point),
    references: [
      { label: "Chosen", target: point, owner: sketch },
      {
        label: "Chosen",
        target: otherPoint,
        owner: { kind: "sketch", sketchId: "sketch_other" },
      },
      { label: "First sketch", target: sketch, owner: sketch },
      {
        label: "Other sketch",
        target: { kind: "sketch", sketchId: "sketch_other" },
        owner: { kind: "sketch", sketchId: "sketch_other" },
      },
    ],
  };
  const command: SemanticCommand = {
    ...draft,
    operation: "sketch.geometry.delete",
    targets: [point],
  };
  const selector = { alias: "all", label: "Chosen" };
  const aliases = new Map([
    ["all", supplied],
    ["owner", discovery],
  ]);
  expect(
    selectionFailure(() =>
      resolveSemanticCommand(atPath(command, "targets.0", selector), {
        aliases,
      }),
    ).candidates,
  ).toEqual([
    {
      label: "Chosen",
      target: point,
      owner: { kind: "sketch", sketchId: "sketch_test", label: "First sketch" },
    },
    {
      label: "Chosen",
      target: otherPoint,
      owner: {
        kind: "sketch",
        sketchId: "sketch_other",
        label: "Other sketch",
      },
    },
  ]);
  expect(
    resolveSemanticCommand(
      atPath(command, "targets.0", { ...selector, sketch: "owner" }),
      { aliases },
    ),
  ).toEqual(command);
  expect(supplied.references).toHaveLength(4);
});

it("rejects owner aliases without a sketch identity, retaining the original selector", () => {
  const command: SemanticCommand = {
    ...draft,
    operation: "sketch.geometry.delete",
    targets: [point],
  };
  const selector = { alias: "all", label: "Chosen", sketch: "missing" };
  const failure = selectionFailure(() =>
    resolveSemanticCommand(atPath(command, "targets.0", selector), {
      aliases: new Map([["all", withTarget(point)]]),
    }),
  );
  expect(failure).toMatchObject({
    code: "selection-unresolved",
    eligibleKinds: ["sketch"],
    selector,
  });
  expect(failure.selector).toBe(selector);
});

it("filters label matches by the field's kinds instead of colliding with point entities", () => {
  const command: SemanticCommand = {
    ...draft,
    operation: "sketch.dimension.add",
    points: [point.pointId, point.pointId],
    axis: "horizontal",
    mode: "driving",
    value: 5,
  };
  const supplied: SemanticDiscovery = {
    ...withTarget(point),
    references: [
      ...withTarget(point).references,
      { label: "Chosen", target: entity, owner: sketch },
    ],
  };
  expect(
    resolveSemanticCommand(atPath(command, "points.0", { label: "Chosen" }), {
      discovery: supplied,
    }),
  ).toEqual(command);
});

it("prefers format-supported exports, but lets semantic execution refuse a unique unsupported export", () => {
  const command: SemanticCommand = {
    version: 1,
    commandId: "export",
    operation: "export.svg",
    basis: discovery.state,
    target: region,
    path: "part.svg",
    options: {},
  };
  const supplied: SemanticDiscovery = {
    ...withTarget(region),
    exportProviders: [
      ...discovery.exportProviders!,
      {
        format: "stl",
        label: "STL",
        extension: "stl",
        mimeType: "model/stl",
        targetKinds: ["body"],
        defaultOptions: {},
      },
    ],
    references: [
      { label: "Chosen", target: region, owner: sketch },
      { label: "Chosen", target: body, owner: null },
      { label: "Chosen", target: feature, owner: null },
    ],
  };
  const input = atPath(command, "target", { label: "Chosen" });
  expect(resolveSemanticCommand(input, { discovery: supplied })).toEqual(
    command,
  );
  expect(
    resolveSemanticCommand(input, {
      discovery: { ...supplied, references: supplied.references.slice(1) },
    }),
  ).toEqual({ ...command, target: body });
  expect(
    selectionFailure(() =>
      resolveSemanticCommand(input, {
        discovery: { ...supplied, references: supplied.references.slice(2) },
      }),
    ).code,
  ).toBe("selection-unresolved");
});

it("bounds missing-selection suggestions without truncating the available count", () => {
  const command: SemanticCommand = {
    ...common,
    operation: "body.rename",
    bodyId: "body_test",
    label: "Renamed",
  };
  const supplied: SemanticDiscovery = {
    ...discovery,
    references: Array.from({ length: 60 }, (_, i) => ({
      label: `Body ${i}`,
      target: { kind: "body", bodyId: `body_${i}` },
      owner: null,
    })),
  };
  const failure = selectionFailure(() =>
    resolveSemanticCommand(atPath(command, "bodyId", { label: "Missing" }), {
      discovery: supplied,
    }),
  );
  expect(failure.availableCount).toBe(60);
  expect(failure.available).toHaveLength(50);
});

it("accepts mixed label and typed point inputs in the same command", () => {
  const command: SelectableCommand = {
    ...draft,
    operation: "sketch.dimension.add",
    axis: "horizontal",
    mode: "driving",
    value: 5,
    points: [{ label: "Chosen" }, point],
  };
  expect(
    resolveSemanticCommand(command, { discovery: withTarget(point) }),
  ).toEqual({ ...command, points: ["sketch_point_test", point] });
});

describe("document inspection owners", () => {
  for (const target of [sketch, feature, body]) {
    it(`resolves typed and labelled ${target.kind} owners`, () => {
      const snapshot = { ...discovery, references: [{ label: "Owner", target, owner: null }] };
      const command = { version: 1, commandId: "owner-inspect", operation: "document.inspect", basis: common.basis } as const;
      expect(resolveSemanticCommand({ ...command, owner: target }, { discovery: snapshot })).toEqual({ ...command, owner: target });
      expect(resolveSemanticCommand({ ...command, owner: { label: "Owner" } }, { discovery: snapshot })).toEqual({ ...command, owner: target });
      expect(() => resolveSemanticCommand({ ...command, owner: { label: "Missing" } }, { discovery: snapshot })).toThrow(SelectionError);
      expect(() => resolveSemanticCommand({ ...command, owner: { label: "Owner" } }, { discovery: { ...snapshot, references: [...snapshot.references, { label: "Owner", target: { kind: "body", bodyId: "body_other" }, owner: null }] } })).toThrow(SelectionError);
    });
  }
});
