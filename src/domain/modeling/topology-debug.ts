import type { ReferenceRecord, WorkspaceSnapshot } from '@/contracts/modeling/schema'

type TopologyKind = 'face' | 'edge' | 'vertex'

export interface TopologyDebugBodySummary {
  bodyId: string
  label: string
  faces: number
  edges: number
  vertices: number
  liveReferences: number
  invalidatedReferences: number
}

export interface TopologyDebugInvalidationSummary {
  reason: string
  count: number
  examples: readonly string[]
}

export interface TopologyDebugSummary {
  bodyCount: number
  liveTopologyReferences: number
  invalidatedTopologyReferences: number
  bodies: readonly TopologyDebugBodySummary[]
  invalidations: readonly TopologyDebugInvalidationSummary[]
}

function isTopologyReference(reference: ReferenceRecord): reference is ReferenceRecord & { target: { kind: TopologyKind; bodyId: string } } {
  return reference.target.kind === 'face'
    || reference.target.kind === 'edge'
    || reference.target.kind === 'vertex'
}

function formatTopologyTarget(reference: ReferenceRecord) {
  switch (reference.target.kind) {
    case 'face':
      return `${reference.target.bodyId}.${reference.target.faceId}`
    case 'edge':
      return `${reference.target.bodyId}.${reference.target.edgeId}`
    case 'vertex':
      return `${reference.target.bodyId}.${reference.target.vertexId}`
    default:
      return reference.label
  }
}

export function createTopologyDebugSummary(snapshot: WorkspaceSnapshot | null): TopologyDebugSummary {
  if (!snapshot) {
    return {
      bodyCount: 0,
      liveTopologyReferences: 0,
      invalidatedTopologyReferences: 0,
      bodies: [],
      invalidations: [],
    }
  }

  const topologyReferences = snapshot.document.references.filter(isTopologyReference)
  const liveTopologyReferences = topologyReferences.filter((reference) => reference.invalidation === null)
  const invalidatedTopologyReferences = topologyReferences.filter((reference) => reference.invalidation !== null)
  const invalidationsByReason = new Map<string, ReferenceRecord[]>()

  for (const reference of invalidatedTopologyReferences) {
    const reason = reference.invalidation?.reason ?? 'unknown'
    invalidationsByReason.set(reason, [...(invalidationsByReason.get(reason) ?? []), reference])
  }

  return {
    bodyCount: snapshot.document.bodies.length,
    liveTopologyReferences: liveTopologyReferences.length,
    invalidatedTopologyReferences: invalidatedTopologyReferences.length,
    bodies: snapshot.document.bodies.map((body) => {
      const bodyReferences = topologyReferences.filter((reference) => reference.target.bodyId === body.bodyId)

      return {
        bodyId: body.bodyId,
        label: body.label,
        faces: body.topology.faceIds.length,
        edges: body.topology.edgeIds.length,
        vertices: body.topology.vertexIds.length,
        liveReferences: bodyReferences.filter((reference) => reference.invalidation === null).length,
        invalidatedReferences: bodyReferences.filter((reference) => reference.invalidation !== null).length,
      }
    }),
    invalidations: [...invalidationsByReason.entries()]
      .map(([reason, references]) => ({
        reason,
        count: references.length,
        examples: references.slice(0, 3).map(formatTopologyTarget),
      }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  }
}
