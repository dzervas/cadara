import { createContext } from 'react'

import type { ErrorReporter } from '@/contracts/errors'

export const ErrorReporterContext = createContext<ErrorReporter | null>(null)
