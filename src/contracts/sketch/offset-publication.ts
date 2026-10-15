import type { CertifiedTubePieceChainRequests } from "@/contracts/modeling/neutral-curve-query";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { CertifiedNeutralCurveRequestQuery } from "@/contracts/sketch/offset-chain-topology";
import {
  publishOffsetFrame,
  solveOffsetFrame,
  type OffsetCertificationMemo,
} from "@/contracts/sketch/offset-derivation-frame";
import {
  mapOffsetFrameOutputs,
  offsetDeletedOutput,
  offsetFramePointValue,
  offsetFrameRelationshipOf,
  offsetFrameShellSpans,
} from "@/contracts/sketch/offset-derivation-outputs";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import {
  mirrorRepairCommand,
  RELATIONSHIP_NOUN,
} from "@/contracts/sketch/mirror-requirements";
import type {
  DerivedRelationshipFailureReason,
  DerivableSketchDefinition,
  SketchDefinition,
  SketchDerivationDefinition,
  SketchSolveDiagnostic,
  SolvedOffsetFramePlanRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { SketchOffsetPublicationRecord } from "@/contracts/solver/schema";

/** The certification capabilities publish needs; composed by the domain adapters (no default). */
export interface OffsetPublicationCapabilities {
  readonly query: CertifiedNeutralCurveRequestQuery;
  readonly certifier: CertifiedTubePieceChainRequests;
  /** g1 routed item: the per-deriver certifier memo (bitwise checked-adapter encoding). */
  readonly memo?: OffsetCertificationMemo;
}

/** U-G1: offsets certify only from an accepted solve (the same rule as regions). */
export function isOffsetPublicationSolveAccepted(
  snapshot: SolvedSketchSnapshot,
): boolean {
  return (
    snapshot.status.solveState === "solved" &&
    // [TECH] G16″: a blocked requirement does not count (scoped status).
    snapshot.constraintStatuses.every((entry) =>
      isAcceptedConstraintStatus(entry.status),
    ) &&
    snapshot.dimensionStatuses.every(
      (entry) => entry.status !== "unsatisfied",
    ) &&
    !snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  );
}

/**
 * The accepted pair's definition (E1–E4: the checked adapter reads the
 * solved state): point positions, circle radii and authored spline tangents
 * taken from the solved snapshot.
 */
export function solvedPairDefinition<
  TDefinition extends DerivableSketchDefinition,
>(definition: TDefinition, snapshot: SolvedSketchSnapshot): TDefinition {
  const positions = new Map(
    snapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
  );
  const solved = new Map(
    snapshot.solvedEntities.map((entity) => [entity.entityId, entity]),
  );
  return {
    ...definition,
    points: definition.points.map((point) => {
      const position = positions.get(point.pointId);
      return position ? { ...point, position } : point;
    }),
    entities: definition.entities.map((entity) => {
      const record = solved.get(entity.entityId);
      if (entity.kind === "circle" && record?.kind === "circle")
        return { ...entity, radius: record.solvedRadius };
      if (
        entity.kind === "spline" &&
        record?.kind === "spline" &&
        record.reconstruction.validity === "valid"
      ) {
        const handles = record.reconstruction.handles;
        return {
          ...entity,
          pointOccurrences: entity.pointOccurrences.map((occurrence) => {
            if (occurrence.tangent.kind !== "authored") return occurrence;
            const index = entity.pointOccurrenceIds.indexOf(
              occurrence.occurrenceId,
            );
            const handle = handles[index];
            return handle
              ? {
                  ...occurrence,
                  tangent: { kind: "authored" as const, vector: handle },
                }
              : occurrence;
          }),
        };
      }
      return entity;
    }),
  };
}

const bits = new DataView(new ArrayBuffer(8));
const encode = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "number") return item;
    bits.setFloat64(0, item);
    return `f64:${bits.getBigUint64(0).toString(16)}`;
  });

