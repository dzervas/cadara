import { test, expect } from "vitest";
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
} from "@/domain/modeling/occ/runtime";

test("src/domain/modeling/occ/runtime.spec.ts", async () => {
  function createMockOpenCascadeInstance() {
    return {
      BRepBuilderAPI_MakeEdge_3: class BRepBuilderAPI_MakeEdge_3 {},
    } as unknown as OpenCascadeInstance;
  }

  async function testLoadDefaultOpenCascadeFactoryUsesNodeEntryInNodeRuntime() {
    let browserLoads = 0;
    let nodeLoads = 0;

    const nodeInitializer: OpenCascadeInitializer = async () =>
      createMockOpenCascadeInstance();

    const initializer = await loadDefaultOpenCascadeFactory({
      isNodeRuntime: true,
      loadBrowserModule: async () => {
        browserLoads += 1;
        return { default: async () => createMockOpenCascadeInstance() };
      },
      loadNodeModule: async () => {
        nodeLoads += 1;
        return { default: nodeInitializer };
      },
    });

    expect(
      initializer,
      "Node runtime must resolve the node-specific OCJS entry point.",
    ).toBe(nodeInitializer);
    expect(
      getDefaultOpenCascadeEntrySpecifier({ isNodeRuntime: true }),
      "Node runtime detection must expose the node-specific OCJS entry specifier.",
    ).toBe("opencascade.js/dist/node.js");
    expect(
      nodeLoads,
      "Node runtime must load the node-specific OCJS module exactly once.",
    ).toBe(1);
    expect(
      browserLoads,
      "Node runtime must not touch the browser OCJS entry point.",
    ).toBe(0);
  }

  async function testLoadDefaultOpenCascadeFactoryUsesBrowserEntryOutsideNodeRuntime() {
    let browserLoads = 0;
    let nodeLoads = 0;

    const browserInitializer: OpenCascadeInitializer = async () =>
      createMockOpenCascadeInstance();

    const initializer = await loadDefaultOpenCascadeFactory({
      isNodeRuntime: false,
      loadBrowserModule: async () => {
        browserLoads += 1;
        return { default: browserInitializer };
      },
      loadNodeModule: async () => {
        nodeLoads += 1;
        return { default: async () => createMockOpenCascadeInstance() };
      },
    });

    expect(
      initializer,
      "Browser runtime must resolve the browser OCJS entry point.",
    ).toBe(browserInitializer);
    expect(
      getDefaultOpenCascadeEntrySpecifier({ isNodeRuntime: false }),
      "Browser runtime detection must expose the browser OCJS entry specifier.",
    ).toBe("opencascade.js");
    expect(
      browserLoads,
      "Browser runtime must load the browser OCJS module exactly once.",
    ).toBe(1);
    expect(
      nodeLoads,
      "Browser runtime must not touch the node-specific OCJS entry point.",
    ).toBe(0);
  }

  async function testCreateOpenCascadeInstanceLoaderCachesTheInitializedInstance() {
    const instance = createMockOpenCascadeInstance();
    let factoryCalls = 0;
    let initializerCalls = 0;

    const loader = createOpenCascadeInstanceLoader(async () => {
      factoryCalls += 1;

      return async () => {
        initializerCalls += 1;
        return instance;
      };
    });

    const first = loader.getInstance();
    const second = loader.getInstance();

    expect(
      first,
      "Instance loader must memoize the in-flight initialization promise.",
    ).toBe(second);

    const resolvedFirst = await first;
    const resolvedSecond = await second;

    expect(
      resolvedFirst,
      "Instance loader must resolve the initialized OCJS instance.",
    ).toBe(instance);
    expect(
      resolvedSecond,
      "Instance loader must reuse the same initialized OCJS instance.",
    ).toBe(instance);
    expect(
      factoryCalls,
      "Instance loader must only load the OCJS factory once.",
    ).toBe(1);
    expect(
      initializerCalls,
      "Instance loader must only initialize OCJS once.",
    ).toBe(1);

    loader.reset();

    const third = await loader.getInstance();

    expect(
      factoryCalls > 1,
      "Reset must clear the cached OCJS factory promise.",
    ).toBeTruthy();
    expect(
      initializerCalls > 1,
      "Reset must force OCJS to initialize again on the next access.",
    ).toBeTruthy();
    expect(third, "Reset must still resolve a valid OCJS instance.").toBe(
      instance,
    );
  }

  async function testCreateOpenCascadeInstanceLoaderRetriesAfterInitializationFailure() {
    const instance = createMockOpenCascadeInstance();
    let initializerCalls = 0;
    const loader = createOpenCascadeInstanceLoader(async () => async () => {
      initializerCalls += 1;
      if (initializerCalls === 1) {
        throw new Error("bootstrap failed");
      }

      return instance;
    });

    let failed = false;
    try {
      await loader.getInstance();
    } catch (error) {
      failed = error instanceof Error && error.message === "bootstrap failed";
    }

    expect(
      failed,
      "Loader must surface initialization failures instead of hiding them.",
    ).toBeTruthy();

    const recovered = await loader.getInstance();

    expect(
      initializerCalls,
      "Loader must retry after a failed initialization attempt.",
    ).toBe(2);
    expect(
      recovered,
      "Loader must recover and cache the next successful initialization result.",
    ).toBe(instance);
  }

  async function testBrowserOpenCascadeInitializerUsesProvidedWasmUrl() {
    const instance = createMockOpenCascadeInstance();
    const modules: Record<string, unknown>[] = [];
    const mainJS = function (module: Record<string, unknown>) {
      modules.push(module);

      return Promise.resolve(instance);
    } as unknown as NonNullable<
      Parameters<typeof createOpenCascadeInitializerFromMainJS>[0]
    >;

    const initializer = createOpenCascadeInitializerFromMainJS(
      mainJS,
      () => "https://cdn.example/opencascade.full.wasm",
    );
    const oc = await initializer();

    expect(
      oc,
      "Browser initializer must resolve the created OCJS instance.",
    ).toBe(instance);
    expect(
      modules.length,
      "Browser initializer must construct OCJS exactly once.",
    ).toBe(1);

    const locateFile = modules[0]?.locateFile;

    expect(
      typeof locateFile,
      "Browser initializer must provide a locateFile hook.",
    ).toBe("function");
    expect(
      locateFile("opencascade.full.wasm"),
      "Browser initializer must resolve the OCC wasm file from the provided wasm URL.",
    ).toBe("https://cdn.example/opencascade.full.wasm");
    expect(
      locateFile("opencascade.full.worker.js"),
      "Browser initializer must leave unrelated files untouched when no worker URL is configured.",
    ).toBe("opencascade.full.worker.js");
  }

  function testRuntimeAssetVersioningUsesCurrentBuildScriptUrl() {
    const documentLike = {
      querySelector(selector: string) {
        return selector === 'script[type="module"][src]'
          ? {
              getAttribute(name: string) {
                return name === "src" ? "/assets/index-prod-build.js" : null;
              },
            }
          : null;
      },
    };

    expect(
      getOpenCascadeRuntimeAssetVersion(documentLike),
      "Browser OCC runtime assets should derive their version token from the current build script URL.",
    ).toBe("/assets/index-prod-build.js");
    expect(
      getVersionedOpenCascadeRuntimeAssetUrl("/cadara-occ.js", documentLike),
      "Browser OCC runtime should request the custom module with a build-specific cache-busting token.",
    ).toBe(
      "https://cadara.local/cadara-occ.js?v=%2Fassets%2Findex-prod-build.js",
    );
    expect(
      getVersionedOpenCascadeRuntimeAssetUrl("/cadara-occ.wasm", documentLike),
      "Browser OCC runtime should request the custom wasm asset with a build-specific cache-busting token.",
    ).toBe(
      "https://cadara.local/cadara-occ.wasm?v=%2Fassets%2Findex-prod-build.js",
    );
  }

  async function testGetDefaultOpenCascadeInstanceInitializesNodeOpenCascade() {
    resetDefaultOpenCascadeInstanceForTests();

    try {
      const first = getDefaultOpenCascadeInstance();
      const second = getDefaultOpenCascadeInstance();

      expect(
        first,
        "Default OCJS loader must memoize the in-flight initialization promise.",
      ).toBe(second);

      const oc = await first;

      expect(
        typeof oc.BRepBuilderAPI_MakeEdge_3,
        "Node/test OCJS initialization must expose confirmed modeling APIs from the node entry point.",
      ).toBe("function");
    } finally {
      resetDefaultOpenCascadeInstanceForTests();
    }
  }

  await testLoadDefaultOpenCascadeFactoryUsesNodeEntryInNodeRuntime();
  await testLoadDefaultOpenCascadeFactoryUsesBrowserEntryOutsideNodeRuntime();
  await testCreateOpenCascadeInstanceLoaderCachesTheInitializedInstance();
  await testCreateOpenCascadeInstanceLoaderRetriesAfterInitializationFailure();
  await testBrowserOpenCascadeInitializerUsesProvidedWasmUrl();
  testRuntimeAssetVersioningUsesCurrentBuildScriptUrl();
  await testGetDefaultOpenCascadeInstanceInitializesNodeOpenCascade();

  console.log("OCC phase 1 runtime bootstrap tests passed.");
});
