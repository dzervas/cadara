import type {
  SemanticCommand,
  SemanticDiscovery,
} from "@/contracts/semantic/schema";
import {
  isDiscoveryAlias as isAlias,
  isTargetSelector,
  type SelectableCommand,
  type TargetSelector,
} from "./target-inputs";
import { selectionError } from "./selection-error";

export interface TargetResolutionContext {
  /** Live callers supply current discovery; no history is retained by the resolver. */
  discovery?: SemanticDiscovery;
  /** Recipe adapters supply their immutable historical discovery snapshots. */
  aliases?: ReadonlyMap<string, SemanticDiscovery>;
}

/** The canonical identity used by the alias snapshot's own sketch references. */
function ownerOf(discovery: SemanticDiscovery | undefined) {
  if (!discovery) return null;
  const context = discovery.state.editingContext;
  return (
    discovery.sketch?.sketchId ??
    (context.kind === "sketch" ? context.sketchId : null)
  );
}

function scope(discovery: SemanticDiscovery, owner: string): SemanticDiscovery {
  const { sketch, ...rest } = discovery;
  return {
    ...rest,
    // Variables are document-owned, never sketch-owned.
    variables: [],
    references: discovery.references.filter(
      (r) => "sketchId" in r.target && r.target.sketchId === owner,
    ),
    // Private draft records (requirements, operands, derivations) all belong
    // to the draft's own sketch; keep them only when that is the owner.
    ...(sketch && ownerOf(discovery) === owner ? { sketch } : {}),
  };
}

/** Copy command containers while retaining selector identity for caller diagnostics. */
function copyInput<T>(value: T): T {
  if (
    !value ||
    typeof value !== "object" ||
    isAlias(value) ||
    isTargetSelector(value)
  )
    return value;
  if (Array.isArray(value)) return value.map(copyInput) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, copyInput(entry)]),
  ) as T;
}