/**
 * Publishes every offset relationship of one accepted `(definition,
 * solvedSnapshot)` pair ([TECH] G1/G3/G5/G16/G17). Per relationship: the
 * solve frame is re-run with exactly the snapshot's `offsetFramePlans` hint
 * (so it reproduces the solver's frame; a stale or forged hint can only lead
 * to a mismatch, `planChanged` or a fail-closed result), its outputs must be
 * bitwise the snapshot's driven points and shell spans, and then the
 * unchanged SEL certifies (`publishOffsetFrame`). The result is
 * relationship-scoped and never enters the snapshot's diagnostics. An
 * unaccepted solve publishes nothing (U-G1).
 */
export function publishSketchOffsets(input: {
  readonly definition: DerivableSketchDefinition;
  readonly solvedSnapshot: SolvedSketchSnapshot;
  readonly modelingTolerance: number;
  readonly capabilities: OffsetPublicationCapabilities;
}): SketchOffsetPublicationRecord[] {
  const { solvedSnapshot, modelingTolerance, capabilities } = input;
  const offsets = (input.definition.derivedRelationships ?? []).flatMap(
    (relationship) => (relationship.kind === "offset" ? [relationship] : []),
  );
  if (offsets.length === 0 || !isOffsetPublicationSolveAccepted(solvedSnapshot))
    return [];
  const definition = solvedPairDefinition(input.definition, solvedSnapshot);
  const points = new Map(
    solvedSnapshot.solvedPoints.map((point) => [
      point.pointId,
      point.solvedPosition,
    ]),
  );
  const shells = new Map(
    solvedSnapshot.solvedEntities.flatMap((entity) =>
      entity.kind === "derivedPiecewiseCubic"
        ? [[entity.entityId, entity.spans] as const]
        : [],
    ),
  );
  const kinds = new Map(
    definition.entities.map((entity) => [entity.entityId, entity.kind]),
  );
  const records = offsets.map((relationship): SketchOffsetPublicationRecord => {
    const failed = (
      code: string,
      message: string,
      entityId: SketchEntityId | null = relationship.seedEntityIds[0] ?? null,
    ): SketchOffsetPublicationRecord => ({
      derivationId: relationship.derivationId,
      status: "failed",
      diagnostic: publicationDiagnostic(
        code,
        `Offset ‘${relationship.label}’: ${message}`,
        entityId,
      ),
    });
    const distance = getAuthoredLiteralValue<number>(relationship.distance);
    if (typeof distance !== "number" || !Number.isFinite(distance))
      return failed(
        OFFSET_DIAGNOSTIC_CODES.unresolvedDistance,
        "distance is unresolved.",
      );
    const frameRelationship = offsetFrameRelationshipOf(
      relationship,
      distance,
      definition,
    );
    if (!frameRelationship)
      return failed(
        OFFSET_DIAGNOSTIC_CODES.topologyChanged,
        "an authored joint arc no longer joins adjacent seeds of the chain.",
      );
    const hint = solvedSnapshot.offsetFramePlans?.find(
      (entry) => entry.derivationId === relationship.derivationId,
    )?.plan;
    const solveFrame = solveOffsetFrame(
      { relationship: frameRelationship, definition, modelingTolerance },
      hint,
    );
    if (!solveFrame.ok)
      return {
        derivationId: relationship.derivationId,
        status: "failed",
        diagnostic: solveFrame.diagnostic,
      };
    // T17c: a deleted output curve is reported by label.
    const deleted = offsetDeletedOutput(
      relationship,
      (id) =>
        definition.entities.find((entity) => entity.entityId === id)?.label,
    );
    if (deleted)
      return {
        derivationId: relationship.derivationId,
        status: "failed",
        diagnostic: publicationDiagnostic(
          OFFSET_DIAGNOSTIC_CODES.topologyChanged,
          deleted.message,
          deleted.seedEntityId,
        ),
      };
    // The publication must cover exactly what the snapshot persists.
    const outputs = mapOffsetFrameOutputs(relationship, solveFrame, (id) =>
      kinds.get(id),
    );
    if (typeof outputs === "string")
      return failed(OFFSET_DIAGNOSTIC_CODES.topologyChanged, outputs);
    const covered =
      [...outputs.points].every(([pointId, datum]) => {
        const solved = points.get(pointId);
        return (
          solved !== undefined &&
          encode(solved) === encode(offsetFramePointValue(solveFrame, datum))
        );
      }) &&
      outputs.shells.every(
        (shell) =>
          encode(shells.get(shell.entityId)) ===
          encode(offsetFrameShellSpans(solveFrame, shell)),
      );
    if (!covered)
      return failed(
        OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
        "the solved offset outputs are not the solve frame of their recorded plan.",
      );
    const publication = publishOffsetFrame({
      relationship: frameRelationship,
      pair: { definition, solvedSnapshot },
      modelingTolerance,
      query: capabilities.query,
      certifier: capabilities.certifier,
      solveFrame,
      ...(capabilities.memo ? { memo: capabilities.memo } : {}),
    });
    if (publication.status === "failed")
      return {
        derivationId: relationship.derivationId,
        status: "failed",
        diagnostic: publication.diagnostic,
      };
    return {
      derivationId: relationship.derivationId,
      status: publication.status,
      plan: publication.plan,
    };
  });
  return withNonAcceptedSeedsFailed(input.definition, solvedSnapshot, records);
}

