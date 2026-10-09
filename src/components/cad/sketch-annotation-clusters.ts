import type { SketchEntityId } from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { type PrimitiveRef, getPrimitiveRefKey } from "@/core/editor/schema";
import { getSketchEntityDefiningPointIds } from "@/domain/editor/sketch-session";
import type {
  SketchConstraintRef,
  SketchDimensionRef,
} from "@/contracts/shared/references";
import { annotationTargetsEqual } from "@/components/cad/sketch-constraint-annotation-visibility";
import {
  SKETCH_ANNOTATION_GLYPH_SIZE_PX,
  getAnnotationProjectionId,
  layoutSketchAnnotations,
  type SketchAnnotationLayoutItem,
  type SketchAnnotationLayoutObstacle,
  type SketchAnnotationLayoutViewport,
  type SketchAnnotationPlacement,
} from "@/components/cad/sketch-viewport-feedback-model";

/**
 * T14f (T-9): constraint glyphs whose pre-layout anchors are within 40 px of
 * each other (single linkage: glyph 32 + gap 6, rounded) form one cluster.
 */
export const SKETCH_ANNOTATION_CLUSTER_LINK_PX = 40;
/** A-4: a cluster's diameter (largest anchor distance) is capped at 120 px. */
export const SKETCH_ANNOTATION_CLUSTER_MAX_DIAMETER_PX = 120;
/** A-5: the dense limit drops to 2 below this context extent… */
export const SKETCH_ANNOTATION_DENSE_LIMIT_LOW_EXTENT_PX = 150;
/** …and returns to 4 above this one; in between the previous limit stays. */
export const SKETCH_ANNOTATION_DENSE_LIMIT_HIGH_EXTENT_PX = 170;
/** T-9: a fresh context (no previous limit) takes K = 2 below this extent. */
export const SKETCH_ANNOTATION_DENSE_LIMIT_EXTENT_PX = 160;

/** At most this many glyphs of one cluster are expanded. */
export type SketchAnnotationDenseLimit = 2 | 4;
export const SKETCH_ANNOTATION_DEFAULT_DENSE_LIMIT: SketchAnnotationDenseLimit = 4;

/**
 * Pinned glyphs and hover previews cluster separately, each with its own
 * dense limit, so a hover never changes which pinned glyphs are expanded.
 */
export type SketchAnnotationClusterGroup = "pinned" | "preview";

/**
 * A-5: K = 2 when the context's screen extent is small, K = 4 otherwise, with
 * hysteresis inside one context: 2 below 150 px, 4 above 170 px, the
 * `previous` limit in between. A fresh context (`previous` null) takes the
 * T-9 rule (2 below 160 px). An unknown extent keeps the context's previous
 * limit, or is 4 in a fresh context.
 */
export function resolveSketchAnnotationDenseLimit(
  extentPx: number | null,
  previous: SketchAnnotationDenseLimit | null,
): SketchAnnotationDenseLimit {
  if (extentPx === null) {
    return previous ?? SKETCH_ANNOTATION_DEFAULT_DENSE_LIMIT;
  }
  if (previous === null) {
    return extentPx < SKETCH_ANNOTATION_DENSE_LIMIT_EXTENT_PX ? 2 : 4;
  }
  if (extentPx < SKETCH_ANNOTATION_DENSE_LIMIT_LOW_EXTENT_PX) {
    return 2;
  }
  if (extentPx > SKETCH_ANNOTATION_DENSE_LIMIT_HIGH_EXTENT_PX) {
    return 4;
  }
  return previous;
}

/**
 * T-9: the context's screen extent, the largest screen bounding-box diagonal
 * (`entityExtents`, keyed by primitive ref key) over the owners' entities. A
 * point owner contributes its incident entities, a tangent handle its spline;
 * other owners (regions, datums, images) contribute nothing. Null when no
 * owner has a measured extent.
 */
export function getSketchAnnotationContextExtent(
  owners: readonly PrimitiveRef[],
  definition: SketchDefinition | null,
  entityExtents: ReadonlyMap<string, number>,
): number | null {
  const entityKeys = new Set<string>();
  let incidentEntities: Map<string, SketchEntityId[]> | null = null;
  const getIncidentEntityIds = (pointId: string) => {
    if (!incidentEntities) {
      incidentEntities = new Map();
      for (const entity of definition?.entities ?? []) {
        for (const definingPointId of getSketchEntityDefiningPointIds(
          definition!,
          entity.entityId,
        )) {
          incidentEntities.set(definingPointId, [
            ...(incidentEntities.get(definingPointId) ?? []),
            entity.entityId,
          ]);
        }
      }
    }
    return incidentEntities.get(pointId) ?? [];
  };
  for (const owner of owners) {
    switch (owner.kind) {
      case "sketchEntity":
      case "projectedReferenceGeometry":
        entityKeys.add(getPrimitiveRefKey(owner));
        break;
      case "sketchTangentHandle":
        entityKeys.add(
          getPrimitiveRefKey({
            kind: "sketchEntity",
            sketchId: owner.sketchId,
            entityId: owner.entityId,
          }),
        );
        break;
      case "sketchPoint":
        for (const entityId of getIncidentEntityIds(owner.pointId)) {
          entityKeys.add(
            getPrimitiveRefKey({
              kind: "sketchEntity",
              sketchId: owner.sketchId,
              entityId,
            }),
          );
        }
        break;
      default:
        break;
    }
  }

  let extent: number | null = null;
  for (const key of entityKeys) {
    const entityExtent = entityExtents.get(key);
    if (entityExtent !== undefined) {
      extent = Math.max(extent ?? 0, entityExtent);
    }
  }
  return extent;
}

