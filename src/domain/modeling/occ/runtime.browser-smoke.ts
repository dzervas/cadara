import {
  getDefaultOpenCascadeEntrySpecifier,
  loadDefaultOpenCascadeFactory,
} from "@/domain/modeling/occ/runtime";

async function verifyBrowserOpenCascadeBootstrapCompiles() {
  if (
    getDefaultOpenCascadeEntrySpecifier({ isNodeRuntime: false }) !==
    "opencascade.js"
  ) {
    throw new Error(
      "Browser OCC bootstrap must resolve the browser entry specifier.",
    );
  }

  const initializer = await loadDefaultOpenCascadeFactory();

  if (typeof initializer !== "function") {
    throw new Error(
      "Browser OCC bootstrap must resolve an initializer function.",
    );
  }
}

await verifyBrowserOpenCascadeBootstrapCompiles();
