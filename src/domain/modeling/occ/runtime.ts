import type { OpenCascadeInstance } from 'opencascade.js/dist/opencascade.full'

const DEFAULT_OPENCASCADE_WASM_CDN_URL =
  'https://cdn.jsdelivr.net/npm/opencascade.js@2.0.0-beta.b5ff984/dist/opencascade.full.wasm'

type OpenCascadeMainJS = new (module: Record<string, unknown>) => Promise<OpenCascadeInstance>

interface OpenCascadeDynamicLibraryHost {
  loadDynamicLibrary(
    lib: string,
    options: {
      loadAsync: boolean
      global: boolean
      nodelete: boolean
      allowUndefined: boolean
    },
  ): Promise<unknown>
}

export interface OpenCascadeInitializationOptions {
  mainJS?: OpenCascadeMainJS
  mainWasm?: string
  worker?: string
  libs?: string[]
  module?: Record<string, unknown>
}

export type OpenCascadeInitializer = (
  settings?: OpenCascadeInitializationOptions,
) => Promise<OpenCascadeInstance>

export type OpenCascadeEntrySpecifier = 'opencascade.js' | 'opencascade.js/dist/node.js'

interface OpenCascadeFactoryModule {
  default: OpenCascadeInitializer
}

interface OpenCascadeFactoryLoadOptions {
  isNodeRuntime?: boolean
  loadBrowserModule?: () => Promise<OpenCascadeFactoryModule>
  loadNodeModule?: () => Promise<OpenCascadeFactoryModule>
}

function isNodeRuntime() {
  const processLike = (globalThis as typeof globalThis & {
    process?: { versions?: { node?: string } }
  }).process

  return typeof processLike?.versions === 'object'
    && typeof processLike.versions?.node === 'string'
}

export function getDefaultOpenCascadeEntrySpecifier(
  options: Pick<OpenCascadeFactoryLoadOptions, 'isNodeRuntime'> = {},
): OpenCascadeEntrySpecifier {
  return (options.isNodeRuntime ?? isNodeRuntime())
    ? 'opencascade.js/dist/node.js'
    : 'opencascade.js'
}

function getConfiguredOpenCascadeWasmUrl() {
  const viteEnv = (import.meta as ImportMeta & {
    env?: { VITE_OPENCASCADE_WASM_URL?: string }
  }).env
  const configuredUrl = viteEnv?.VITE_OPENCASCADE_WASM_URL?.trim()

  return configuredUrl && configuredUrl.length > 0
    ? configuredUrl
    : DEFAULT_OPENCASCADE_WASM_CDN_URL
}

export function createOpenCascadeInitializerFromMainJS(
  defaultMainJS: OpenCascadeMainJS,
  getDefaultMainWasm = getConfiguredOpenCascadeWasmUrl,
): OpenCascadeInitializer {
  return async ({
    mainJS = defaultMainJS,
    mainWasm = getDefaultMainWasm(),
    worker,
    libs = [],
    module = {},
  } = {}) => {
    const oc = await new mainJS({
      locateFile(path: string) {
        if (path.endsWith('.wasm')) {
          return mainWasm
        }
        if (path.endsWith('.worker.js') && worker) {
          return worker
        }
        return path
      },
      ...module,
    })

    const dynamicLibraryHost = oc as OpenCascadeInstance & Partial<OpenCascadeDynamicLibraryHost>

    for (const lib of libs) {
      if (!dynamicLibraryHost.loadDynamicLibrary) {
        throw new Error('OpenCascade runtime does not support dynamic library loading.')
      }

      await dynamicLibraryHost.loadDynamicLibrary(lib, {
        loadAsync: true,
        global: true,
        nodelete: true,
        allowUndefined: false,
      })
    }

    return oc
  }
}

async function loadBrowserOpenCascadeModule(): Promise<OpenCascadeFactoryModule> {
  return import('opencascade.js')
}

async function loadNodeOpenCascadeModule(): Promise<OpenCascadeFactoryModule> {
  const nodeEntrySpecifier = 'opencascade.js/dist/' + 'node.js'
  return import(/* @vite-ignore */ nodeEntrySpecifier) as Promise<OpenCascadeFactoryModule>
}

export async function loadDefaultOpenCascadeFactory(
  options: OpenCascadeFactoryLoadOptions = {},
): Promise<OpenCascadeInitializer> {
  const entrySpecifier = getDefaultOpenCascadeEntrySpecifier(options)
  const loadModule = entrySpecifier === 'opencascade.js/dist/node.js'
    ? (options.loadNodeModule ?? loadNodeOpenCascadeModule)
    : (options.loadBrowserModule ?? loadBrowserOpenCascadeModule)
  const module = await loadModule()

  return module.default
}

export function createOpenCascadeInstanceLoader(
  loadFactory: () => Promise<OpenCascadeInitializer>,
) {
  let openCascadePromise: Promise<OpenCascadeInstance> | null = null

  return {
    getInstance() {
      if (!openCascadePromise) {
        openCascadePromise = loadFactory()
          .then((initOpenCascade) => initOpenCascade())
          .catch((error: unknown) => {
            openCascadePromise = null
            throw error
          })
      }

      return openCascadePromise
    },
    reset() {
      openCascadePromise = null
    },
  }
}

const defaultOpenCascadeInstanceLoader = createOpenCascadeInstanceLoader(
  loadDefaultOpenCascadeFactory,
)

export function getDefaultOpenCascadeInstance() {
  return defaultOpenCascadeInstanceLoader.getInstance()
}

export function resetDefaultOpenCascadeInstanceForTests() {
  defaultOpenCascadeInstanceLoader.reset()
}

export function getOpenCascadeInstance() {
  return getDefaultOpenCascadeInstance()
}

export type { OpenCascadeInstance }
