/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly TEST?: boolean | string
}

interface Window {
  __cadTestState?: import('@/components/layout/workbench-state-debugger').WorkbenchStateDebuggerModel
  __cadProjectToScreen?: (objectId: string) => { x: number, y: number } | null
  __cadSelectTarget?: (targetId: string) => boolean
}

declare module 'virtual:cadara-build-metadata' {
  export const appVersion: string
  export const gitCommit: string
}

interface Window {
  __CADARA_SINGLE_ASSETS__?: {
    icons?: Record<string, string>
  }
}
