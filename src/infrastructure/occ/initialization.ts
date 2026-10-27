import {
  assertOpenCascadeNativeTopologyKernelCapabilities,
  type OpenCascadeInstance,
  type OpenCascadeInitializer,
  type OpenCascadeMainJS,
} from "@/infrastructure/occ/kernel-capabilities";
import { getVersionedOpenCascadeRuntimeAssetUrls } from "@/infrastructure/occ/assets";

interface OpenCascadeDynamicLibraryHost {
  loadDynamicLibrary(
    lib: string,
    options: {
      loadAsync: boolean;
      global: boolean;
      nodelete: boolean;
      allowUndefined: boolean;
    },
  ): Promise<unknown>;
}

export function createOpenCascadeInitializerFromMainJS(
  defaultMainJS: OpenCascadeMainJS,
  getDefaultMainWasm = () => getVersionedOpenCascadeRuntimeAssetUrls().mainWasm,
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
        if (path.endsWith(".wasm")) {
          return mainWasm;
        }
        if (path.endsWith(".worker.js") && worker) {
          return worker;
        }
        return path;
      },
      ...module,
    });

    const dynamicLibraryHost = oc as OpenCascadeInstance &
      Partial<OpenCascadeDynamicLibraryHost>;

    for (const lib of libs) {
      if (!dynamicLibraryHost.loadDynamicLibrary) {
        throw new Error(
          "OpenCascade runtime does not support dynamic library loading.",
        );
      }

      await dynamicLibraryHost.loadDynamicLibrary(lib, {
        loadAsync: true,
        global: true,
        nodelete: true,
        allowUndefined: false,
      });
    }

    return oc;
  };
}

function assertRequiredOpenCascadeBindings(oc: OpenCascadeInstance) {
  const p1 = new oc.gp_Pnt_3(0, 0, 0);
  const p2 = new oc.gp_Pnt_3(1, 0, 0);
  const p3 = new oc.gp_Pnt_3(1, 1, 0);
  const p4 = new oc.gp_Pnt_3(0, 1, 0);
  let e1Builder: { Edge(): unknown; delete?: () => void } | null = null;
  let e2Builder: { Edge(): unknown; delete?: () => void } | null = null;
  let e3Builder: { Edge(): unknown; delete?: () => void } | null = null;
  let e4Builder: { Edge(): unknown; delete?: () => void } | null = null;
  let wireBuilder: {
    Add_1(edge: unknown): void;
    Wire(): unknown;
    delete?: () => void;
  } | null = null;
  let faceBuilder: { IsDone(): boolean; delete?: () => void } | null = null;
  let e1: unknown = null;
  let e2: unknown = null;
  let e3: unknown = null;
  let e4: unknown = null;
  let wire: unknown = null;

  try {
    e1Builder = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    e2Builder = new oc.BRepBuilderAPI_MakeEdge_3(p2, p3);
    e3Builder = new oc.BRepBuilderAPI_MakeEdge_3(p3, p4);
    e4Builder = new oc.BRepBuilderAPI_MakeEdge_3(p4, p1);
    e1 = e1Builder.Edge();
    e2 = e2Builder.Edge();
    e3 = e3Builder.Edge();
    e4 = e4Builder.Edge();
    wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();
    wireBuilder.Add_1(e1 as InstanceType<OpenCascadeInstance["TopoDS_Edge"]>);
    wireBuilder.Add_1(e2 as InstanceType<OpenCascadeInstance["TopoDS_Edge"]>);
    wireBuilder.Add_1(e3 as InstanceType<OpenCascadeInstance["TopoDS_Edge"]>);
    wireBuilder.Add_1(e4 as InstanceType<OpenCascadeInstance["TopoDS_Edge"]>);
    wire = wireBuilder.Wire();
    faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(
      wire as InstanceType<OpenCascadeInstance["TopoDS_Wire"]>,
      true,
    );
    if (!faceBuilder.IsDone()) {
      throw new Error(
        "Custom OpenCascade build cannot construct a planar face from a closed wire.",
      );
    }
  } finally {
    faceBuilder?.delete?.();
    (wire as { delete?: () => void } | null)?.delete?.();
    wireBuilder?.delete?.();
    (e4 as { delete?: () => void } | null)?.delete?.();
    (e3 as { delete?: () => void } | null)?.delete?.();
    (e2 as { delete?: () => void } | null)?.delete?.();
    (e1 as { delete?: () => void } | null)?.delete?.();
    e4Builder?.delete?.();
    e3Builder?.delete?.();
    e2Builder?.delete?.();
    e1Builder?.delete?.();
    p4.delete?.();
    p3.delete?.();
    p2.delete?.();
    p1.delete?.();
  }
}

export function createProductionOpenCascadeInitializerFromMainJS(
  mainJS: OpenCascadeMainJS,
  getMainWasm?: () => string,
): OpenCascadeInitializer {
  const initialize = createOpenCascadeInitializerFromMainJS(
    mainJS,
    getMainWasm,
  );
  return async (settings) => {
    const oc = await initialize(settings);
    assertOpenCascadeNativeTopologyKernelCapabilities(oc);
    const host = oc as unknown as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const requiredMethods = [
      ["CadaraBuildNativeTopologyPayload", "BuildJson"],
      ["CadaraExecuteNativeFeatureTransaction", "BuildCommittedShapePayload"],
      ["CadaraBuildNativeExactBrepPayload", "BuildJson"],
      ["CadaraBuildNativeMeshExportPayload", "BuildJson"],
      ["CadaraNativeNeutralCurveQuery", "QueryJson"],
    ] as const;
    const missing = requiredMethods
      .filter(
        ([entrypoint, method]) =>
          typeof host[entrypoint]?.[method] !== "function",
      )
      .map(([entrypoint, method]) => `${entrypoint}.${method}`);
    if (missing.length > 0) {
      throw new Error(
        `Loaded OpenCascade build is missing required native methods: ${missing.join(", ")}.`,
      );
    }
    assertRequiredOpenCascadeBindings(oc);
    return oc;
  };
}

