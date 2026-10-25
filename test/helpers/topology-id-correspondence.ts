// Cross-path comparisons (an in-session rebuild vs a cold open of the same
// authored document) for heavy OCC specs. Both forms of an unwitnessed
// subtopology's id are valid persisted forms: a restore keeps an output it
// reproduces exactly, native hash ids included, while an in-session rebuild
// always re-mints those ids as `…_tNNNN_i` (cadara-phi0). These helpers pair
// one evaluation's ids with the other's by structural position, so a hash id
// and a minted id at the same position compare equal while a missing, extra
// or duplicated id, or any other renaming (hash vs different hash), still
// fails.
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";

interface TopologyIds {
  faceIds: readonly string[];
  edgeIds: readonly string[];
  vertexIds: readonly string[];
}

/** An evaluation's topology ids by position: snapshot bodies, and the lineage outputs of `document` when given. */
export interface TopologyIdSource {
  snapshot: Pick<WorkspaceSnapshot, "document">;
  document?: Pick<AuthoredModelDocument, "topologyLineage">;
}

const mintedTopologyIdPattern = /_t\d+_\d+$/;

function topologyIdsByPosition(source: TopologyIdSource) {
  const ids = new Map<string, TopologyIds>();
  for (const body of source.snapshot.document.bodies) {
    ids.set(`body ${body.bodyId}`, body.topology);
  }
  for (const record of source.document?.topologyLineage ?? []) {
    for (const output of record.outputs) {
      ids.set(
        `lineage ${record.featureId} ${output.outputSlot}`,
        output.topology,
      );
    }
  }
  return ids;
}

/**
 * Maps `from`'s face/edge/vertex ids onto `to`'s by position (per body and per
 * lineage output, per kind, per index). Throws unless both sides have the same
 * positions, each position pairs its ids one to one, every `from` id maps to
 * a single `to` id, and every pair of different ids has the minted form
 * (`…_tNNNN_i`) on at least one side. Across positions several `from` ids may map to one `to`
 * id: a restore carries a kept id through later stages where a rebuild mints
 * one per stage (e.g. wheel extrude-1 `…_t0002_1` and chamfer-1 `…_t0003_1`
 * vs one hash id).
 */
export function createTopologyIdCorrespondence(
  from: TopologyIdSource,
  to: TopologyIdSource,
): ReadonlyMap<string, string> {
  const fromIds = topologyIdsByPosition(from);
  const toIds = topologyIdsByPosition(to);
  const positions = [...fromIds.keys()].sort();
  if (positions.join("\n") !== [...toIds.keys()].sort().join("\n")) {
    throw new Error(
      `Topology positions differ: ${positions.join(", ")} vs ${[...toIds.keys()].sort().join(", ")}.`,
    );
  }
  const forward = new Map<string, string>();
  for (const position of positions) {
    for (const kind of ["faceIds", "edgeIds", "vertexIds"] as const) {
      const left = fromIds.get(position)![kind];
      const right = toIds.get(position)![kind];
      if (
        left.length !== right.length ||
        new Set(left).size !== left.length ||
        new Set(right).size !== right.length
      ) {
        throw new Error(
          `${position}: ${kind} do not pair one to one (${left.length} vs ${right.length}).`,
        );
      }
      left.forEach((id, index) => {
        const target = right[index]!;
        if (
          id !== target &&
          !mintedTopologyIdPattern.test(id) &&
          !mintedTopologyIdPattern.test(target)
        ) {
          throw new Error(
            `${position}: ${kind} ${id} and ${target} differ but neither has the minted form.`,
          );
        }
        const mapped = forward.get(id);
        if (mapped !== undefined && mapped !== target) {
          throw new Error(
            `${position}: ${kind} ${id} maps to both ${mapped} and ${target}.`,
          );
        }
        forward.set(id, target);
      });
    }
  }
  return forward;
}

/** Renames every id of `correspondence` in serialized `text`, including the sanitized copies embedded in snapshot entity ids. */
export function renameTopologyIds(
  text: string,
  correspondence: ReadonlyMap<string, string>,
) {
  const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9]+/g, "_");
  const renames = new Map<string, string>();
  for (const [from, to] of correspondence) {
    if (from === to) continue;
    renames.set(from, to);
    renames.set(sanitize(from), sanitize(to));
  }
  if (renames.size === 0) return text;
  // One pass over id-like tokens, so a renamed id is never renamed again. A
  // sanitized entity id embeds the sanitized id as its suffix.
  return text.replace(
    /(?<![A-Za-z0-9])(?:face|edge|vertex)_[A-Za-z0-9_-]*[A-Za-z0-9]/g,
    (token) => {
      for (const { index } of token.matchAll(
        /(?<=^|_)(?:face|edge|vertex)_/g,
      )) {
        const renamed = renames.get(token.slice(index));
        if (renamed !== undefined) return token.slice(0, index) + renamed;
      }
      return token;
    },
  );
}