/**
 * T10i (review A-1): an offset certified in this round whose seed is a
 * non-accepted offset output under this round's publications (the G19
 * predicate with its closure, the round applied by
 * `applyOffsetPublications`) was certified from that output's held, stale
 * geometry, so it fails with a relationship-scoped
 * `derived-offset-seed-not-certified` on the seed, to a fixed point (an
 * offset of it fails in turn).
 */
function withNonAcceptedSeedsFailed(
  definition: DerivableSketchDefinition,
  snapshot: SolvedSketchSnapshot,
  records: readonly SketchOffsetPublicationRecord[],
): SketchOffsetPublicationRecord[] {
  const seeds = new Map(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset"
        ? [[relationship.derivationId, relationship] as const]
        : [],
    ),
  );
  let current = [...records];
  for (;;) {
    const nonAccepted = nonAcceptedDerivedOutputs(
      definition,
      applyOffsetPublications(definition, snapshot, current),
    );
    let changed = false;
    current = current.map((record) => {
      if (record.status !== "certified") return record;
      const offset = seeds.get(record.derivationId)!;
      const seed = offset.seedEntityIds.find((id) => nonAccepted.has(id));
      if (seed === undefined) return record;
      changed = true;
      const owner = nonAccepted.get(seed)!;
      // T16c ([TECH] T16-7): the code stays; a broken (failed) owner gets
      // the label-based text. Not reached in production: a failed
      // relationship's error diagnostic makes the solve unaccepted, so
      // nothing is published (pinned by a publication row).
      return {
        derivationId: record.derivationId,
        status: "failed",
        diagnostic: publicationDiagnostic(
          OFFSET_DIAGNOSTIC_CODES.seedNotCertified,
          owner.reason === "derivedFailed"
            ? brokenDerivedInputMessage(
                definition,
                { entityId: seed },
                owner,
                `offset ‘${offset.label}’ can't be certified either`,
              )
            : uncertifiedOffsetInputMessage(
                definition,
                { entityId: seed },
                owner,
                `offset ‘${offset.label}’ can't be certified either`,
              ),
          seed,
        ),
      };
    });
    if (!changed) return current;
  }
}

function publicationDiagnostic(
  code: string,
  message: string,
  entityId: SketchEntityId | null,
): SketchSolveDiagnostic {
  return {
    code,
    severity: "error",
    message,
    target: entityId ? { kind: "entity", entityId } : null,
  };
}

/**
 * [TECH] G7/G19a: marks the shells of every `certified` relationship
 * certified in the snapshot the publications were computed from, and records
 * exactly those relationships in `certifiedOffsetDerivationIds` (definition
 * order). The ids are REPLACED by this round's, never merged with ids
 * already recorded (review advisory 4): a relationship that has since failed
 * is not accepted. Nothing else changes; without a certified offset
 * relationship and without recorded ids the snapshot is returned as it is.
 */
