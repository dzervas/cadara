/**
 * T16a ([TECH] T16-1, issue 15 "Invalid state and recovery"): explicit
 * repair of a mirror relationship: removal, and (T16e, [TECH] T16-9/T16-10)
 * replacement of its mirror line or of one copy's original, with the
 * bounded cycle check. The removal write set is shared with offsets
 * (`derived-removal.ts`, T17c).
 */
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  indexMirrorGeometry,
  orderDerivedRelationships,
  resolveMirrorAxis,
  syncMirrorOutputStructures,
  type MirrorRelationship,
} from "@/contracts/sketch/mirror-requirements";
import { solvedPairDefinition } from "@/contracts/sketch/offset-publication";
import type {
  SketchDefinition,
  SketchEntityDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";
import {
  removeDerivedRelationship,
  type DerivedRelationshipRemoval,
} from "@/core/sketch-editing/derived-removal";

/** The mirror removal write set (`removeDerivedRelationship`). */
export type MirrorRemoval = DerivedRelationshipRemoval;

/**
 * Removes mirror `derivationId` with its write set: the relationship; its
 * output entities that still exist; their output points no remaining
 * entity references (an output point shared by two outputs or reused by a
 * user entity stays while referenced); the constraints and dimensions that
 * name removed geometry. Seeds, the axis and every other relationship are
 * untouched: nothing cascades, nothing is retargeted. Works whatever the
 * mirror's health (any broken state, an orphan). Null when the definition
 * has no mirror with that id.
 */
export const removeMirrorRelationship = (
  definition: SketchDefinition,
  derivationId: string,
): MirrorRemoval | null =>
  removeDerivedRelationship(definition, derivationId, "mirror");

// ------------------------------------------------------------ replacement

/** A replacement mirror line: a straight sketch line, or the X/Y sketch axis. */
export type MirrorLineCandidate = MirrorRelationship["mirrorReference"];

/** What a replacement is judged against, besides the definition. */
export interface MirrorReplacementContext {
  /** The document modeling tolerance τ (the degenerate-axis threshold). */
  readonly modelingTolerance: number;
  /**
   * The current live solve of `definition`: a candidate line's length is
   * judged at its solved positions. Absent: the authored positions.
   */
  readonly solvedSnapshot?: SolvedSketchSnapshot | null;
  /**
   * The edit-input gate (G19, T16c): its refusal text for a candidate that
   * is not accepted geometry (an uncertified offset's output, a broken
   * relationship's copy), else null.
   */
  readonly inputRefusal?: (entityId: SketchEntityId) => string | null;
}

export type MirrorReplacement =
  | {
      readonly ok: true;
      /** The definition with only the mirror record rebound. */
      readonly definition: SketchDefinition;
    }
  | { readonly ok: false; readonly message: string };

/** T16-10: the refusal of a replacement that closes a dependency loop. */
export const MIRROR_CYCLE_MESSAGE =
  "This would make the mirror depend on its own copies.";

const RECREATE = "Remove the mirror and mirror the new geometry instead.";

const ENTITY_NOUN: Record<SketchEntityDefinition["kind"], string> = {
  lineSegment: "line",
  point: "point",
  circle: "circle",
  arc: "arc",
  spline: "spline",
  ellipse: "ellipse",
  ellipticalArc: "elliptical arc",
  conic: "conic",
  bezierCurve: "Bézier curve",
  profileText: "text",
  derivedPiecewiseCubic: "offset spline curve",
};

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "An" : "A");

function findMirror(definition: SketchDefinition, derivationId: string) {
  const relationship = definition.derivedRelationships?.find(
    (candidate) => candidate.derivationId === derivationId,
  );
  return relationship?.kind === "mirror" ? relationship : null;
}

const missingMirror = (): MirrorReplacement => ({
  ok: false,
  message: "This mirror no longer exists.",
});

/** `definition` with `relationship` in place of the record with its id. */
function withRelationship(
  definition: SketchDefinition,
  relationship: MirrorRelationship,
): SketchDefinition {
  return {
    ...definition,
    derivedRelationships: definition.derivedRelationships!.map((candidate) =>
      candidate.derivationId === relationship.derivationId
        ? relationship
        : candidate,
    ),
  };
}

