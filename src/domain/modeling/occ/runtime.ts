import type { OpenCascadeInstance } from 'opencascade.js/dist/opencascade.full'
import {
  getMissingNativeTopologyKernelEntrypoints,
  probeNativeTopologyKernelCapabilities,
  type OccNativeTopologyCapabilityProbeResult,
} from '@/domain/modeling/occ/native-topology-payload'

const DEFAULT_CUSTOM_OPENCASCADE_MAIN_JS_URL = '/cadara-occ.js'
const DEFAULT_CUSTOM_OPENCASCADE_WASM_URL = '/cadara-occ.wasm'

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
  default?: OpenCascadeInitializer
  initOpenCascade?: OpenCascadeInitializer
}

interface OpenCascadeFactoryLoadOptions {
  isNodeRuntime?: boolean
  loadBrowserModule?: () => Promise<OpenCascadeFactoryModule>
  loadNodeModule?: () => Promise<OpenCascadeFactoryModule>
}

interface RuntimeAssetVersionDocumentLike {
  querySelector(selector: string): null | {
    getAttribute(name: string): string | null
  }
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

function getRuntimeAbsoluteAssetUrl(path: string) {
  const locationLike = globalThis.location

  if (locationLike?.origin) {
    return new URL(path, locationLike.origin).href
  }

  return path
}

export function getOpenCascadeRuntimeAssetVersion(
  documentLike: RuntimeAssetVersionDocumentLike | null =
    typeof document === 'undefined' ? null : document,
) {
  const moduleScriptSrc = documentLike
    ?.querySelector('script[type="module"][src]')
    ?.getAttribute('src')
    ?.trim()

  return moduleScriptSrc && moduleScriptSrc.length > 0
    ? moduleScriptSrc
    : null
}

export function getVersionedOpenCascadeRuntimeAssetUrl(
  path: string,
  documentLike: RuntimeAssetVersionDocumentLike | null =
    typeof document === 'undefined' ? null : document,
) {
  const assetUrl = new URL(getRuntimeAbsoluteAssetUrl(path), globalThis.location?.origin ?? 'https://cadara.local')
  const version = getOpenCascadeRuntimeAssetVersion(documentLike)

  if (version) {
    assetUrl.searchParams.set('v', version)
  }

  return assetUrl.href
}

export function createOpenCascadeInitializerFromMainJS(
  defaultMainJS: OpenCascadeMainJS,
  getDefaultMainWasm = () => getVersionedOpenCascadeRuntimeAssetUrl(DEFAULT_CUSTOM_OPENCASCADE_WASM_URL),
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

function assertRequiredOpenCascadeBindings(oc: OpenCascadeInstance) {
  const p1 = new oc.gp_Pnt_3(0, 0, 0)
  const p2 = new oc.gp_Pnt_3(1, 0, 0)
  const p3 = new oc.gp_Pnt_3(1, 1, 0)
  const p4 = new oc.gp_Pnt_3(0, 1, 0)
  let e1Builder: { Edge(): unknown; delete?: () => void } | null = null
  let e2Builder: { Edge(): unknown; delete?: () => void } | null = null
  let e3Builder: { Edge(): unknown; delete?: () => void } | null = null
  let e4Builder: { Edge(): unknown; delete?: () => void } | null = null
  let wireBuilder: {
    Add_1(edge: unknown): void
    Wire(): unknown
    delete?: () => void
  } | null = null
  let faceBuilder: { IsDone(): boolean; delete?: () => void } | null = null
  let e1: unknown = null
  let e2: unknown = null
  let e3: unknown = null
  let e4: unknown = null
  let wire: unknown = null

  try {
    e1Builder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)
    e2Builder = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)
    e3Builder = new oc.BRepBuilderAPI_MakeEdge_3(p3, p4)
    e4Builder = new oc.BRepBuilderAPI_MakeEdge_3(p4, p1)
    e1 = e1Builder.Edge()
    e2 = e2Builder.Edge()
    e3 = e3Builder.Edge()
    e4 = e4Builder.Edge()
    wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()
    wireBuilder.Add_1(e1 as InstanceType<OpenCascadeInstance['TopoDS_Edge']>)
    wireBuilder.Add_1(e2 as InstanceType<OpenCascadeInstance['TopoDS_Edge']>)
    wireBuilder.Add_1(e3 as InstanceType<OpenCascadeInstance['TopoDS_Edge']>)
    wireBuilder.Add_1(e4 as InstanceType<OpenCascadeInstance['TopoDS_Edge']>)
    wire = wireBuilder.Wire()
    faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(
      wire as InstanceType<OpenCascadeInstance['TopoDS_Wire']>,
      true,
    )
    if (!faceBuilder.IsDone()) {
      throw new Error('Custom OpenCascade build cannot construct a planar face from a closed wire.')
    }
  } finally {
    faceBuilder?.delete?.()
    ;(wire as { delete?: () => void } | null)?.delete?.()
    wireBuilder?.delete?.()
    ;(e4 as { delete?: () => void } | null)?.delete?.()
    ;(e3 as { delete?: () => void } | null)?.delete?.()
    ;(e2 as { delete?: () => void } | null)?.delete?.()
    ;(e1 as { delete?: () => void } | null)?.delete?.()
    e4Builder?.delete?.()
    e3Builder?.delete?.()
    e2Builder?.delete?.()
    e1Builder?.delete?.()
    p4.delete?.()
    p3.delete?.()
    p2.delete?.()
    p1.delete?.()
  }
}