export function applyOffsetPublications(
  definition: DerivableSketchDefinition,
  snapshot: SolvedSketchSnapshot,
  publications: readonly SketchOffsetPublicationRecord[],
): SolvedSketchSnapshot {
  const certified = new Set(
    publications
      .filter((publication) => publication.status === "certified")
      .map((publication) => publication.derivationId),
  );
  const certifiedOffsetDerivationIds = (
    definition.derivedRelationships ?? []
  ).flatMap((relationship) =>
    relationship.kind === "offset" && certified.has(relationship.derivationId)
      ? [relationship.derivationId]
      : [],
  );
  if (certifiedOffsetDerivationIds.length === 0) {
    if (snapshot.certifiedOffsetDerivationIds === undefined) return snapshot;
    const replaced = { ...snapshot };
    delete replaced.certifiedOffsetDerivationIds;
    return replaced;
  }
  const certifiedShells = new Set(
    definition.entities.flatMap((entity) =>
      entity.kind === "derivedPiecewiseCubic" &&
      certified.has(entity.derivationId)
        ? [entity.entityId]
        : [],
    ),
  );
  return {
    ...snapshot,
    solvedEntities: snapshot.solvedEntities.map((entity) =>
      entity.kind === "derivedPiecewiseCubic" &&
      certifiedShells.has(entity.entityId)
        ? { ...entity, publication: "certified" }
        : entity,
    ),
    certifiedOffsetDerivationIds,
  };
}

/**
 * [TECH] G19/G19a (T08b-g5c, U-G5): the non-accepted offset outputs of one
 * `(definition, solvedSnapshot)` pair, by entity id, each with its owning
 * relationship. An output (line, arc, circle, joint arc or shell) of an
 * offset relationship that is not in the snapshot's
 * `certifiedOffsetDerivationIds` is non-accepted, and so is a shell whose
 * solved record is missing or not `certified` ([TECH] G7). Non-accepted
 * geometry is drawn with the stale/invalid tint and stays pickable, but it
 * is not region input, measured, exported, snapped or projected. Every
 * other entity is not a non-accepted offset output and is not in the map.
 *
 * [TECH] G16‴ (T08b-g7b review R3): non-acceptance follows derived
 * dependents. A mirror, pattern or transform output whose seed is
 * non-accepted, and every output of a mirror whose axis is non-accepted, is
 * computed from that (possibly stale) geometry, so it is non-accepted too,
 * owned by the same offset relationship. T10i (review A-1): so is every
 * output (line, arc, circle, joint arc, shell) of an offset relationship
 * one of whose seeds is non-accepted (an offset of a non-certified offset's
 * output, directly or through a copy), owned by that seed's relationship.
 *
 * T15b ([TECH] T-8): every output of a failed (held) mirror or unresolved
 * relationship (the snapshot's `failedDerivationIds`) is non-accepted too,
 * owned by that relationship, and so are its dependents (the same
 * closure). T17e (B2): named for every derived kind (was
 * the offset-only name).
 *
 * T16c ([TECH] T16-7): each owner carries the relationship's kind and
 * label and why it holds its outputs (`NonAcceptedOutputOwner.reason`), so
 * every consumer words a broken relationship's copies by label
 * (`brokenDerivedInputMessage`) and keeps the offset wording for offsets.
 */