export interface SketchAnnotationClusterItem {
  id: string;
  anchor: { x: number; y: number };
  /** The active or last annotation: counts toward K and is always expanded. */
  mustExpand: boolean;
}

export interface SketchAnnotationCluster {
  /** The cluster's lowest member id: stable while its members are. */
  key: string;
  /** Member ids in stable (id) order. */
  memberIds: readonly string[];
  /** The membership (`getSketchAnnotationClusterSignature`). */
  signature: string;
  expandedIds: readonly string[];
  collapsedIds: readonly string[];
  /** The centroid of the members' anchors (the `+N` chip's layout anchor). */
  anchor: { x: number; y: number };
}

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

/** A cluster's membership: its sorted member ids. */
export function getSketchAnnotationClusterSignature(
  memberIds: readonly string[],
) {
  return [...memberIds].sort(compareIds).join("\n");
}

/** Per cluster membership, the glyphs the previous render expanded. */
export type SketchAnnotationPreferredExpansion = ReadonlyMap<
  string,
  readonly string[]
>;

/**
 * T-9 / A-4: clusters glyphs by single linkage of their anchors within 40 px,
 * greedily in stable (id) order: a cluster grows from its lowest unassigned
 * id by every glyph linked to it that keeps its diameter within 120 px, and
 * the next cluster starts from the next unassigned id. Each cluster expands
 * at most `limit` glyphs: its active/last glyphs first (always), then the
 * glyphs the previous render expanded in a cluster of exactly the same
 * membership (`preferredExpanded`, so a click that only changes which glyph
 * is active or last never swaps the others), then the rest by id. A changed
 * membership (a delete, Undo/Redo, a zoom that re-forms the cluster) uses
 * the stateless rule (review R-2). Pure, and translation invariant.
 */
export function clusterSketchAnnotations(
  items: readonly SketchAnnotationClusterItem[],
  limit: SketchAnnotationDenseLimit,
  preferredExpanded: SketchAnnotationPreferredExpansion = new Map(),
): SketchAnnotationCluster[] {
  const remaining = [...items].sort((left, right) =>
    compareIds(left.id, right.id),
  );
  const distance = (
    left: SketchAnnotationClusterItem,
    right: SketchAnnotationClusterItem,
  ) =>
    Math.hypot(left.anchor.x - right.anchor.x, left.anchor.y - right.anchor.y);
  const clusters: SketchAnnotationCluster[] = [];

  while (remaining.length > 0) {
    const members = [remaining.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let index = 0; index < remaining.length; ) {
        const candidate = remaining[index]!;
        if (
          members.some(
            (member) =>
              distance(member, candidate) <= SKETCH_ANNOTATION_CLUSTER_LINK_PX,
          ) &&
          members.every(
            (member) =>
              distance(member, candidate) <=
              SKETCH_ANNOTATION_CLUSTER_MAX_DIAMETER_PX,
          )
        ) {
          members.push(candidate);
          remaining.splice(index, 1);
          grew = true;
        } else {
          index += 1;
        }
      }
    }
    members.sort((left, right) => compareIds(left.id, right.id));
    const signature = getSketchAnnotationClusterSignature(
      members.map((member) => member.id),
    );
    const preferred = new Set(preferredExpanded.get(signature) ?? []);

    const required = members.filter((member) => member.mustExpand);
    const optional = members.filter((member) => !member.mustExpand);
    const fill = [
      ...optional.filter((member) => preferred.has(member.id)),
      ...optional.filter((member) => !preferred.has(member.id)),
    ].slice(0, Math.max(0, limit - required.length));
    const expanded = new Set([...required, ...fill].map((member) => member.id));

    clusters.push({
      key: members[0]!.id,
      memberIds: members.map((member) => member.id),
      signature,
      expandedIds: members
        .filter((member) => expanded.has(member.id))
        .map((member) => member.id),
      collapsedIds: members
        .filter((member) => !expanded.has(member.id))
        .map((member) => member.id),
      anchor: {
        x:
          members.reduce((total, member) => total + member.anchor.x, 0) /
          members.length,
        y:
          members.reduce((total, member) => total + member.anchor.y, 0) /
          members.length,
      },
    });
  }

  return clusters;
}

export interface SketchAnnotationClusterLayoutItem extends SketchAnnotationLayoutItem {
  /** Null: never clustered (dimensions and problems). */
  cluster: { group: SketchAnnotationClusterGroup; mustExpand: boolean } | null;
}

