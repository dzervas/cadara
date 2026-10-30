import type {
  OpenCascadeInstance,
  OpenCascadeInitializer,
  OpenCascadeMainJS,
} from "@/infrastructure/occ/kernel-capabilities";
import { getVersionedOpenCascadeRuntimeAssetUrls } from "@/infrastructure/occ/assets";
import {
  isKernelVersionRetired,
  OccKernelVersionRetiredError,
} from "@/infrastructure/occ/kernel-version-retired";
import {
  createProductionOpenCascadeInitializerFromMainJS,
} from "@/infrastructure/occ/initialization";

interface OpenCascadeFactoryModule {
  default?: OpenCascadeInitializer;
  initOpenCascade?: OpenCascadeInitializer;
}

interface OpenCascadeFactoryLoadOptions {
  isNodeRuntime?: boolean;
  loadBrowserModule?: () => Promise<OpenCascadeFactoryModule>;
  loadNodeModule?: () => Promise<OpenCascadeFactoryModule>;
}

function isNodeRuntime() {
  const processLike = (
    globalThis as typeof globalThis & {
      process?: { versions?: { node?: string } };
    }
  ).process;

  return (
    typeof processLike?.versions === "object" &&
    typeof processLike.versions?.node === "string"
  );
}

async function loadBrowserOpenCascadeModule(): Promise<OpenCascadeFactoryModule> {
  const customMainJSImportUrl =
    getVersionedOpenCascadeRuntimeAssetUrls().mainJS;
  const customMainJSModule = (await import(
    /* @vite-ignore */
    customMainJSImportUrl
  )) as { default?: OpenCascadeMainJS };
  const customMainJS = customMainJSModule.default;

  if (typeof customMainJS !== "function") {
    throw new Error(
      "Custom OpenCascade build did not expose a default initializer module.",
    );
  }

  const customInitializer = createProductionOpenCascadeInitializerFromMainJS(
    customMainJS,
    () => getVersionedOpenCascadeRuntimeAssetUrls().mainWasm,
  );

  return { default: customInitializer };
}

/** A failed module import hides the HTTP status; a 404 means a deploy retired it. */
async function loadPublishedBrowserOpenCascadeModule() {
  try {
    return await loadBrowserOpenCascadeModule();
  } catch (error) {
    if (await isKernelVersionRetired(getVersionedOpenCascadeRuntimeAssetUrls().mainJS))
      throw new OccKernelVersionRetiredError();
    throw error;
  }
}

async function loadNodeOpenCascadeModule(): Promise<OpenCascadeFactoryModule> {
  const { loadFilesystemOpenCascadeFactory } =
    await import("@/infrastructure/occ/filesystem-kernel-runtime");
  return { default: await loadFilesystemOpenCascadeFactory() };
}

function resolveOpenCascadeInitializer(
  module: OpenCascadeFactoryModule,
): OpenCascadeInitializer {
  const initializer = module.default ?? module.initOpenCascade;

  if (typeof initializer !== "function") {
    throw new Error(
      "OpenCascade module did not expose an initializer function.",
    );
  }

  return initializer;
}

export async function loadDefaultOpenCascadeFactory(
  options: OpenCascadeFactoryLoadOptions = {},
): Promise<OpenCascadeInitializer> {
  const loadModule =
    (options.isNodeRuntime ?? isNodeRuntime())
      ? (options.loadNodeModule ?? loadNodeOpenCascadeModule)
      : (options.loadBrowserModule ?? loadPublishedBrowserOpenCascadeModule);
  const module = await loadModule();

  return resolveOpenCascadeInitializer(module);
}

export function createOpenCascadeInstanceLoader(
  loadFactory: () => Promise<OpenCascadeInitializer>,
) {
  let openCascadePromise: Promise<OpenCascadeInstance> | null = null;

  return {
    getInstance() {
      if (!openCascadePromise) {
        openCascadePromise = loadFactory()
          .then((initOpenCascade) => initOpenCascade())
          .catch((error: unknown) => {
            openCascadePromise = null;
            throw error;
          });
      }

      return openCascadePromise;
    },
    reset() {
      openCascadePromise = null;
    },
  };
}

const defaultOpenCascadeInstanceLoader = createOpenCascadeInstanceLoader(
  loadDefaultOpenCascadeFactory,
);

export function getDefaultOpenCascadeInstance() {
  return defaultOpenCascadeInstanceLoader.getInstance();
}

export function resetDefaultOpenCascadeInstanceForTests() {
  defaultOpenCascadeInstanceLoader.reset();
}

export function getOpenCascadeInstance() {
  return getDefaultOpenCascadeInstance();
}
