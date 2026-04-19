import { useMemo, type PropsWithChildren } from 'react'

import type { ErrorReporter } from '@/contracts/errors'
import { createDefaultErrorReporter } from '@/contracts/errors/default-reporter'
import { ErrorReporterContext } from '@/hooks/error-reporter-context'

interface ErrorReporterProviderProps extends PropsWithChildren {
  reporter?: ErrorReporter
}

export function ErrorReporterProvider({ children, reporter }: ErrorReporterProviderProps) {
  const contextReporter = useMemo(
    () => reporter ?? createDefaultErrorReporter({ isProduction: import.meta.env.PROD }),
    [reporter],
  )

  return (
    <ErrorReporterContext.Provider value={contextReporter}>
      {children}
    </ErrorReporterContext.Provider>
  )
}
