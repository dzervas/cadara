import type { RegionId } from "@/contracts/shared/ids";
import type {
  RegionBoundarySegmentRecord,
  RegionRecord,
} from "@/contracts/sketch/schema";

export interface AuthoredSketchRegionSlot {
  regionId: RegionId;
  /** Exact authored/projected boundary witnesses; never geometric matching data. */
  boundaryWitnesses: string[];
}

type BoundarySource = RegionBoundarySegmentRecord["source"];

function sourceKey(source: BoundarySource): string {
  return source.kind === "entity"
    ? JSON.stringify(["entity", source.entityId])
    : JSON.stringify([
        "projected",
        source.reference.referenceId,
        source.reference.geometryId,
      ]);
}

/**
 * Exact authored/projected boundary lineages for one derived region.
 *
 * Segment ordinals, traversal direction, and loop ordering are evaluator
 * output, so none names an authored slot. A witness is only a durable source
 * lineage that actually bounds this region; coincident sources are retained as
 * independent exact lineages rather than choosing one evaluator primary.
 */
export function deriveAuthoredRegionBoundaryWitnesses(
  region: RegionRecord,
  _regionUniverse: readonly RegionRecord[],
): string[] {
  return [...new Set(
    region.loops.flatMap((loop) =>
      loop.segments.flatMap((segment) => [
        sourceKey(segment.source),
        ...(segment.coincidentSources ?? []).map(sourceKey),
      ]),
    ),
  )].sort();
}

export function createAuthoredSketchRegionSlots(
  regions: readonly RegionRecord[],
): AuthoredSketchRegionSlot[] {
  return regions
    .filter((region) => region.isClosed)
    .map((region) => ({
      regionId: region.regionId,
      boundaryWitnesses: deriveAuthoredRegionBoundaryWitnesses(region, regions),
    }));
}

function addByWitness<T>(
  index: Map<string, T[]>,
  witnesses: readonly string[],
  value: T,
) {
  for (const witness of witnesses) {
    index.set(witness, [...(index.get(witness) ?? []), value]);
  }
}

function exactWitnessSetKey(witnesses: readonly string[]) {
  return JSON.stringify([...witnesses].sort());
}

function addCandidate(
  index: Map<RegionId, Set<RegionId>>,
  key: RegionId,
  value: RegionId,
) {
  const candidates = index.get(key) ?? new Set<RegionId>();
  candidates.add(value);
  index.set(key, candidates);
}

function reassociatedLoopId(regionId: RegionId, ordinal: number) {
  return `region_loop_${regionId}_${ordinal}` as RegionRecord["loops"][number]["loopId"];
}

/**
 * Restores a previous RegionId only through an exact witness exclusive to one
 * old slot and one new region. Each reassociated old/new pair must remain
 * mutually unique across every such witness; zero or conflicting candidates
 * deliberately keep the newly derived identity.
 */
export function reassociateAuthoredSketchRegionSlots(input: {
  slots: readonly AuthoredSketchRegionSlot[] | undefined;
  regions: readonly RegionRecord[];
}): RegionRecord[] {
  if (!input.slots || input.slots.length === 0) return [...input.regions];

  const currentByWitness = new Map<string, RegionRecord[]>();
  const currentByWitnessSet = new Map<string, RegionRecord[]>();
  for (const region of input.regions) {
    if (!region.isClosed) continue;
    const witnesses = deriveAuthoredRegionBoundaryWitnesses(region, input.regions);
    addByWitness(currentByWitness, witnesses, region);
    const witnessSetKey = exactWitnessSetKey(witnesses);
    currentByWitnessSet.set(witnessSetKey, [
      ...(currentByWitnessSet.get(witnessSetKey) ?? []),
      region,
    ]);
  }
  const slotsByWitness = new Map<string, AuthoredSketchRegionSlot[]>();
  const slotsByWitnessSet = new Map<string, AuthoredSketchRegionSlot[]>();
  for (const slot of input.slots) {
    addByWitness(slotsByWitness, slot.boundaryWitnesses, slot);
    const witnessSetKey = exactWitnessSetKey(slot.boundaryWitnesses);
    slotsByWitnessSet.set(witnessSetKey, [
      ...(slotsByWitnessSet.get(witnessSetKey) ?? []),
      slot,
    ]);
  }

  const currentCandidates = new Map<RegionId, Set<RegionId>>();
  const slotCandidates = new Map<RegionId, Set<RegionId>>();
  for (const [witnessSetKey, current] of currentByWitnessSet) {
    const slots = slotsByWitnessSet.get(witnessSetKey) ?? [];
    if (current.length !== 1 || slots.length !== 1) continue;
    addCandidate(currentCandidates, current[0]!.regionId, slots[0]!.regionId);
    addCandidate(slotCandidates, slots[0]!.regionId, current[0]!.regionId);
  }
  for (const [witness, current] of currentByWitness) {
    const slots = slotsByWitness.get(witness) ?? [];
    if (current.length !== 1 || slots.length !== 1) continue;
    const currentId = current[0]!.regionId;
    const slotId = slots[0]!.regionId;
    addCandidate(currentCandidates, currentId, slotId);
    addCandidate(slotCandidates, slotId, currentId);
  }

  const replacementByCurrentId = new Map<RegionId, RegionId>();
  for (const [currentId, slots] of currentCandidates) {
    if (slots.size !== 1) continue;
    const slotId = slots.values().next().value as RegionId;
    if (slotCandidates.get(slotId)?.size === 1) {
      replacementByCurrentId.set(currentId, slotId);
    }
  }
  return input.regions.map((region) => {
    const regionId = replacementByCurrentId.get(region.regionId);
    if (!regionId) return region;
    return {
      ...region,
      regionId,
      target: { ...region.target, regionId },
      loops: region.loops.map((loop, ordinal) => ({
        ...loop,
        loopId: reassociatedLoopId(regionId, ordinal),
      })),
    };
  });
}
