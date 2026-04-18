import { err, ok, ResultAsync, type Result } from 'neverthrow'
import type { ZodError } from 'zod'

import type { ModelingDiagnostic } from '@/contracts/modeling/schema'
import type { RequestId } from '@/contracts/shared/ids'
import type { DurableRef } from '@/contracts/shared/references'

export type AppErrorSeverity = 'info' | 'warning' | 'error' | 'fatal'

export type AppErrorCode =
  | 'app/unknown'
  | 'app/operation-failed'
  | 'app/validation-failed'
  | 'modeling/diagnostic'
  | 'modeling/revision-rejected'
  | 'editor/effect-failed'
  | 'editor/invocation-failed'
  | 'workbench/action-failed'
  | 'render/crash'

export interface AppErrorContextEntry {
  key: string
  value: string | number | boolean | null
}

export interface AppError {
  code: AppErrorCode
  severity: AppErrorSeverity
  message: string
  context: AppErrorContextEntry[]
  cause?: unknown
  requestId?: RequestId
  target?: DurableRef | null
  recoverable?: boolean
}

export type AppResult<T> = Result<T, AppError>
export type AppResultAsync<T> = ResultAsync<T, AppError>

export { err, ok, ResultAsync }
export type { Result }

const appErrorMarker = Symbol.for('cadara.appError')

type MarkedAppError = AppError & { [appErrorMarker]?: true }

export function isAppError(value: unknown): value is AppError {
  const candidate = value as MarkedAppError

  return (
    typeof value === 'object'
    && value !== null
    && candidate[appErrorMarker] === true
    && typeof candidate.code === 'string'
    && typeof candidate.severity === 'string'
    && typeof candidate.message === 'string'
    && Array.isArray(candidate.context)
  )
}

export function createAppError(input: {
  code: AppErrorCode
  message: string
  severity?: AppErrorSeverity
  context?: readonly AppErrorContextEntry[]
  cause?: unknown
  requestId?: RequestId
  target?: DurableRef | null
  recoverable?: boolean
}): AppError {
  return {
    [appErrorMarker]: true,
    code: input.code,
    severity: input.severity ?? 'error',
    message: input.message,
    context: [...(input.context ?? [])],
    cause: input.cause,
    requestId: input.requestId,
    target: input.target,
    recoverable: input.recoverable ?? true,
  } as MarkedAppError
}

export function errorContext(
  key: string,
  value: AppErrorContextEntry['value'] | undefined,
): AppErrorContextEntry[] {
  return value === undefined ? [] : [{ key, value }]
}

export function appendErrorContext(
  appError: AppError,
  context: readonly AppErrorContextEntry[],
): AppError {
  return createAppError({
    ...appError,
    context: [...appError.context, ...context],
  })
}

export function normalizeUnknownError(
  value: unknown,
  input: {
    fallbackMessage: string
    code?: AppErrorCode
    severity?: AppErrorSeverity
    context?: readonly AppErrorContextEntry[]
    requestId?: RequestId
    target?: DurableRef | null
    recoverable?: boolean
  },
): AppError {
  if (isAppError(value)) {
    return createAppError({
      ...value,
      context: [...value.context, ...(input.context ?? [])],
      requestId: input.requestId ?? value.requestId,
      target: input.target ?? value.target,
    })
  }

  const message =
    value instanceof Error && value.message.trim()
      ? value.message
      : input.fallbackMessage

  return createAppError({
    code: input.code ?? 'app/unknown',
    severity: input.severity ?? 'error',
    message,
    context: input.context,
    cause: value,
    requestId: input.requestId,
    target: input.target,
    recoverable: input.recoverable,
  })
}

export function appErrorFromZodError(
  zodError: ZodError,
  input: {
    operation: string
    fallbackMessage?: string
    requestId?: RequestId
    context?: readonly AppErrorContextEntry[]
  },
): AppError {
  const firstIssue = zodError.issues[0]
  const path = firstIssue?.path.join('.') ?? null

  return createAppError({
    code: 'app/validation-failed',
    message: firstIssue?.message ?? input.fallbackMessage ?? `${input.operation} validation failed.`,
    context: [
      { key: 'operation', value: input.operation },
      ...errorContext('path', path),
      ...errorContext('issueCount', zodError.issues.length),
      ...(input.context ?? []),
    ],
    cause: zodError,
    requestId: input.requestId,
    recoverable: true,
  })
}

export function appErrorFromModelingDiagnostic(
  diagnostic: ModelingDiagnostic,
  input: {
    operation: string
    requestId?: RequestId
    context?: readonly AppErrorContextEntry[]
  },
): AppError {
  return createAppError({
    code: 'modeling/diagnostic',
    severity: diagnostic.severity,
    message: diagnostic.message,
    context: [
      { key: 'operation', value: input.operation },
      { key: 'diagnosticCode', value: diagnostic.code },
      ...errorContext('diagnosticDetail', diagnostic.detail ? diagnostic.detail.kind : null),
      ...(input.context ?? []),
    ],
    requestId: input.requestId,
    target: diagnostic.target,
    recoverable: true,
  })
}

export function appErrorFromModelingResult(
  input: {
    operation: string
    fallbackMessage: string
    diagnostics: readonly ModelingDiagnostic[]
    revisionState?: { kind: string; reasonCode?: string; actualRevisionId?: string }
    requestId?: RequestId
    context?: readonly AppErrorContextEntry[]
  },
): AppError {
  const primaryDiagnostic = input.diagnostics[0]

  if (primaryDiagnostic) {
    return appErrorFromModelingDiagnostic(primaryDiagnostic, {
      operation: input.operation,
      requestId: input.requestId,
      context: [
        ...errorContext('revisionState', input.revisionState?.kind),
        ...errorContext('reasonCode', input.revisionState?.reasonCode),
        ...errorContext('actualRevisionId', input.revisionState?.actualRevisionId),
        { key: 'diagnosticCount', value: input.diagnostics.length },
        ...(input.context ?? []),
      ],
    })
  }

  return createAppError({
    code: 'modeling/revision-rejected',
    message: input.fallbackMessage,
    context: [
      { key: 'operation', value: input.operation },
      ...errorContext('revisionState', input.revisionState?.kind),
      ...errorContext('reasonCode', input.revisionState?.reasonCode),
      ...errorContext('actualRevisionId', input.revisionState?.actualRevisionId),
      ...(input.context ?? []),
    ],
    requestId: input.requestId,
    recoverable: true,
  })
}

export function fallbackOperationError(input: {
  operation: string
  fallbackMessage: string
  context?: readonly AppErrorContextEntry[]
  requestId?: RequestId
  target?: DurableRef | null
}): AppError {
  return createAppError({
    code: 'app/operation-failed',
    message: input.fallbackMessage,
    context: [
      { key: 'operation', value: input.operation },
      ...(input.context ?? []),
    ],
    requestId: input.requestId,
    target: input.target,
    recoverable: true,
  })
}

export function appErrorToModelingDiagnostic(
  appError: AppError,
  input?: {
    target?: DurableRef | null
    code?: string
  },
): ModelingDiagnostic {
  return {
    code: input?.code ?? appError.code,
    severity: appError.severity === 'fatal' ? 'error' : appError.severity,
    message: appError.message,
    target: input?.target ?? appError.target ?? null,
    detail: null,
  }
}