export function probeOpenCascadeNativeTopologyKernelCapabilities(
  oc: OpenCascadeInstance,
): OccNativeTopologyCapabilityProbeResult {
  return probeNativeTopologyKernelCapabilities(
    oc as unknown as Parameters<typeof probeNativeTopologyKernelCapabilities>[0],
  )
}

export function assertOpenCascadeNativeTopologyKernelCapabilities(
  oc: OpenCascadeInstance,
) {
  const missingEntrypoints = getMissingNativeTopologyKernelEntrypoints(
    oc as unknown as Parameters<typeof getMissingNativeTopologyKernelEntrypoints>[0],
  )

  if (missingEntrypoints.length > 0) {
    throw new Error(
      `Loaded OpenCascade build is missing native topology kernel entrypoints: ${missingEntrypoints.join(', ')}.`,
    )
  }
}

async function loadBrowserOpenCascadeModule(): Promise<OpenCascadeFactoryModule> {
  const customMainJSImportUrl = getVersionedOpenCascadeRuntimeAssetUrl(DEFAULT_CUSTOM_OPENCASCADE_MAIN_JS_URL)
  const customMainJSModule = await import(
    /* @vite-ignore */
    customMainJSImportUrl
  ) as { default?: OpenCascadeMainJS }
  const customMainJS = customMainJSModule.default

  if (typeof customMainJS !== 'function') {
    throw new Error('Custom OpenCascade build did not expose a default initializer module.')
  }

  const customInitializer = createOpenCascadeInitializerFromMainJS(
    customMainJS,
    () => getVersionedOpenCascadeRuntimeAssetUrl(DEFAULT_CUSTOM_OPENCASCADE_WASM_URL),
  )

  return {
    default: async (settings = {}) => {
      const oc = await customInitializer(settings)
      assertRequiredOpenCascadeBindings(oc)
      return oc
    },
  }
}

async function readNodeOpenCascadeWasmBinary(path: string) {
  const bunRuntime = globalThis as typeof globalThis & {
    Bun?: { file(path: string): { arrayBuffer(): Promise<ArrayBuffer> } }
  }

  if (bunRuntime.Bun) {
    return new Uint8Array(await bunRuntime.Bun.file(path).arrayBuffer())
  }

  const { readFile } = await import('node:fs/promises')
  return new Uint8Array(await readFile(path))
}

async function loadNodeOpenCascadeModule(): Promise<OpenCascadeFactoryModule> {
  try {
    const nodeEntrySpecifier = 'opencascade.js/dist/' + 'node.js'
    return await import(/* @vite-ignore */ nodeEntrySpecifier) as Promise<OpenCascadeFactoryModule>
  } catch {
    const legacyMainSpecifier = 'opencascade.js/dist/' + 'opencascade.wasm.js'
    const legacyWasmSpecifier = 'opencascade.js/dist/' + 'opencascade.wasm.wasm'
    const [{ default: nodeMainJS }, { default: wasmPath }] = await Promise.all([
      import(/* @vite-ignore */ legacyMainSpecifier),
      import(/* @vite-ignore */ legacyWasmSpecifier),
    ])
    const defaultInitializer = createOpenCascadeInitializerFromMainJS(
      nodeMainJS as OpenCascadeMainJS,
      () => wasmPath,
    )

    return {
      default: async (settings = {}) => defaultInitializer({
        ...settings,
        module: {
          ...settings.module,
          wasmBinary: settings.module?.wasmBinary ?? await readNodeOpenCascadeWasmBinary(wasmPath),
        },
      }),
    }
  }
}

function resolveOpenCascadeInitializer(module: OpenCascadeFactoryModule): OpenCascadeInitializer {
  const initializer = module.default ?? module.initOpenCascade

  if (typeof initializer !== 'function') {
    throw new Error('OpenCascade module did not expose an initializer function.')
  }

  return initializer
}

export async function loadDefaultOpenCascadeFactory(
  options: OpenCascadeFactoryLoadOptions = {},
): Promise<OpenCascadeInitializer> {
  const entrySpecifier = getDefaultOpenCascadeEntrySpecifier(options)
  const loadModule = entrySpecifier === 'opencascade.js/dist/node.js'
    ? (options.loadNodeModule ?? loadNodeOpenCascadeModule)
    : (options.loadBrowserModule ?? loadBrowserOpenCascadeModule)
  const module = await loadModule()

  return resolveOpenCascadeInitializer(module)
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
