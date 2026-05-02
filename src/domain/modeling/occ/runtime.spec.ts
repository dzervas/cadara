import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import {
  createOpenCascadeInitializerFromMainJS,
  createOpenCascadeInstanceLoader,
  getDefaultOpenCascadeEntrySpecifier,
  getDefaultOpenCascadeInstance,
  getOpenCascadeRuntimeAssetVersion,
  getVersionedOpenCascadeRuntimeAssetUrl,
  loadDefaultOpenCascadeFactory,
  resetDefaultOpenCascadeInstanceForTests,
  type OpenCascadeInitializer,
  type OpenCascadeInstance,
} from '@/domain/modeling/occ/runtime'

test('src/domain/modeling/occ/runtime.spec.ts', async () => {  function createMockOpenCascadeInstance() {
    return {
      BRepBuilderAPI_MakeEdge_3: class BRepBuilderAPI_MakeEdge_3 {},
    } as unknown as OpenCascadeInstance
  }

  async function testLoadDefaultOpenCascadeFactoryUsesNodeEntryInNodeRuntime() {
    let browserLoads = 0
    let nodeLoads = 0

    const nodeInitializer: OpenCascadeInitializer = async () => createMockOpenCascadeInstance()

    const initializer = await loadDefaultOpenCascadeFactory({
      isNodeRuntime: true,
      loadBrowserModule: async () => {
        browserLoads += 1
        return { default: async () => createMockOpenCascadeInstance() }
      },
      loadNodeModule: async () => {
        nodeLoads += 1
        return { default: nodeInitializer }
      },
    })

    expectTrue(initializer === nodeInitializer, 'Node runtime must resolve the node-specific OCJS entry point.')
    expectTrue(
      getDefaultOpenCascadeEntrySpecifier({ isNodeRuntime: true }) === 'opencascade.js/dist/node.js',
      'Node runtime detection must expose the node-specific OCJS entry specifier.',
    )
    expectTrue(nodeLoads === 1, 'Node runtime must load the node-specific OCJS module exactly once.')
    expectTrue(browserLoads === 0, 'Node runtime must not touch the browser OCJS entry point.')
  }

  async function testLoadDefaultOpenCascadeFactoryUsesBrowserEntryOutsideNodeRuntime() {
    let browserLoads = 0
    let nodeLoads = 0

    const browserInitializer: OpenCascadeInitializer = async () => createMockOpenCascadeInstance()

    const initializer = await loadDefaultOpenCascadeFactory({
      isNodeRuntime: false,
      loadBrowserModule: async () => {
        browserLoads += 1
        return { default: browserInitializer }
      },
      loadNodeModule: async () => {
        nodeLoads += 1
        return { default: async () => createMockOpenCascadeInstance() }
      },
    })

    expectTrue(initializer === browserInitializer, 'Browser runtime must resolve the browser OCJS entry point.')
    expectTrue(
      getDefaultOpenCascadeEntrySpecifier({ isNodeRuntime: false }) === 'opencascade.js',
      'Browser runtime detection must expose the browser OCJS entry specifier.',
    )
    expectTrue(browserLoads === 1, 'Browser runtime must load the browser OCJS module exactly once.')
    expectTrue(nodeLoads === 0, 'Browser runtime must not touch the node-specific OCJS entry point.')
  }

  async function testCreateOpenCascadeInstanceLoaderCachesTheInitializedInstance() {
    const instance = createMockOpenCascadeInstance()
    let factoryCalls = 0
    let initializerCalls = 0

    const loader = createOpenCascadeInstanceLoader(async () => {
      factoryCalls += 1

      return async () => {
        initializerCalls += 1
        return instance
      }
    })

    const first = loader.getInstance()
    const second = loader.getInstance()

    expectTrue(first === second, 'Instance loader must memoize the in-flight initialization promise.')

    const resolvedFirst = await first
    const resolvedSecond = await second

    expectTrue(resolvedFirst === instance, 'Instance loader must resolve the initialized OCJS instance.')
    expectTrue(resolvedSecond === instance, 'Instance loader must reuse the same initialized OCJS instance.')
    expectTrue(factoryCalls === 1, 'Instance loader must only load the OCJS factory once.')
    expectTrue(initializerCalls === 1, 'Instance loader must only initialize OCJS once.')

    loader.reset()

    const third = await loader.getInstance()

    expectTrue(factoryCalls > 1, 'Reset must clear the cached OCJS factory promise.')
    expectTrue(initializerCalls > 1, 'Reset must force OCJS to initialize again on the next access.')
    expectTrue(third === instance, 'Reset must still resolve a valid OCJS instance.')
  }

  async function testCreateOpenCascadeInstanceLoaderRetriesAfterInitializationFailure() {
    const instance = createMockOpenCascadeInstance()
    let initializerCalls = 0
    const loader = createOpenCascadeInstanceLoader(async () => async () => {
      initializerCalls += 1
      if (initializerCalls === 1) {
        throw new Error('bootstrap failed')
      }

      return instance
    })

    let failed = false
    try {
      await loader.getInstance()
    } catch (error) {
      failed = error instanceof Error && error.message === 'bootstrap failed'
    }

    expectTrue(failed, 'Loader must surface initialization failures instead of hiding them.')

    const recovered = await loader.getInstance()

    expectTrue(initializerCalls === 2, 'Loader must retry after a failed initialization attempt.')
    expectTrue(recovered === instance, 'Loader must recover and cache the next successful initialization result.')
  }

  async function testBrowserOpenCascadeInitializerUsesProvidedWasmUrl() {
    const instance = createMockOpenCascadeInstance()
    const modules: Record<string, unknown>[] = []
    const mainJS = function (module: Record<string, unknown>) {
      modules.push(module)

      return Promise.resolve(instance)
    } as unknown as NonNullable<Parameters<typeof createOpenCascadeInitializerFromMainJS>[0]>

    const initializer = createOpenCascadeInitializerFromMainJS(
      mainJS,
      () => 'https://cdn.example/opencascade.full.wasm',
    )
    const oc = await initializer()

    expectTrue(oc === instance, 'Browser initializer must resolve the created OCJS instance.')
    expectTrue(modules.length === 1, 'Browser initializer must construct OCJS exactly once.')

    const locateFile = modules[0]?.locateFile

    expectTrue(typeof locateFile === 'function', 'Browser initializer must provide a locateFile hook.')
    expectTrue(
      locateFile('opencascade.full.wasm') === 'https://cdn.example/opencascade.full.wasm',
      'Browser initializer must resolve the OCC wasm file from the provided wasm URL.',
    )
    expectTrue(
      locateFile('opencascade.full.worker.js') === 'opencascade.full.worker.js',
      'Browser initializer must leave unrelated files untouched when no worker URL is configured.',
    )
  }

  function testRuntimeAssetVersioningUsesCurrentBuildScriptUrl() {
    const documentLike = {
      querySelector(selector: string) {
        return selector === 'script[type="module"][src]'
          ? {
              getAttribute(name: string) {
                return name === 'src' ? '/assets/index-prod-build.js' : null
              },
            }
          : null
      },
    }

    expectTrue(
      getOpenCascadeRuntimeAssetVersion(documentLike) === '/assets/index-prod-build.js',
      'Browser OCC runtime assets should derive their version token from the current build script URL.',
    )
    expectTrue(
      getVersionedOpenCascadeRuntimeAssetUrl('/cadara-occ.js', documentLike)
        === 'https://cadara.local/cadara-occ.js?v=%2Fassets%2Findex-prod-build.js',
      'Browser OCC runtime should request the custom module with a build-specific cache-busting token.',
    )
    expectTrue(
      getVersionedOpenCascadeRuntimeAssetUrl('/cadara-occ.wasm', documentLike)
        === 'https://cadara.local/cadara-occ.wasm?v=%2Fassets%2Findex-prod-build.js',
      'Browser OCC runtime should request the custom wasm asset with a build-specific cache-busting token.',
    )
  }

  async function testGetDefaultOpenCascadeInstanceInitializesNodeOpenCascade() {
    resetDefaultOpenCascadeInstanceForTests()

    try {
      const first = getDefaultOpenCascadeInstance()
      const second = getDefaultOpenCascadeInstance()

      expectTrue(first === second, 'Default OCJS loader must memoize the in-flight initialization promise.')

      const oc = await first

      expectTrue(
        typeof oc.BRepBuilderAPI_MakeEdge_3 === 'function',
        'Node/test OCJS initialization must expose confirmed modeling APIs from the node entry point.',
      )
    } finally {
      resetDefaultOpenCascadeInstanceForTests()
    }
  }

  await testLoadDefaultOpenCascadeFactoryUsesNodeEntryInNodeRuntime()
  await testLoadDefaultOpenCascadeFactoryUsesBrowserEntryOutsideNodeRuntime()
  await testCreateOpenCascadeInstanceLoaderCachesTheInitializedInstance()
  await testCreateOpenCascadeInstanceLoaderRetriesAfterInitializationFailure()
  await testBrowserOpenCascadeInitializerUsesProvidedWasmUrl()
  testRuntimeAssetVersioningUsesCurrentBuildScriptUrl()
  await testGetDefaultOpenCascadeInstanceInitializesNodeOpenCascade()

  console.log('OCC phase 1 runtime bootstrap tests passed.')
})
