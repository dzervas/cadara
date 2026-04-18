import { useMemo, type PropsWithChildren } from 'react'

import { createConsoleErrorReporter, type ErrorReporter } from '@/contracts/errors'
import { ErrorReporterContext } from '@/hooks/error-reporter-context'

interface ErrorReporterProviderProps extends PropsWithChildren {
  reporter?: ErrorReporter
}

export function ErrorReporterProvider({ children, reporter }: ErrorReporterProviderProps) {
  const defaultReporter = useMemo(() => createConsoleErrorReporter(), [])

  return (
    <ErrorReporterContext.Provider value={reporter ?? defaultReporter}>
      {children}
    </ErrorReporterContext.Provider>
  )
}