/** Resolve all command selectors using only discovery supplied for this call. */
export function resolveSemanticCommand(
  input: SelectableCommand,
  context: TargetResolutionContext,
): SemanticCommand {
  const command = copyInput(input);
  const aliases = context.aliases ?? new Map<string, SemanticDiscovery>();
  function discoveryFor(
    selector: TargetSelector,
  ): SemanticDiscovery | undefined {
    const discovery =
      selector.alias === undefined
        ? context.discovery
        : aliases.get(selector.alias);
    if (selector.sketch === undefined) return discovery;
    const owner = ownerOf(aliases.get(selector.sketch));
    if (!owner)
      throw selectionError(
        "Sketch owner alias has no sketch identity.",
        selector,
        ["sketch"],
        [],
        undefined,
        [],
      );
    return discovery ? scope(discovery, owner) : undefined;
  }
  if (isAlias(command.basis)) {
    const state = aliases.get(command.basis.alias)?.state;
    if (!state)
      throw selectionError(
        "Alias has no completed authoritative state.",
        command.basis,
        [],
        [],
        undefined,
        [],
      );
    const { documentId, revisionId, repositoryHeads } = state;
    command.basis = { documentId, revisionId, repositoryHeads };
  }
  if ("draft" in command && isAlias(command.draft)) {
    const draft = aliases.get(command.draft.alias)?.state.draft;
    if (!draft)
      throw selectionError(
        "Alias has no current private draft.",
        command.draft,
        [],
        [],
        undefined,
        [],
      );
    command.draft = draft;
  }
  if (command.operation === "sketch.dimension.add") {
    const resolvePoint = (value: (typeof command.points)[number]) => {
      if (!isTargetSelector(value)) return value;
      const matches =
        discoveryFor(value)?.references.filter(
          (r) => r.label === value.label && r.target.kind === "sketchPoint",
        ) ?? [];
      if (matches.length !== 1 || matches[0]!.target.kind !== "sketchPoint")
        throw selectionError(
          "Point target alias is missing or ambiguous.",
          value,
          ["sketchPoint"],
          matches,
          discoveryFor(value),
        );
      return matches[0]!.target.pointId;
    };
    command.points = [
      resolvePoint(command.points[0]),
      resolvePoint(command.points[1]),
    ];
  }
  if (
    command.operation === "variable.update" &&
    isTargetSelector(command.variableId)
  ) {
    const target = command.variableId;
    const variables = (discoveryFor(target)?.variables ?? []).map(
      (variable) => ({ label: variable.name, target: variable.variableId }),
    );
    command.variableId = resolveLabelled(
      "Variable target alias is missing or ambiguous.",
      target,
      "variable",
      variables,
    );
  }
  if (
    (command.operation === "sketch.dimension.update" ||
      command.operation === "sketch.dimension.reference") &&
    isTargetSelector(command.dimensionId)
  ) {
    const target = command.dimensionId;
    const sketch = discoveryFor(target)?.sketch;
    const dimensions = [
      ...(sketch?.requirements ?? []),
      ...(sketch?.measurements ?? []),
    ].map((d) => ({ label: d.label, target: d.dimensionId }));
    command.dimensionId = resolveLabelled(
      "Dimension target alias is missing or ambiguous.",
      target,
      "dimension",
      dimensions,
    );
  }
  if (
    (command.operation === "sketch.mirror.remove" ||
      command.operation === "sketch.mirror.repair") &&
    isTargetSelector(command.derivationId)
  ) {
    const target = command.derivationId;
    const mirrors = (discoveryFor(target)?.sketch?.mirrors ?? []).map(
      (mirror) => ({ label: mirror.label, target: mirror.derivationId }),
    );
    command.derivationId = resolveLabelled(
      "Mirror target alias is missing or ambiguous.",
      target,
      "mirror",
      mirrors,
    );
  }
  if (
    command.operation === "sketch.offset.remove" &&
    isTargetSelector(command.derivationId)
  ) {
    const target = command.derivationId;
    const offsets = (discoveryFor(target)?.sketch?.offsets ?? []).map(
      (offset) => ({ label: offset.label, target: offset.derivationId }),
    );
    command.derivationId = resolveLabelled(
      "Offset target alias is missing or ambiguous.",
      target,
      "offset",
      offsets,
    );
  }
  function resolveSketchTarget(
    target:
      | import("@/contracts/shared/references").DurableRef
      | import("@/contracts/shared/references").SketchTangentHandleRef
      | TargetSelector,
    kinds: readonly string[],
  ) {
    if (!isTargetSelector(target)) return target;
    const matches =
      discoveryFor(target)?.references.filter(
        (r) => r.label === target.label && kinds.includes(r.target.kind),
      ) ?? [];
    if (matches.length !== 1)
      throw selectionError(
        "Sketch target alias is missing or ambiguous.",
        target,
        kinds,
        matches,
        discoveryFor(target),
      );
    return matches[0]!.target;
  }
  function resolveMirrorAxis(
    target:
      | import("@/contracts/shared/references").SketchDatumReferenceRef
      | Extract<
          import("@/contracts/shared/references").DurableRef,
          { kind: "sketchEntity" }
        >
      | TargetSelector,
  ) {
    if (!isTargetSelector(target)) return target;
    const discovery = discoveryFor(target);
    const kinds = ["sketchEntity", "sketchDatumReference"];
    const eligible = [
      ...(discovery?.references ?? []),
      ...(discovery?.sketch?.operands ?? []),
    ].filter((r) => kinds.includes(r.target.kind));
    const matches = eligible.filter((r) => r.label === target.label);
    const found = matches.length === 1 ? matches[0]!.target : null;
    if (
      !found ||
      (found.kind !== "sketchEntity" && found.kind !== "sketchDatumReference")
    )
      throw selectionError(
        "Mirror axis alias is missing or ambiguous.",
        target,
        kinds,
        matches,
        discovery,
        eligible,
      );
    return found;
  }
  if ("featureId" in command && isTargetSelector(command.featureId)) {
    const target = resolveSketchTarget(command.featureId, ["feature"]);
    if (target.kind !== "feature") throw new Error("Invalid feature target.");
    command.featureId = target.featureId;
  }
  if (
    command.operation === "featureReplay.create" ||
    command.operation === "featureReplay.update"
  ) {
    const sourceFeatureIds = command.parameters.sourceFeatureIds.map(
      (value) => {
        if (!isTargetSelector(value)) return value;
        const target = resolveSketchTarget(value, ["feature"]);
        if (target.kind !== "feature")
          throw new Error("Invalid replay source feature.");
        return target.featureId;
      },
    );
    const resolveConstruction = (
      value:
        | Extract<
            import("@/contracts/shared/references").DurableRef,
            { kind: "construction" }
          >
        | TargetSelector,
    ) => {
      const target = resolveSketchTarget(value, ["construction"]);
      if (target.kind !== "construction")
        throw new Error("Invalid replay construction reference.");
      return target;
    };
    const transform = command.parameters.transform;
    command.parameters = {
      ...command.parameters,
      sourceFeatureIds,
      transform:
        transform.kind === "linear"
          ? {
              ...transform,
              direction: resolveConstruction(transform.direction),
            }
          : { ...transform, plane: resolveConstruction(transform.plane) },
    };
  }
  if (
    command.operation === "feature.reorder" &&
    isTargetSelector(command.beforeFeatureId)
  ) {
    const target = resolveSketchTarget(command.beforeFeatureId, ["feature"]);
    if (target.kind !== "feature")
      throw new Error("Invalid feature reorder anchor.");
    command.beforeFeatureId = target.featureId;
  }
  if (command.operation === "body.rename" && isTargetSelector(command.bodyId)) {
    const target = resolveSketchTarget(command.bodyId, ["body"]);
    if (target.kind !== "body") throw new Error("Invalid body target.");
    command.bodyId = target.bodyId;
  }
  function resolveTimelineTarget(
    value:
      | import("@/contracts/modeling/schema").DocumentFeatureCursor
      | TargetSelector,
  ) {
    if (!isTargetSelector(value)) return value;
    const target = resolveSketchTarget(value, ["feature", "sketch"]);
    if (target.kind !== "feature" && target.kind !== "sketch")
      throw new Error("Invalid timeline target.");
    return target;
  }
  if (command.operation === "timeline.cursor.set")
    command.cursor = resolveTimelineTarget(command.cursor);
  if (command.operation === "timeline.reorder") {
    const item = resolveTimelineTarget(command.item);
    const beforeItem =
      command.beforeItem === null
        ? null
        : resolveTimelineTarget(command.beforeItem);
    if (item.kind === "empty" || beforeItem?.kind === "empty")
      throw new Error("Invalid timeline order target.");
    command.item = item;
    command.beforeItem = beforeItem;
  }
  if (command.operation === "target.delete") {
    const target = resolveSketchTarget(command.target, [
      "body",
      "feature",
      "sketch",
      "face",
      "edge",
      "vertex",
      "loop",
      "construction",
      "region",
      "sketchEntity",
      "sketchPoint",
      "dimension",
      "constraint",
      "sketchOperation",
    ]);
    if (target.kind === "sketchTangentHandle")
      throw new Error("Invalid deletion target.");
    command.target = target;
  }
  if (command.operation === "sketch.mirror.create")
    command.axis = resolveMirrorAxis(command.axis);
  if (command.operation === "sketch.mirror.repair") {
    if (command.repair.kind === "axis")
      command.repair.target = resolveMirrorAxis(command.repair.target);
    else {
      const target = resolveSketchTarget(command.repair.target, [
        "sketchEntity",
      ]);
      const output = resolveSketchTarget(command.repair.output, [
        "sketchEntity",
      ]);
      if (target.kind !== "sketchEntity" || output.kind !== "sketchEntity")
        throw new Error("Invalid mirror original target.");
      command.repair = { kind: "original", target, output };
    }
  }
  if (command.operation === "sketch.requirement.add")
    command.targets = command.targets.map((value) => {
      if (!isTargetSelector(value)) return value;
      const discovered = discoveryFor(value);
      const kinds = [
        "sketchPoint",
        "sketchEntity",
        "sketchDatumReference",
        "projectedReferenceGeometry",
      ];
      const eligible = [
        ...(discovered?.references ?? []),
        ...(discovered?.sketch?.operands ?? []),
      ].filter((r) => kinds.includes(r.target.kind));
      const matches = eligible.filter((r) => r.label === value.label);
      if (matches.length !== 1)
        throw selectionError(
          "Requirement target alias is missing or ambiguous.",
          value,
          kinds,
          matches,
          discovered,
          eligible,
        );
      const target = matches[0]!.target;
      if (
        target.kind !== "sketchPoint" &&
        target.kind !== "sketchEntity" &&
        target.kind !== "sketchDatumReference" &&
        target.kind !== "projectedReferenceGeometry"
      )
        throw new Error("Invalid requirement target.");
      return target;
    });
  if (command.operation === "sketch.requirement.remove")
    command.targets = command.targets.map((value) => {
      const target = resolveSketchTarget(value, ["dimension", "constraint"]);
      if (target.kind !== "dimension" && target.kind !== "constraint")
        throw new Error("Invalid requirement removal target.");
      return target;
    });
  if (
    command.operation === "sketch.author" &&
    command.primitive.kind === "tangentArc" &&
    isTargetSelector(command.primitive.source)
  ) {
    const source = resolveSketchTarget(command.primitive.source, [
      "sketchEntity",
    ]);
    if (source.kind !== "sketchEntity")
      throw new Error("Invalid tangent source target.");
    command.primitive = { ...command.primitive, source };
  }
  if (
    (command.operation === "sketch.begin" && "support" in command) ||
    command.operation === "sketch.support.reassign"
  ) {
    const support = resolveSketchTarget(command.support, [
      "construction",
      "face",
    ]);
    if (support.kind !== "construction" && support.kind !== "face")
      throw new Error("Invalid sketch support.");
    command.support = support;
  }
  if (command.operation === "sketch.reference.add") {
    const target = resolveSketchTarget(command.target, [
      "construction",
      "face",
      "edge",
      "vertex",
      "sketch",
      "sketchEntity",
      "sketchPoint",
    ]);
    if (
      target.kind !== "construction" &&
      target.kind !== "face" &&
      target.kind !== "edge" &&
      target.kind !== "vertex" &&
      target.kind !== "sketch" &&
      target.kind !== "sketchEntity" &&
      target.kind !== "sketchPoint"
    )
      throw new Error("Invalid external reference source.");
    command.target = target;
  }
  if (
    command.operation === "sketch.image.update" ||
    command.operation === "sketch.image.replace" ||
    command.operation === "sketch.image.remove"
  ) {
    const target = resolveSketchTarget(command.target, ["sketchOperation"]);
    if (target.kind !== "sketchOperation")
      throw new Error("Invalid reference image target.");
    command.target = target;
  }
  if (command.operation === "sketch.construction.set") {
    const target = resolveSketchTarget(command.target, [
      "sketchPoint",
      "sketchEntity",
    ]);
    if (target.kind !== "sketchPoint" && target.kind !== "sketchEntity")
      throw new Error("Invalid construction target.");
    command.target = target;
  }
  if (command.operation === "sketch.label.set") {
    const target = resolveSketchTarget(command.target, [
      "sketchPoint",
      "sketchEntity",
      "dimension",
      "constraint",
      "sketch",
    ]);
    if (
      target.kind !== "sketchPoint" &&
      target.kind !== "sketchEntity" &&
      target.kind !== "dimension" &&
      target.kind !== "constraint" &&
      target.kind !== "sketch"
    )
      throw new Error("Invalid label target.");
    command.target = target;
  }
  if (
    command.operation === "sketch.geometry.build" ||
    command.operation === "sketch.derivation.create" ||
    command.operation === "sketch.mirror.create" ||
    command.operation === "sketch.offset.create"
  )
    command.targets = command.targets.map((value) => {
      const target = resolveSketchTarget(value, ["sketchEntity"]);
      if (target.kind !== "sketchEntity")
        throw new Error("Invalid construction target.");
      return target;
    });
  if (command.operation === "sketch.style.patch")
    command.targets = command.targets.map((value) => {
      const target = resolveSketchTarget(value, ["region", "sketchEntity"]);
      if (target.kind !== "region" && target.kind !== "sketchEntity")
        throw new Error("Invalid style target.");
      return target;
    });
  if (command.operation === "sketch.geometry.delete")
    command.targets = command.targets.map((value) => {
      const target = resolveSketchTarget(value, [
        "sketchPoint",
        "sketchEntity",
      ]);
      if (target.kind !== "sketchPoint" && target.kind !== "sketchEntity")
        throw new Error("Invalid deletion target.");
      return target;
    });
  if (
    command.operation === "sketch.geometry.update" &&
    isTargetSelector(command.edit.target)
  ) {
    const target = resolveSketchTarget(
      command.edit.target,
      command.edit.kind === "point" || command.edit.kind === "mergePoints"
        ? ["sketchPoint"]
        : ["sketchEntity"],
    );
    if (
      (command.edit.kind === "point" || command.edit.kind === "mergePoints") &&
      target.kind === "sketchPoint"
    )
      command.edit.target = target;
    else if (
      (command.edit.kind === "translate" ||
        command.edit.kind === "radius" ||
        command.edit.kind === "trim" ||
        command.edit.kind === "split" ||
        command.edit.kind === "extend") &&
      target.kind === "sketchEntity"
    )
      command.edit.target = target;
    else throw new Error("Invalid geometry edit target.");
  }
  if (
    command.operation === "sketch.geometry.update" &&
    (command.edit.kind === "split" || command.edit.kind === "extend") &&
    isTargetSelector(command.edit.boundary)
  ) {
    const boundary = resolveSketchTarget(command.edit.boundary, [
      "sketchEntity",
    ]);
    if (boundary.kind !== "sketchEntity")
      throw new Error("Invalid edit boundary.");
    command.edit.boundary = boundary;
  }
  if (
    command.operation === "sketch.geometry.update" &&
    command.edit.kind === "mergePoints" &&
    isTargetSelector(command.edit.destination)
  ) {
    const destination = resolveSketchTarget(command.edit.destination, [
      "sketchPoint",
    ]);
    if (destination.kind !== "sketchPoint")
      throw new Error("Invalid merge destination.");
    command.edit.destination = destination;
  }
  if (
    command.operation.startsWith("export.") &&
    "target" in command &&
    isTargetSelector(command.target)
  ) {
    const target = command.target;
    const discovery = discoveryFor(target);
    const kinds =
      discovery?.exportProviders?.find(
        (provider) =>
          provider.format === command.operation.slice("export.".length),
      )?.targetKinds ?? [];
    const exportable =
      discovery?.references.filter(
        (r) =>
          r.label === target.label &&
          discovery.exportProviders?.some((provider) =>
            provider.targetKinds.includes(r.target.kind),
          ),
      ) ?? [];
    const supported = exportable.filter((r) => kinds.includes(r.target.kind));
    // Preserve the semantic unsupported-target refusal for an otherwise
    // unambiguous exportable target; feature labels are never exports.
    const matches = supported.length ? supported : exportable;
    if (matches.length !== 1)
      throw selectionError(
        "Export target alias is missing or ambiguous.",
        target,
        kinds,
        matches,
        discovery,
      );
    command.target = matches[0]!.target;
  }
  if (
    (command.operation === "extrude.create" ||
      command.operation === "extrude.update" ||
      command.operation === "revolve.create" ||
      command.operation === "revolve.update") &&
    "parameters" in command &&
    command.parameters !== undefined
  ) {
    const parameters = command.parameters;
    function resolveProfile(
      profile:
        | import("@/contracts/modeling/schema").ExtrudeSurfaceProfileRef
        | TargetSelector,
    ) {
      if (!isTargetSelector(profile)) return profile;
      const kinds =
        parameters.resultBodyType === "surface"
          ? ["region", "face", "sketchEntity"]
          : ["region", "face"];
      const matches =
        discoveryFor(profile)?.references.filter(
          (r) => r.label === profile.label && kinds.includes(r.target.kind),
        ) ?? [];
      if (matches.length !== 1)
        throw selectionError(
          "Extrude profile target alias is missing or ambiguous.",
          profile,
          kinds,
          matches,
          discoveryFor(profile),
        );
      const target = matches[0]!.target;
      if (
        target.kind !== "region" &&
        target.kind !== "face" &&
        target.kind !== "sketchEntity"
      )
        throw new Error("Unsupported extrude profile reference.");
      return target;
    }
    function resolveSolidProfile(
      profile:
        | import("@/contracts/modeling/schema").ExtrudeProfileRef
        | TargetSelector,
    ) {
      const target = resolveProfile(profile);
      if (target.kind === "sketchEntity")
        throw new Error("Solid extrusion requires closed profiles.");
      return target;
    }
    command.parameters =
      parameters.resultBodyType === "solid"
        ? {
            ...parameters,
            profiles: [
              resolveSolidProfile(parameters.profiles[0]),
              ...parameters.profiles.slice(1).map(resolveSolidProfile),
            ],
          }
        : {
            ...parameters,
            profiles: [
              resolveProfile(parameters.profiles[0]),
              ...parameters.profiles.slice(1).map(resolveProfile),
            ],
          };
  }
  if (
    (command.operation === "extrude.create" ||
      command.operation === "extrude.update" ||
      command.operation === "revolve.create" ||
      command.operation === "revolve.update") &&
    "parameters" in command &&
    command.parameters !== undefined &&
    command.parameters.resultBodyType === "solid" &&
    command.parameters.booleanScope.kind === "targetBody" &&
    isTargetSelector(command.parameters.booleanScope.bodyId)
  ) {
    const target = resolveSketchTarget(command.parameters.booleanScope.bodyId, [
      "body",
    ]);
    if (target.kind !== "body")
      throw new Error("Invalid exact boolean scope body.");
    command.parameters = {
      ...command.parameters,
      booleanScope: { kind: "targetBody", bodyId: target.bodyId },
    };
  }
  if (
    command.operation === "fillet.create" ||
    command.operation === "fillet.update" ||
    command.operation === "chamfer.create" ||
    command.operation === "chamfer.update"
  ) {
    const resolveEdge = (
      value:
        | Extract<
            import("@/contracts/shared/references").DurableRef,
            { kind: "edge" }
          >
        | TargetSelector,
    ) => {
      const target = resolveSketchTarget(value, ["edge"]);
      if (target.kind !== "edge") throw new Error("Invalid edge target.");
      return target;
    };
    if (
      command.operation === "fillet.create" ||
      command.operation === "fillet.update"
    )
      command.parameters = {
        ...command.parameters,
        edgeTargets: command.parameters.edgeTargets.map(resolveEdge),
      };
    else
      command.parameters = {
        ...command.parameters,
        participants: [
          {
            role: "edge",
            targets:
              command.parameters.participants[0].targets.map(resolveEdge),
          },
        ],
      };
  }
  if (
    command.operation === "shell.create" ||
    command.operation === "shell.update"
  ) {
    const bodyTarget = resolveSketchTarget(command.parameters.bodyTarget, [
      "body",
    ]);
    if (bodyTarget.kind !== "body")
      throw new Error("Invalid shell body reference.");
    const faceTargets = command.parameters.faceTargets.map((value) => {
      const target = resolveSketchTarget(value, ["face"]);
      if (target.kind !== "face")
        throw new Error("Invalid shell face reference.");
      return target;
    });
    command.parameters = {
      ...command.parameters,
      bodyTarget,
      faceTargets,
    } as typeof command.parameters;
  }
  if (
    command.operation === "thicken.create" ||
    command.operation === "thicken.update"
  ) {
    const sources = command.parameters.participants[0].targets.map((value) => {
      const target = resolveSketchTarget(value, ["body", "face"]);
      if (target.kind !== "body" && target.kind !== "face")
        throw new Error("Invalid thicken source.");
      return target;
    });
    const targets = command.parameters.participants.slice(1).map((p) => ({
      role: "targetBody" as const,
      targets: p.targets.map((value) => {
        const target = resolveSketchTarget(value, ["body"]);
        if (target.kind !== "body")
          throw new Error("Invalid thicken boolean target.");
        return target;
      }),
    }));
    command.parameters = {
      ...command.parameters,
      participants: [{ role: "face", targets: sources }, ...targets],
    };
  }
  if (
    command.operation === "combine.create" ||
    command.operation === "combine.update" ||
    command.operation === "split.create" ||
    command.operation === "split.update" ||
    command.operation === "deleteSolid.create" ||
    command.operation === "deleteSolid.update"
  ) {
    const resolveBody = (
      value:
        | Extract<
            import("@/contracts/shared/references").DurableRef,
            { kind: "body" }
          >
        | TargetSelector,
    ) => {
      const target = resolveSketchTarget(value, ["body"]);
      if (target.kind !== "body")
        throw new Error("Invalid body boolean participant.");
      return target;
    };
    if (
      command.operation === "deleteSolid.create" ||
      command.operation === "deleteSolid.update"
    ) {
      command.parameters = {
        ...command.parameters,
        participants: [
          {
            role: "body",
            targets:
              command.parameters.participants[0].targets.map(resolveBody),
          },
        ],
      };
    } else {
      command.parameters = {
        ...command.parameters,
        participants: command.parameters.participants.map((p) => ({
          role: p.role,
          targets: p.targets.map(resolveBody),
        })),
      };
    }
  }
  if (
    command.operation === "mirror.create" ||
    command.operation === "mirror.update" ||
    command.operation === "transform.create" ||
    command.operation === "transform.update" ||
    command.operation === "linearPattern.create" ||
    command.operation === "linearPattern.update" ||
    command.operation === "circularPattern.create" ||
    command.operation === "circularPattern.update"
  ) {
    command.parameters = {
      ...command.parameters,
      participants: command.parameters.participants.map((p) => {
        const kinds =
          p.role === "body" || p.role === "targetBody"
            ? (["body"] as const)
            : p.role === "plane" || p.role === "transformReference"
              ? (["construction", "face"] as const)
              : (["construction", "face", "edge", "sketchEntity"] as const);
        return {
          role: p.role,
          targets: p.targets.map((value) => resolveSketchTarget(value, kinds)),
        };
      }),
    } as typeof command.parameters;
  }
  if (
    command.operation === "loft.create" ||
    command.operation === "loft.update"
  ) {
    command.parameters = {
      ...command.parameters,
      participants: command.parameters.participants.map((p) => {
        if (p.role === "profile")
          return {
            role: p.role,
            targets: p.targets.map((v) => {
              const t = resolveSketchTarget(v, ["region", "face"]);
              if (t.kind !== "region" && t.kind !== "face")
                throw new Error("Invalid loft profile.");
              return t;
            }),
          };
        return {
          role: p.role,
          targets: p.targets.map((v) => {
            const t = resolveSketchTarget(v, ["edge"]);
            if (t.kind !== "edge") throw new Error("Invalid loft path.");
            return t;
          }),
        };
      }),
    };
  }
  if (
    command.operation === "sweep.create" ||
    command.operation === "sweep.update"
  ) {
    command.parameters = {
      ...command.parameters,
      participants: command.parameters.participants.map((p) => {
        // Keep role/kind correspondence; labels never select an arbitrary first match.
        switch (p.role) {
          case "profile":
            return {
              role: p.role,
              targets: p.targets.map((v) => {
                const t = resolveSketchTarget(v, ["region", "face"]);
                if (t.kind !== "region" && t.kind !== "face")
                  throw new Error("Invalid sweep profile.");
                return t;
              }),
            };
          case "path":
          case "guideCurve":
            return {
              role: p.role,
              targets: p.targets.map((v) => {
                const t = resolveSketchTarget(v, ["edge", "sketchEntity"]);
                if (t.kind !== "edge" && t.kind !== "sketchEntity")
                  throw new Error("Invalid sweep path.");
                return t;
              }),
            };
          case "lockProfileFace":
            return {
              role: p.role,
              targets: p.targets.map((v) => {
                const t = resolveSketchTarget(v, ["face"]);
                if (t.kind !== "face")
                  throw new Error("Invalid sweep lock face.");
                return t;
              }),
            };
          case "lockProfileDirection":
            return {
              role: p.role,
              targets: p.targets.map((v) => {
                const t = resolveSketchTarget(v, ["edge", "construction"]);
                if (t.kind !== "edge" && t.kind !== "construction")
                  throw new Error("Invalid sweep lock direction.");
                return t;
              }),
            };
          case "targetBody":
            return {
              role: p.role,
              targets: p.targets.map((v) => {
                const t = resolveSketchTarget(v, ["body"]);
                if (t.kind !== "body")
                  throw new Error("Invalid sweep target body.");
                return t;
              }),
            };
        }
      }),
    };
  }
  if (
    command.operation === "hole.create" ||
    command.operation === "hole.update"
  ) {
    const locations = command.parameters.participants[0].targets.map(
      (value) => {
        const target = resolveSketchTarget(value, ["sketchPoint"]);
        if (target.kind !== "sketchPoint")
          throw new Error("Invalid hole location.");
        return target;
      },
    );
    const bodies = command.parameters.participants[1].targets.map((value) => {
      const target = resolveSketchTarget(value, ["body"]);
      if (target.kind !== "body") throw new Error("Invalid hole body.");
      return target;
    });
    command.parameters = {
      ...command.parameters,
      participants: [
        { role: "location", targets: locations },
        { role: "body", targets: bodies },
      ],
    };
  }
  if (
    (command.operation === "plane.create" ||
      command.operation === "plane.update") &&
    command.parameters.mode === "coplanar"
  ) {
    const target = resolveSketchTarget(command.parameters.reference.target, [
      "construction",
      "face",
    ]);
    if (target.kind !== "construction" && target.kind !== "face")
      throw new Error("Invalid plane reference.");
    command.parameters = {
      ...command.parameters,
      reference: { ...command.parameters.reference, target },
    };
  }
  if (
    command.operation === "revolve.create" ||
    command.operation === "revolve.update"
  ) {
    const axis = resolveSketchTarget(command.parameters.axis, [
      "edge",
      "sketchEntity",
      "construction",
    ]);
    if (
      axis.kind !== "edge" &&
      axis.kind !== "sketchEntity" &&
      axis.kind !== "construction"
    )
      throw new Error("Invalid revolve axis.");
    command.parameters = { ...command.parameters, axis };
  }
  if (
    command.operation === "extrude.create" &&
    "profile" in command &&
    isTargetSelector(command.profile)
  ) {
    const target = command.profile;
    const matches =
      discoveryFor(target)?.references.filter(
        (r) => r.label === target.label && r.target.kind === "region",
      ) ?? [];
    if (matches.length !== 1 || matches[0]!.target.kind !== "region")
      throw selectionError(
        "Profile target alias is missing or ambiguous.",
        target,
        ["region"],
        matches,
        discoveryFor(target),
      );
    command.profile = matches[0]!.target;
  }
  if (
    (command.operation === "sketch.open" ||
      command.operation === "sketch.support.reassign") &&
    isTargetSelector(command.sketchId)
  ) {
    const target = resolveSketchTarget(command.sketchId, ["sketch"]);
    if (target.kind !== "sketch") throw new Error("Invalid sketch target.");
    command.sketchId = target.sketchId;
  }
  return command as SemanticCommand;
}

function resolveLabelled<T>(
  message: string,
  target: TargetSelector,
  kind: string,
  records: readonly { label: string; target: T }[],
) {
  const matches = records.filter((record) => record.label === target.label);
  if (matches.length !== 1)
    throw selectionError(message, target, [kind], matches, undefined, records);
  return matches[0]!.target;
}
