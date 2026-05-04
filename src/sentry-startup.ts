import {
  initializeSentryErrorReporting,
  shouldEnableSentryErrorReporting,
} from '@/contracts/errors/sentry-client'
import { sentryDist, sentryRelease } from 'virtual:cadara-build-metadata'

initializeSentryErrorReporting({
  enabled: shouldEnableSentryErrorReporting({
    isProduction: import.meta.env.PROD,
    search: typeof window === 'undefined' ? null : window.location.search,
  }),
  environment: import.meta.env.MODE,
  release: sentryRelease,
  dist: sentryDist,
  checkDsnReachability: true,
})