export function nonAcceptedDerivedOutputs(
  definition: Pick<SketchDefinition, "derivedRelationships" | "entities">,
  snapshot: Pick<
    SolvedSketchSnapshot,
    | "solvedEntities"
    | "certifiedOffsetDerivationIds"
    | "failedDerivationIds"
    | "failedDerivationReasons"
  >,
): ReadonlyMap<SketchEntityId, NonAcceptedOutputOwner> {
  const result = new Map<SketchEntityId, NonAcceptedOutputOwner>();
  const certified = new Set(snapshot.certifiedOffsetDerivationIds ?? []);
  const failed = new Set(snapshot.failedDerivationIds ?? []);
  const ownerOf = (
    relationship: SketchDerivationDefinition,
  ): NonAcceptedOutputOwner =>
    relationship.kind === "offset"
      ? {
          derivationId: relationship.derivationId,
          kind: relationship.kind,
          label: relationship.label,
          reason: "offsetNotCertified",
        }
      : {
          derivationId: relationship.derivationId,
          kind: relationship.kind,
          label: relationship.label,
          reason: "derivedFailed",
          // T17d (B4): the solve's reasons, carried with the failure.
          failureReasons:
            snapshot.failedDerivationReasons?.[relationship.derivationId] ?? [],
        };
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind !== "offset") {
      if (!failed.has(relationship.derivationId)) continue;
      const owner = ownerOf(relationship);
      for (const output of relationship.outputs)
        result.set(output.outputEntityId, owner);
      continue;
    }
    if (certified.has(relationship.derivationId)) continue;
    const owner = ownerOf(relationship);
    for (const output of [
      ...relationship.outputs,
      ...relationship.jointOutputs,
      ...relationship.piecewiseCubicOutputs,
    ])
      result.set(output.outputEntityId, owner);
  }
  const shells = definition.entities.filter(
    (entity) =>
      entity.kind === "derivedPiecewiseCubic" && !result.has(entity.entityId),
  );
  const certifiedShells = new Set(
    shells.length === 0
      ? []
      : snapshot.solvedEntities.flatMap((entity) =>
          entity.kind === "derivedPiecewiseCubic" &&
          entity.publication === "certified"
            ? [entity.entityId]
            : [],
        ),
  );
  for (const entity of shells)
    if (
      entity.kind === "derivedPiecewiseCubic" &&
      !certifiedShells.has(entity.entityId)
    ) {
      // A validated shell has exactly one owning offset relationship; a
      // bare shell record (no relationship) keeps an offset owner by its
      // `derivationId`, worded by the shell's own label (T17e).
      const relationship = definition.derivedRelationships?.find(
        (candidate) => candidate.derivationId === entity.derivationId,
      );
      result.set(
        entity.entityId,
        relationship
          ? ownerOf(relationship)
          : {
              derivationId: entity.derivationId,
              kind: "offset",
              label: entity.label,
              reason: "offsetNotCertified",
            },
      );
    }
  addNonAcceptedDerivedDependents(definition, result);
  return result;
}

/**
 * T16c ([TECH] T16-7): the relationship a non-accepted output is held by,
 * and why. `offsetNotCertified`: an offset relationship that is not
 * certified (or one of its shells is not); its consumers keep the offset
 * wording and codes. `derivedFailed`: a failed (held) mirror, pattern or
 * transform relationship (the snapshot's `failedDerivationIds`); its
 * consumers name it by label (`brokenDerivedInputMessage`), with T17d
 * (B4) the reasons the solve carried for it (`failedDerivationReasons`;
 * none when the snapshot carries none). A dependent (G16‴ closure)
 * carries its source's owner.
 */
export interface NonAcceptedOutputOwner {
  readonly derivationId: string;
  readonly kind: SketchDerivationDefinition["kind"];
  readonly label: string;
  readonly reason: "offsetNotCertified" | "derivedFailed";
  readonly failureReasons?: readonly DerivedRelationshipFailureReason[];
}

/**
 * T16c ([TECH] T16-7, specification "Minimum failure feedback"): the one
 * text for geometry held by a broken relationship (an owner whose `reason`
 * is `derivedFailed`), shared by every non-acceptance consumer (edit input,
 * feature input, projection, offset publication, vector export). It names
 * the entity or driven point and the relationship by label, never by id: a
 * direct output is "a copy made by" the relationship, anything further
 * downstream "depends on" it. Then what is refused (`consequence`, e.g.
 * "it can't be used as an offset seed") and the recovery commands that
 * exist (Undo; for a mirror, T16e (review R-5): replacing its mirror line
 * or original when that repairs it, read from the reasons the solve
 * carried (T17d, B4: `owner.failureReasons`), and removal from the Mirror
 * panel).
 */
