import { loadDefaultOpenCascadeFactory } from "@/domain/modeling/occ/runtime";

async function verifyBrowserOpenCascadeBootstrapCompiles() {
  const initializer = await loadDefaultOpenCascadeFactory();

  if (typeof initializer !== "function") {
    throw new Error(
      "Browser OCC bootstrap must resolve an initializer function.",
    );
  }
}

await verifyBrowserOpenCascadeBootstrapCompiles();
