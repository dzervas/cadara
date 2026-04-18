import { useContext } from 'react'

import { ErrorReporterContext } from '@/hooks/error-reporter-context'

export function useErrorReporter() {
  const reporter = useContext(ErrorReporterContext)

  if (!reporter) {
    throw new Error('useErrorReporter must be used inside ErrorReporterProvider.')
  }

  return reporter
}