export function brokenDerivedInputMessage(
  definition: Pick<
    SketchDefinition,
    "derivedRelationships" | "entities" | "points"
  >,
  subject:
    | { readonly entityId: SketchEntityId }
    | { readonly pointId: SketchPointId },
  owner: NonAcceptedOutputOwner,
  consequence: string,
): string {
  const relationship = definition.derivedRelationships?.find(
    (candidate) => candidate.derivationId === owner.derivationId,
  );
  const outputs = relationship?.outputs ?? [];
  const named = `${RELATIONSHIP_NOUN[owner.kind].toLowerCase()} ‘${owner.label}’`;
  let held: string;
  if ("entityId" in subject) {
    const label = definition.entities.find(
      (entity) => entity.entityId === subject.entityId,
    )!.label;
    held = outputs.some((output) => output.outputEntityId === subject.entityId)
      ? `‘${label}’ is a copy made by ${named}`
      : `‘${label}’ depends on ${named}`;
  } else {
    const label = definition.points.find(
      (point) => point.pointId === subject.pointId,
    )!.label;
    held = outputs.some((output) =>
      output.outputPointIds.includes(subject.pointId),
    )
      ? `Point ‘${label}’ belongs to a copy made by ${named}`
      : `Point ‘${label}’ depends on ${named}`;
  }
  const repair =
    relationship?.kind === "mirror"
      ? mirrorRepairCommand(owner.failureReasons ?? [])
      : null;
  const recovery =
    owner.kind !== "mirror"
      ? "Fix it (Undo)."
      : repair
        ? `Fix it (Undo or ${repair}) or remove the mirror from the Mirror panel.`
        : "Fix it (Undo) or remove the mirror from the Mirror panel.";
  return `${held}, which is broken, so ${consequence}. ${recovery}`;
}

/**
 * T17e (B2, specification "Minimum failure feedback"): the one text for
 * geometry held by an offset that is not certified (an owner whose
 * `reason` is `offsetNotCertified`), shared by the same consumers as
 * `brokenDerivedInputMessage` and worded the same way: the entity or
 * driven point and the offset by label, never by id; a direct output is "a
 * curve made by" the offset, anything further downstream (a copy of it, an
 * offset of it) "depends on" it. `pending`: the offset's check is still
 * running, so the input can be used once it finishes (no recovery);
 * otherwise what is refused (`consequence`) and the recovery commands
 * (Undo, or Remove Offset in the Offset panel).
 */
export function uncertifiedOffsetInputMessage(
  definition: Pick<
    SketchDefinition,
    "derivedRelationships" | "entities" | "points"
  >,
  subject:
    | { readonly entityId: SketchEntityId }
    | { readonly pointId: SketchPointId },
  owner: NonAcceptedOutputOwner,
  consequence: string,
  pending = false,
): string {
  const relationship = definition.derivedRelationships?.find(
    (candidate) => candidate.derivationId === owner.derivationId,
  );
  const outputs =
    relationship?.kind === "offset"
      ? [
          ...relationship.outputs.map((output) => ({
            entityId: output.outputEntityId,
            pointIds: output.outputPointIds,
          })),
          ...relationship.jointOutputs.map((joint) => ({
            entityId: joint.outputEntityId,
            pointIds: [
              joint.startPointId,
              joint.endPointId,
              joint.centerPointId,
            ],
          })),
          ...relationship.piecewiseCubicOutputs.map((shell) => ({
            entityId: shell.outputEntityId,
            pointIds: [shell.startPointId, shell.endPointId],
          })),
        ]
      : [];
  const named = `offset ‘${owner.label}’`;
  let held: string;
  if ("entityId" in subject) {
    const label = definition.entities.find(
      (entity) => entity.entityId === subject.entityId,
    )!.label;
    held = outputs.some((output) => output.entityId === subject.entityId)
      ? `‘${label}’ is a curve made by ${named}`
      : `‘${label}’ depends on ${named}`;
  } else {
    const label = definition.points.find(
      (point) => point.pointId === subject.pointId,
    )!.label;
    held = outputs.some((output) => output.pointIds.includes(subject.pointId))
      ? `Point ‘${label}’ belongs to a curve made by ${named}`
      : `Point ‘${label}’ depends on ${named}`;
  }
  return pending
    ? `${held}, which is still being checked; ${consequence} once the check finishes.`
    : `${held}, which is not certified, so ${consequence}. Fix it (Undo) or remove the offset from the Offset panel.`;
}

