export type PerformanceSpanResult = 'success' | 'failure' | 'rejected' | 'conflict' | 'blocked' | 'cancelled'

export type PerformanceSpanAttributeValue = string | number | boolean | null

export type PerformanceSpanAttributeName =
  | 'cadara.asset_availability_count'
  | 'cadara.body_count'
  | 'cadara.canvas_created'
  | 'cadara.constraint_count'
  | 'cadara.constraint_state'
  | 'cadara.diagnostic_count'
  | 'cadara.dimension_count'
  | 'cadara.disposed'
  | 'cadara.drag_accepted_update_count'
  | 'cadara.drag_blocked_update_count'
  | 'cadara.drag_max_update_ms'
  | 'cadara.drag_update_count'
  | 'cadara.duration_ms'
  | 'cadara.entity_count'
  | 'cadara.error_message'
  | 'cadara.error_name'
  | 'cadara.feature_count'
  | 'cadara.operation'
  | 'cadara.point_count'
  | 'cadara.projected_reference_count'
  | 'cadara.render_record_count'
  | 'cadara.repository_head_count'
  | 'cadara.repository_source'
  | 'cadara.result'
  | 'cadara.seam'
  | 'cadara.sketch_count'
  | 'cadara.sketch_operation_count'
  | 'cadara.solve_state'
  | 'cadara.startup_phase'
  | 'cadara.storage_kind'
  | 'cadara.warm_started'

export type PerformanceSpanAttributes = Partial<Record<PerformanceSpanAttributeName, PerformanceSpanAttributeValue>>

export interface PerformanceSpanDescriptor {
  name: string
  op: string
  attributes?: PerformanceSpanAttributes
}

export interface PerformanceSpan {
  setAttribute(name: PerformanceSpanAttributeName, value: PerformanceSpanAttributeValue | undefined): void
  setAttributes(attributes: PerformanceSpanAttributes): void
  end(attributes?: PerformanceSpanAttributes): void
}

export interface PerformanceTelemetry {
  startSpan(descriptor: PerformanceSpanDescriptor): PerformanceSpan
}

export const allowedPerformanceSpanAttributes = new Set<PerformanceSpanAttributeName>([
  'cadara.asset_availability_count',
  'cadara.body_count',
  'cadara.canvas_created',
  'cadara.constraint_count',
  'cadara.constraint_state',
  'cadara.diagnostic_count',
  'cadara.dimension_count',
  'cadara.disposed',
  'cadara.drag_accepted_update_count',
  'cadara.drag_blocked_update_count',
  'cadara.drag_max_update_ms',
  'cadara.drag_update_count',
  'cadara.duration_ms',
  'cadara.entity_count',
  'cadara.error_message',
  'cadara.error_name',
  'cadara.feature_count',
  'cadara.operation',
  'cadara.point_count',
  'cadara.projected_reference_count',
  'cadara.render_record_count',
  'cadara.repository_head_count',
  'cadara.repository_source',
  'cadara.result',
  'cadara.seam',
  'cadara.sketch_count',
  'cadara.sketch_operation_count',
  'cadara.solve_state',
  'cadara.startup_phase',
  'cadara.storage_kind',
  'cadara.warm_started',
])

const noopSpan: PerformanceSpan = {
  setAttribute() {
    return undefined
  },
  setAttributes() {
    return undefined
  },
  end() {
    return undefined
  },
}

export const noopPerformanceTelemetry: PerformanceTelemetry = {
  startSpan() {
    return noopSpan
  },
}

export function isAllowedPerformanceSpanAttribute(name: string): name is PerformanceSpanAttributeName {
  return allowedPerformanceSpanAttributes.has(name as PerformanceSpanAttributeName)
}

export function filterPerformanceSpanAttributes(
  attributes: Record<string, PerformanceSpanAttributeValue | undefined> | null | undefined,
): PerformanceSpanAttributes {
  const filtered: PerformanceSpanAttributes = {}

  if (!attributes) {
    return filtered
  }

  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || !isAllowedPerformanceSpanAttribute(name)) {
      continue
    }
    filtered[name] = value
  }

  return filtered
}

export function classifyOkResult(result: unknown): PerformanceSpanResult {
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    return (result as { ok?: unknown }).ok === false ? 'failure' : 'success'
  }

  return 'success'
}

export function classifyRevisionResult(result: unknown): PerformanceSpanResult {
  const revisionState = typeof result === 'object' && result !== null && 'revisionState' in result
    ? (result as { revisionState?: { kind?: unknown } }).revisionState
    : null

  if (revisionState?.kind === 'rejected') {
    return 'rejected'
  }

  if (revisionState?.kind === 'conflict') {
    return 'conflict'
  }

  return classifyOkResult(result)
}

export async function measurePerformanceSpan<T>(input: {
  telemetry: PerformanceTelemetry
  descriptor: PerformanceSpanDescriptor
  action: () => Promise<T>
  classifyResult?: (result: T) => PerformanceSpanResult
  resultAttributes?: (result: T) => PerformanceSpanAttributes
}): Promise<T> {
  const startedAt = getPerformanceNow()
  const span = input.telemetry.startSpan(input.descriptor)

  try {
    const result = await input.action()
    const resultClassification = input.classifyResult?.(result) ?? 'success'
    span.end({
      ...input.resultAttributes?.(result),
      'cadara.duration_ms': roundDuration(getPerformanceNow() - startedAt),
      'cadara.result': resultClassification,
    })
    return result
  } catch (error) {
    span.end({
      'cadara.duration_ms': roundDuration(getPerformanceNow() - startedAt),
      'cadara.result': 'failure',
      'cadara.error_name': error instanceof Error ? error.name : typeof error,
      'cadara.error_message': error instanceof Error ? error.message : 'Unknown error',
    })
    throw error
  }
}

export function recordPerformanceMark(
  telemetry: PerformanceTelemetry,
  descriptor: PerformanceSpanDescriptor,
  attributes: PerformanceSpanAttributes = {},
) {
  telemetry.startSpan(descriptor).end({
    ...attributes,
    'cadara.duration_ms': 0,
    'cadara.result': attributes['cadara.result'] ?? 'success',
  })
}

function getPerformanceNow() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function roundDuration(durationMs: number) {
  return Number(durationMs.toFixed(2))
}