/**
 * T16-10 (plan review A-7): a rebinding closes a dependency loop when a
 * relationship that resolved before is unresolved after, or when the
 * rebound relationship itself is still unresolved (on a loop, or reading
 * geometry made in one). The relationship order (`orderDerivedRelationships`,
 * bounded Kahn over the read/produce edges evaluation already uses) is the
 * whole check: no new graph.
 */
function dependencyLoopRefusal(
  before: SketchDefinition,
  after: SketchDefinition,
  relationship: MirrorRelationship,
): string | null {
  const unresolvedBefore = new Set(
    orderDerivedRelationships(before).unresolved.map(
      (failure) => failure.derivationId,
    ),
  );
  const unresolvedAfter = orderDerivedRelationships(after).unresolved;
  if (
    !unresolvedAfter.some(
      (failure) =>
        failure.derivationId === relationship.derivationId ||
        !unresolvedBefore.has(failure.derivationId),
    )
  )
    return null;
  // T16e review A-7: a mirror that already read geometry made in a
  // (persisted) loop, and still only reads it, makes no loop of its own.
  const readsLoopOnly =
    unresolvedBefore.has(relationship.derivationId) &&
    unresolvedAfter.every(
      (failure) =>
        unresolvedBefore.has(failure.derivationId) &&
        (failure.derivationId !== relationship.derivationId ||
          failure.reason === "dependsOnLoop"),
    );
  return readsLoopOnly
    ? `Mirror ‘${relationship.label}’ depends on geometry made in a dependency loop. Repair that loop first, or remove the mirror.`
    : MIRROR_CYCLE_MESSAGE;
}

/**
 * T16e ([TECH] T16-9, issue 15 "Invalid state and recovery"): rebinds
 * mirror `derivationId` to a new mirror line, writing `mirrorReference`
 * only (derivationId, label, seeds and every output entity and point id are
 * kept, so nothing downstream retargets). The candidate must be a straight
 * sketch line (construction included) or the X/Y sketch axis; not an
 * original of this mirror nor its current line; not close a dependency
 * loop (its own copies or a downstream copy, [TECH] T16-10); be accepted
 * geometry (the edit-input gate); and be at least τ long at the current
 * solved positions (the owner's `derived-mirror-axis-degenerate` predicate).
 * Healthy and broken mirrors alike; nothing is ever chosen automatically.
 */
export function replaceMirrorLine(
  definition: SketchDefinition,
  derivationId: string,
  candidate: MirrorLineCandidate,
  context: MirrorReplacementContext,
): MirrorReplacement {
  const relationship = findMirror(definition, derivationId);
  if (!relationship) return missingMirror();
  const named = `mirror ‘${relationship.label}’`;
  let lineLabel =
    candidate.kind === "sketchDatum"
      ? `The sketch ${candidate.datum === "xAxis" ? "X" : "Y"} axis`
      : "";
  if (candidate.kind === "lineEntity") {
    const line = definition.entities.find(
      (entity) => entity.entityId === candidate.entityId,
    );
    if (!line) return missingMirror();
    if (line.kind !== "lineSegment")
      return {
        ok: false,
        message: `${article(ENTITY_NOUN[line.kind])} ${ENTITY_NOUN[line.kind]} can't be a mirror line. Pick a straight line or a sketch axis.`,
      };
    lineLabel = `‘${line.label}’`;
    if (
      relationship.seedEntityIds.includes(line.entityId) ||
      relationship.outputs.some(
        (output) => output.seedEntityId === line.entityId,
      )
    )
      return {
        ok: false,
        message: `${lineLabel} is an original of ${named}, so it can't be its mirror line. Pick another line or a sketch axis.`,
      };
  }
  const current = relationship.mirrorReference;
  if (
    current.kind === "lineEntity"
      ? candidate.kind === "lineEntity" &&
        candidate.entityId === current.entityId
      : candidate.kind === "sketchDatum" && candidate.datum === current.datum
  )
    return {
      ok: false,
      message: `${lineLabel} is already the mirror line of ${named}.`,
    };
  const next = withRelationship(definition, {
    ...relationship,
    mirrorReference: candidate,
  });
  const loop = dependencyLoopRefusal(definition, next, relationship);
  if (loop) return { ok: false, message: loop };
  if (candidate.kind === "lineEntity") {
    const refusal = context.inputRefusal?.(candidate.entityId) ?? null;
    if (refusal) return { ok: false, message: refusal };
    const solved = context.solvedSnapshot
      ? solvedPairDefinition(definition, context.solvedSnapshot)
      : definition;
    const axis = resolveMirrorAxis(
      relationship,
      candidate,
      indexMirrorGeometry(solved),
      context.modelingTolerance,
    );
    if (!axis.ok)
      return {
        ok: false,
        message: `${lineLabel} is shorter than the modeling tolerance, so it can't be a mirror line. Pick a longer line or a sketch axis.`,
      };
  }
  return { ok: true, definition: next };
}