/**
 * [TECH] G16‴: closes `result` over mirror/pattern/transform outputs and
 * (T10i, review A-1) over offsets of non-accepted seeds, to a fixed point.
 */
function addNonAcceptedDerivedDependents(
  definition: Pick<SketchDefinition, "derivedRelationships">,
  result: Map<SketchEntityId, NonAcceptedOutputOwner>,
) {
  if (result.size === 0) return;
  const derived = definition.derivedRelationships ?? [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const relationship of derived) {
      if (relationship.kind === "offset") {
        const seed = relationship.seedEntityIds.find((id) => result.has(id));
        if (seed === undefined) continue;
        const owner = result.get(seed)!;
        for (const output of [
          ...relationship.outputs,
          ...relationship.jointOutputs,
          ...relationship.piecewiseCubicOutputs,
        ]) {
          if (result.has(output.outputEntityId)) continue;
          result.set(output.outputEntityId, owner);
          changed = true;
        }
        continue;
      }
      const axis =
        relationship.kind === "mirror" &&
        relationship.mirrorReference.kind === "lineEntity"
          ? result.get(relationship.mirrorReference.entityId)
          : undefined;
      for (const output of relationship.outputs) {
        if (result.has(output.outputEntityId)) continue;
        const owner = axis ?? result.get(output.seedEntityId);
        if (!owner) continue;
        result.set(output.outputEntityId, owner);
        changed = true;
      }
    }
  }
}

/**
 * [TECH] G19b (T08b-g5c review advisory 3): the driven points of the
 * non-accepted offset outputs, by point id, each with its owning
 * relationship: a line/arc/circle output's `outputPointIds`, a joint arc's
 * start, end and center, and a shell's terminal points. They are not snap
 * candidates and are not measurable, like their outputs.
 */
export function nonAcceptedDerivedOutputPoints(
  definition: Pick<SketchDefinition, "derivedRelationships" | "entities">,
  snapshot: Pick<
    SolvedSketchSnapshot,
    | "solvedEntities"
    | "certifiedOffsetDerivationIds"
    | "failedDerivationIds"
    | "failedDerivationReasons"
  >,
): ReadonlyMap<SketchPointId, NonAcceptedOutputOwner> {
  const outputs = nonAcceptedDerivedOutputs(definition, snapshot);
  const result = new Map<SketchPointId, NonAcceptedOutputOwner>();
  if (outputs.size === 0) return result;
  for (const relationship of definition.derivedRelationships ?? []) {
    const pointsOf = (
      entityId: SketchEntityId,
      pointIds: readonly SketchPointId[],
    ) => {
      const owner = outputs.get(entityId);
      if (owner) for (const pointId of pointIds) result.set(pointId, owner);
    };
    // [TECH] G16‴: a non-accepted mirror/pattern/transform output's driven
    // points too.
    for (const output of relationship.outputs)
      pointsOf(output.outputEntityId, output.outputPointIds);
    if (relationship.kind !== "offset") continue;
    for (const joint of relationship.jointOutputs)
      pointsOf(joint.outputEntityId, [
        joint.startPointId,
        joint.endPointId,
        joint.centerPointId,
      ]);
    for (const shell of relationship.piecewiseCubicOutputs)
      pointsOf(shell.outputEntityId, [shell.startPointId, shell.endPointId]);
  }
  return result;
}

