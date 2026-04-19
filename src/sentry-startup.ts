import {
  initializeSentryErrorReporting,
  shouldEnableSentryErrorReporting,
} from '@/contracts/errors/sentry-client'

initializeSentryErrorReporting({
  enabled: shouldEnableSentryErrorReporting({
    isProduction: import.meta.env.PROD,
    search: typeof window === 'undefined' ? null : window.location.search,
  }),
  environment: import.meta.env.MODE,
  checkDsnReachability: true,
})
