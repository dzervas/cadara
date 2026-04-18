/// <reference types="vite/client" />

declare module 'virtual:cadara-build-metadata' {
  export const appVersion: string
  export const gitCommit: string
}

interface Window {
  __CADARA_SINGLE_ASSETS__?: {
    icons?: Record<string, string>
  }
}