/** [TECH] G19: whether `entityId` is accepted geometry (not a non-accepted offset output). */
export function isAcceptedOffsetOutput(
  definition: Pick<SketchDefinition, "derivedRelationships" | "entities">,
  snapshot: Pick<
    SolvedSketchSnapshot,
    | "solvedEntities"
    | "certifiedOffsetDerivationIds"
    | "failedDerivationIds"
    | "failedDerivationReasons"
  >,
  entityId: SketchEntityId,
): boolean {
  return !nonAcceptedDerivedOutputs(definition, snapshot).has(entityId);
}

/**
 * [TECH] G3: the re-solve hints of a publication round, or null when no
 * relationship asks for a re-solve: the certifier's plan of every
 * `planChanged` relationship (origin `certified`, passed unchanged) and the
 * published plan of every certified one (so its frame is reproduced).
 */
export function offsetReplanHints(
  publications: readonly SketchOffsetPublicationRecord[],
): SolvedOffsetFramePlanRecord[] | null {
  if (!publications.some((publication) => publication.status === "planChanged"))
    return null;
  return publications.flatMap((publication) =>
    publication.status !== "failed" && publication.plan
      ? [{ derivationId: publication.derivationId, plan: publication.plan }]
      : [],
  );
}

/**
 * [TECH] G3 bound: a round whose solve already ran a certifier's hint (a
 * solved plan of origin `certified`, kept as given) is the ONE re-solve of
 * its edit.
 */
export function isOffsetReplanRound(snapshot: SolvedSketchSnapshot): boolean {
  return (snapshot.offsetFramePlans ?? []).some(
    (record) => record.plan.origin === "certified",
  );
}

/**
 * [TECH] G3: closes a re-solve round. A remaining `planChanged` (a
 * relationship whose frame moved under a published hint in the re-solve)
 * fails closed with a relationship-scoped diagnostic instead of asking for a
 * further re-solve.
 */
export function closeOffsetReplanRound(
  definition: DerivableSketchDefinition,
  publications: readonly SketchOffsetPublicationRecord[],
): SketchOffsetPublicationRecord[] {
  return publications.map((publication) => {
    if (publication.status !== "planChanged") return publication;
    const relationship = definition.derivedRelationships?.find(
      (candidate) => candidate.derivationId === publication.derivationId,
    );
    return {
      derivationId: publication.derivationId,
      status: "failed",
      diagnostic: publicationDiagnostic(
        OFFSET_DIAGNOSTIC_CODES.topologyUncertain,
        `${relationship ? `Offset ‘${relationship.label}’` : "An offset"}: the corner plan changed again after its one re-solve.`,
        relationship?.seedEntityIds[0] ?? null,
      ),
    };
  });
}

/**
 * Review A1: plans carried past their round (into later solves or a
 * persisted snapshot) are hints of origin `published`; a certifier's hint
 * serves exactly one re-solve, so a later disagreement re-solves once again
 * instead of failing closed.
 */
export function carriedOffsetPlans(
  plans: readonly SolvedOffsetFramePlanRecord[],
): SolvedOffsetFramePlanRecord[] {
  return plans.map((record) =>
    record.plan.origin === "certified"
      ? { ...record, plan: { ...record.plan, origin: "published" } }
      : record,
  );
}

/** The published plans of a round (origin `published`): the next solves' hints. */
export function publishedOffsetPlans(
  publications: readonly SketchOffsetPublicationRecord[],
): SolvedOffsetFramePlanRecord[] {
  return publications.flatMap((publication) =>
    publication.status === "certified" && publication.plan
      ? [{ derivationId: publication.derivationId, plan: publication.plan }]
      : [],
  );
}

/** The relationship-scoped diagnostics of a publication round ([TECH] G5/G16). */
export function offsetPublicationDiagnostics(
  publications: readonly SketchOffsetPublicationRecord[],
): SketchSolveDiagnostic[] {
  return publications.flatMap((publication) =>
    publication.diagnostic ? [publication.diagnostic] : [],
  );
}