/** A mirrorable entity's defining points in the order outputs record them (null: not mirrorable). */
function definingPointIds(
  entity: SketchEntityDefinition,
): readonly SketchPointId[] | null {
  switch (entity.kind) {
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "point":
      return [entity.pointId];
    case "circle":
      return [entity.centerPointId];
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId];
    case "spline":
      return (
        orderedSplineOccurrences(entity)?.map(({ pointId }) => pointId) ?? null
      );
    default:
      return null;
  }
}

/**
 * T16e ([TECH] T16-9, A-7): rebinds the original of one copy
 * (`outputEntityId`) of mirror `derivationId` to `seedEntityId`, writing
 * that output's `seedEntityId`/`seedPointIds` and the matching
 * `seedEntityIds` entry (derivationId, label and every output entity and
 * point id kept); the copy's structure (arc sweep, spline closure, policy,
 * tangent kinds) then follows the new original by the owner's structural
 * sync. Compatible only when: the copy exists; the candidate is not an
 * offset spline curve (U-G2), the mirror line, or already an original of
 * this mirror; it is the copy's entity kind (a spline: the same fit-point
 * count and closure); its points map to the copy's by entity-defining
 * order (arc: centre, start, end) without ambiguity: a copy point shared
 * with another copy keeps that copy's original point, and a new original
 * point already mapped to another copy point is refused (the map would be
 * one-to-many, which creation never makes); no dependency loop closes
 * ([TECH] T16-10); and it is accepted geometry. Otherwise the mirror must
 * be recreated, and the text says so. Healthy and broken mirrors alike.
 */
