import type { ErrorReporter, ErrorReportMetadata } from '@/contracts/errors'
import {
  appErrorFromModelingResult,
  normalizeUnknownError,
  type AppError,
  type AppErrorContextEntry,
  type AppResult,
  err,
  ok,
} from '@/contracts/errors'
import type { ModelingDiagnostic } from '@/contracts/modeling/schema'

interface WorkbenchModelingMutationResult {
  revisionState:
    | { kind: 'accepted' }
    | { kind: 'conflict'; actualRevisionId: string }
    | { kind: 'rejected'; reasonCode: string }
  diagnostics: readonly ModelingDiagnostic[]
}

export function requireAcceptedModelingResult<T extends WorkbenchModelingMutationResult>(
  result: T,
  input: {
    operation: string
    fallbackMessage: string
    context?: readonly AppErrorContextEntry[]
  },
): AppResult<T> {
  if (result.revisionState.kind === 'accepted') {
    return ok(result)
  }

  return err(appErrorFromModelingResult({
    operation: input.operation,
    fallbackMessage: input.fallbackMessage,
    diagnostics: result.diagnostics,
    revisionState: result.revisionState,
    context: input.context,
  }))
}

export async function runWorkbenchAction<TOutput, TSuccess>(input: {
  operation: string
  context?: readonly AppErrorContextEntry[]
  reporter: ErrorReporter
  metadata?: Omit<ErrorReportMetadata, 'source'>
  action: () => Promise<TOutput>
  mapSuccess: (output: TOutput) => AppResult<TSuccess>
  onError: (error: AppError) => void
}): Promise<AppResult<TSuccess>> {
  let mapped: AppResult<TSuccess>

  try {
    mapped = input.mapSuccess(await input.action())
  } catch (error: unknown) {
    mapped = err(normalizeUnknownError(error, {
      code: 'workbench/action-failed',
      fallbackMessage: `${input.operation} failed.`,
      context: [
        { key: 'operation', value: input.operation },
        ...(input.context ?? []),
      ],
    }))
  }

  if (mapped.isOk()) {
    return ok(mapped.value)
  }

  input.reporter.report(mapped.error, {
    source: 'workbench',
    visibility: 'user',
    dedupeKey: `${input.operation}:${mapped.error.requestId ?? mapped.error.message}`,
    ...input.metadata,
  })
  input.onError(mapped.error)
  return mapped
}
