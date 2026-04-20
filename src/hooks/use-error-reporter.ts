import { ErrorReporterContext } from '@/hooks/error-reporter-context'
import { createRequiredContextHook } from '@/hooks/create-required-context-hook'

export const useErrorReporter = createRequiredContextHook(
  ErrorReporterContext,
  'useErrorReporter',
  'ErrorReporterProvider',
)