/** One `+N` chip: the cluster's collapsed glyphs plus any the layout dropped. */
export interface SketchAnnotationOverflowChip {
  /** Its layout id (`cluster:<group>:<key>`). */
  id: string;
  group: SketchAnnotationClusterGroup;
  key: string;
  count: number;
  x: number;
  y: number;
}

export function getSketchAnnotationOverflowChipId(
  group: SketchAnnotationClusterGroup,
  key: string,
) {
  return `cluster:${group}:${key}`;
}

/**
 * T-9: clusters the clusterable items per group, lays out the expanded glyphs
 * and one `+N` chip per collapsed cluster (a 32 px label at the cluster's
 * centroid with the plan's `+N` rank, below pinned glyphs and dimensions and
 * above hover previews (T-8), kept even when no candidate is free), and folds every expanded glyph the layout's ring cap dropped into
 * its cluster's `+N` (a cluster that had none gets one, then the pass
 * repeats), so no glyph of a cluster disappears silently.
 */
export function layoutSketchAnnotationClusters(
  items: readonly SketchAnnotationClusterLayoutItem[],
  limits: Readonly<
    Record<SketchAnnotationClusterGroup, SketchAnnotationDenseLimit>
  >,
  preferredExpanded: SketchAnnotationPreferredExpansion,
  viewport: SketchAnnotationLayoutViewport,
  obstacles: readonly SketchAnnotationLayoutObstacle[],
): {
  placements: ReadonlyMap<string, SketchAnnotationPlacement>;
  chips: readonly SketchAnnotationOverflowChip[];
  /** Every cluster's expanded ids by membership (the next render's `preferredExpanded`). */
  expanded: SketchAnnotationPreferredExpansion;
} {
  const clusters = (["pinned", "preview"] as const).flatMap((group) =>
    clusterSketchAnnotations(
      items.flatMap((item) =>
        item.cluster?.group === group
          ? [
              {
                id: item.id,
                anchor: item.anchor,
                mustExpand: item.cluster.mustExpand,
              },
            ]
          : [],
      ),
      limits[group],
      preferredExpanded,
    ).map((cluster) => ({ group, cluster })),
  );
  const collapsed = new Set(
    clusters.flatMap(({ cluster }) => cluster.collapsedIds),
  );
  const shown = items.filter((item) => !collapsed.has(item.id));
  const withChip = new Set(
    clusters.flatMap(({ cluster }, index) =>
      cluster.collapsedIds.length > 0 ? [index] : [],
    ),
  );

  for (;;) {
    const chipItems = clusters.flatMap(({ group, cluster }, index) =>
      withChip.has(index)
        ? [
            {
              id: getSketchAnnotationOverflowChipId(group, cluster.key),
              anchor: cluster.anchor,
              width: SKETCH_ANNOTATION_GLYPH_SIZE_PX,
              height: SKETCH_ANNOTATION_GLYPH_SIZE_PX,
              priority: "overflow",
              keepWhenUnplaceable: true,
            } satisfies SketchAnnotationLayoutItem,
          ]
        : [],
    );
    const placements = new Map(
      layoutSketchAnnotations(
        [...shown, ...chipItems],
        viewport,
        obstacles,
      ).map((placement) => [placement.id, placement]),
    );
    const dropped = clusters.map(
      ({ cluster }) =>
        cluster.expandedIds.filter((id) => !placements.has(id)).length,
    );
    const needChip = dropped.flatMap((count, index) =>
      count > 0 && !withChip.has(index) ? [index] : [],
    );

    if (needChip.length === 0) {
      return {
        placements,
        chips: clusters.flatMap(({ group, cluster }, index) => {
          const id = getSketchAnnotationOverflowChipId(group, cluster.key);
          const placement = placements.get(id);
          return withChip.has(index) && placement
            ? [
                {
                  id,
                  group,
                  key: cluster.key,
                  count: cluster.collapsedIds.length + dropped[index]!,
                  x: placement.x,
                  y: placement.y,
                },
              ]
            : [];
        }),
        expanded: new Map(
          clusters.map(({ cluster }) => [
            cluster.signature,
            cluster.expandedIds,
          ]),
        ),
      };
    }
    for (const index of needChip) {
      withChip.add(index);
    }
  }
}

/**
 * Review R-1: the hovered annotation renders as a control but has no placed
 * label (collapsed into a `+N`, or dropped by the ring cap). Its button is
 * gone without a pointer leave, so its hover (and linked highlight) is stale.
 */
export function isSketchAnnotationHoverUnplaced(
  hovered: SketchConstraintRef | SketchDimensionRef | null,
  items: readonly {
    annotation: {
      id: string;
      target: SketchConstraintRef | SketchDimensionRef;
    };
    isInteractive: boolean;
  }[],
  placements: ReadonlyMap<string, unknown>,
) {
  const item = hovered
    ? items.find(
        (entry) =>
          entry.isInteractive &&
          annotationTargetsEqual(hovered, entry.annotation.target),
      )
    : undefined;
  return (
    item !== undefined &&
    !placements.has(getAnnotationProjectionId(item.annotation.id))
  );
}