export function replaceMirrorOriginal(
  definition: SketchDefinition,
  derivationId: string,
  outputEntityId: SketchEntityId,
  seedEntityId: SketchEntityId,
  context: MirrorReplacementContext,
): MirrorReplacement {
  const relationship = findMirror(definition, derivationId);
  if (!relationship) return missingMirror();
  const named = `mirror ‘${relationship.label}’`;
  const outputIndex = relationship.outputs.findIndex(
    (output) => output.outputEntityId === outputEntityId,
  );
  const output = relationship.outputs[outputIndex];
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const copy = entityById.get(outputEntityId);
  if (!output || !copy)
    return {
      ok: false,
      message: `This copy of ${named} was deleted, so it has no original to replace. Remove the mirror from the Mirror panel instead.`,
    };
  const seed = entityById.get(seedEntityId);
  if (!seed) return missingMirror();
  const seedLabel = `‘${seed.label}’`;
  const copyLabel = `‘${copy.label}’`;
  if (seed.kind === "derivedPiecewiseCubic")
    return {
      ok: false,
      message:
        "An offset spline curve cannot be mirrored, patterned or transformed yet.",
    };
  if (
    relationship.mirrorReference.kind === "lineEntity" &&
    relationship.mirrorReference.entityId === seedEntityId
  )
    return {
      ok: false,
      message: `${seedLabel} is the mirror line of ${named}, so it can't be one of its originals.`,
    };
  if (
    relationship.seedEntityIds.includes(seedEntityId) ||
    relationship.outputs.some((entry) => entry.seedEntityId === seedEntityId)
  )
    return {
      ok: false,
      message: `${seedLabel} is already an original of ${named}.`,
    };
  const seedNoun = ENTITY_NOUN[seed.kind];
  const copyNoun = ENTITY_NOUN[copy.kind];
  const seedPointIds = definingPointIds(seed);
  const copyPointIds = definingPointIds(copy);
  if (seed.kind !== copy.kind || !seedPointIds || !copyPointIds)
    return {
      ok: false,
      message: `${article(seedNoun)} ${seedNoun} can't replace the original of this mirrored ${copyNoun}. ${RECREATE}`,
    };
  if (seed.kind === "spline" && copy.kind === "spline") {
    if (seedPointIds.length !== copyPointIds.length)
      return {
        ok: false,
        message: `A spline with ${seedPointIds.length} fit points can't replace the original of this mirrored spline with ${copyPointIds.length}. ${RECREATE}`,
      };
    if (seed.closure !== copy.closure)
      return {
        ok: false,
        message: `${article(seed.closure)} ${seed.closure} spline can't replace the original of this mirrored ${copy.closure} spline. ${RECREATE}`,
      };
  }
  if (
    copyPointIds.length !== output.outputPointIds.length ||
    copyPointIds.some(
      (pointId, index) => output.outputPointIds[index] !== pointId,
    )
  )
    return {
      ok: false,
      message: `${copyLabel} no longer matches its recorded points, so its original can't be replaced. ${RECREATE}`,
    };
  // Unambiguous point correspondence: one original point per copy point
  // (a copy point shared with another copy keeps that copy's original
  // point) and one copy point per original point.
  const seedOf = new Map<SketchPointId, SketchPointId>();
  const copyOf = new Map<SketchPointId, SketchPointId>();
  const conflict = (
    seedPointId: SketchPointId,
    outputPointId: SketchPointId,
  ): "shared" | "taken" | null => {
    const knownSeed = seedOf.get(outputPointId);
    const knownCopy = copyOf.get(seedPointId);
    if (knownSeed !== undefined && knownSeed !== seedPointId) return "shared";
    if (knownCopy !== undefined && knownCopy !== outputPointId) return "taken";
    seedOf.set(outputPointId, seedPointId);
    copyOf.set(seedPointId, outputPointId);
    return null;
  };
  // Review R-1: a deleted original point constrains nothing (its copy
  // needs its own replacement, judged against the live records then).
  const pointIds = new Set(definition.points.map((point) => point.pointId));
  for (const entry of relationship.outputs)
    if (entry !== output)
      entry.seedPointIds.forEach((seedPointId, index) => {
        const outputPointId = entry.outputPointIds[index];
        if (outputPointId !== undefined && pointIds.has(seedPointId))
          conflict(seedPointId, outputPointId);
      });
  for (const [index, seedPointId] of seedPointIds.entries()) {
    const found = conflict(seedPointId, output.outputPointIds[index]!);
    if (!found) continue;
    // Review A-1: say what does not line up.
    const pointLabel =
      definition.points.find((point) => point.pointId === seedPointId)?.label ??
      "";
    return {
      ok: false,
      message:
        found === "shared"
          ? `${seedLabel} can't replace the original of ${copyLabel}: its points don't line up with the points this copy shares with the other copies. Draw it from the shared point, or remove the mirror and mirror the new geometry instead.`
          : `${seedLabel} can't replace the original of ${copyLabel}: its point ‘${pointLabel}’ is already the original of another copy's point. Use geometry with its own points, or remove the mirror and mirror the new geometry instead.`,
    };
  }
  const oldSeedIndex = relationship.seedEntityIds.indexOf(output.seedEntityId);
  const rebound: MirrorRelationship = {
    ...relationship,
    seedEntityIds:
      oldSeedIndex < 0
        ? [...relationship.seedEntityIds, seedEntityId]
        : relationship.seedEntityIds.map((entityId, index) =>
            index === oldSeedIndex ? seedEntityId : entityId,
          ),
    outputs: relationship.outputs.map((entry, index) =>
      index === outputIndex
        ? { ...entry, seedEntityId, seedPointIds: [...seedPointIds] }
        : entry,
    ),
  };
  const next = withRelationship(definition, rebound);
  const loop = dependencyLoopRefusal(definition, next, relationship);
  if (loop) return { ok: false, message: loop };
  const refusal = context.inputRefusal?.(seedEntityId) ?? null;
  if (refusal) return { ok: false, message: refusal };
  return {
    ok: true,
    definition: syncMirrorOutputStructures({
      definition: next,
      modelingTolerance: context.modelingTolerance,
    }),
  };
}
