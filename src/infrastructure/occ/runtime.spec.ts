import { test, expect } from "vitest";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFilesystemOpenCascadeFactory } from "@/infrastructure/occ/filesystem-kernel-runtime";
import {
  createOpenCascadeInitializerFromMainJS,
  createProductionOpenCascadeInitializerFromMainJS,
} from "@/infrastructure/occ/initialization";
import {
  probeOpenCascadeNativeTopologyKernelCapabilities,
  getOpenCascadeRuntimeAssetVersion,
  getVersionedOpenCascadeRuntimeAssetUrl,
  type OpenCascadeInitializer,
  type OpenCascadeInstance,
} from "@/infrastructure/occ/kernel-capabilities";
import {
  createOpenCascadeInstanceLoader,
  getDefaultOpenCascadeInstance,
  loadDefaultOpenCascadeFactory,
  resetDefaultOpenCascadeInstanceForTests,
} from "@/infrastructure/occ/runtime";

test("src/infrastructure/occ/runtime.spec.ts", async () => {
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
      "Node runtime must resolve the filesystem execution adapter.",
    ).toBe(nodeInitializer);
    expect(
      nodeLoads,
      "Node runtime must load the filesystem execution adapter exactly once.",
    ).toBe(1);
    expect(
      browserLoads,
      "Node runtime must not load the browser execution adapter.",
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
      "Browser runtime must resolve the browser execution adapter.",
    ).toBe(browserInitializer);
    expect(
      browserLoads,
      "Browser runtime must load the browser execution adapter exactly once.",
    ).toBe(1);
    expect(
      nodeLoads,
      "Browser runtime must not load the filesystem execution adapter.",
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

  function testRuntimeAssetVersioningPairsTheCustomModuleAndWasm() {
    const jsUrl = getVersionedOpenCascadeRuntimeAssetUrl("/cadara-occ.js");
    const wasmUrl = getVersionedOpenCascadeRuntimeAssetUrl("/cadara-occ.wasm");
    const jsVersion = new URL(jsUrl).searchParams.get("v");
    const wasmVersion = new URL(wasmUrl).searchParams.get("v");

    expect(
      jsVersion,
      "Browser OCC runtime should use a deterministic artifact version for its custom module URL.",
    ).toBe(getOpenCascadeRuntimeAssetVersion());
    expect(
      wasmVersion,
      "Browser OCC runtime should use the same deterministic artifact version for its wasm URL.",
    ).toBe(jsVersion);
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
        probeOpenCascadeNativeTopologyKernelCapabilities(oc).kind,
        "Filesystem startup must load the custom production topology kernel.",
      ).toBe("available");

      expect(
        typeof oc.BRepBuilderAPI_MakeEdge_3,
        "Filesystem initialization must expose the production modeling APIs.",
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
  testRuntimeAssetVersioningPairsTheCustomModuleAndWasm();
  await testGetDefaultOpenCascadeInstanceInitializesNodeOpenCascade();

  console.log("OCC phase 1 runtime bootstrap tests passed.");
});

test("production initialization rejects missing native topology capabilities", async () => {
  const mainJS = function () {
    return Promise.resolve({} as OpenCascadeInstance);
  } as unknown as Parameters<
    typeof createProductionOpenCascadeInitializerFromMainJS
  >[0];
  const initialize = createProductionOpenCascadeInitializerFromMainJS(mainJS);
  await expect(initialize()).rejects.toThrow(
    "missing native topology kernel entrypoints: CadaraNativeTopologyProbe",
  );
});

test("production startup requires callable native topology and neutral query methods", async () => {
  const oc = await getDefaultOpenCascadeInstance();
  for (const [entrypoint, method] of [
    ["CadaraBuildNativeTopologyPayload", "BuildJson"],
    ["CadaraNativeNeutralCurveQuery", "QueryJson"],
  ]) {
    const incomplete = Object.assign(Object.create(oc), {
      [entrypoint]: class {},
    });
    const mainJS = function () {
      return Promise.resolve(incomplete);
    } as unknown as Parameters<
      typeof createProductionOpenCascadeInitializerFromMainJS
    >[0];
    const initialize = createProductionOpenCascadeInitializerFromMainJS(mainJS);
    await expect(initialize()).rejects.toThrow(`${entrypoint}.${method}`);
  }
});

test("filesystem startup fails explicitly for absent and unusable custom assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-occ-runtime-"));
  try {
    await expect(loadFilesystemOpenCascadeFactory(directory)).rejects.toThrow();
    await writeFile(join(directory, "cadara-occ.js"), "export default 42;");
    await writeFile(join(directory, "cadara-occ.wasm"), "unusable wasm");
    await expect(loadFilesystemOpenCascadeFactory(directory)).rejects.toThrow(
      "did not expose a default initializer",
    );
    // A real generated initializer must also reject unusable WASM, not fall
    // back to the installed stock package.
    const wasmDirectory = join(directory, "invalid-wasm");
    await mkdir(wasmDirectory);
    await copyFile(
      "public/cadara-occ.js",
      join(wasmDirectory, "cadara-occ.js"),
    );
    await writeFile(join(wasmDirectory, "cadara-occ.wasm"), "unusable wasm");
    const initialize = await loadFilesystemOpenCascadeFactory(wasmDirectory);
    await expect(
      initialize({ module: { printErr: () => undefined } }),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
