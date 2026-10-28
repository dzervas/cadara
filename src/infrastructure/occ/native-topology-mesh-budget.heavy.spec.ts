// Logic lane, heavy tier (docs/testing.md): the production OCC assets
// (`public/cadara-occ`). The native topology payload's mesh budget, as the
// pinned-builder stage checks it (scripts/occ/topology-mesh-budget-conformance.mjs):
// BuildJson caps BRepMesh's minimum segment at the linear deflection, so the
// fine display tier cannot put hundreds of thousands of triangles on a thin
// fillet or offset torus; and a feature transaction meshes its committed
// payload at the identity budget instead of its unification tolerance. Both
// rows fail with "assets predate ..." until public/cadara-occ is rebuilt from
// the current occ-native-shims.
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

interface MeshBudgetCase {
  name: string;
  status: "pass" | "error";
  error?: string;
}

test("the production OCC build meets the native topology payload mesh budget", async () => {
  const module = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (module: Record<string, unknown>) => Promise<unknown>;
  };
  const oc = await new module.default({
    wasmBinary: new Uint8Array(
      await readFile(
        new URL("../../../public/cadara-occ.wasm", import.meta.url),
      ),
    ),
  });
  const { runTopologyMeshBudgetConformance } = (await import(
    new URL(
      "../../../scripts/occ/topology-mesh-budget-conformance.mjs",
      import.meta.url,
    ).href
  )) as {
    runTopologyMeshBudgetConformance(oc: unknown): { cases: MeshBudgetCase[] };
  };
  const { cases } = runTopologyMeshBudgetConformance(oc);
  expect(
    cases
      .filter((entry) => entry.status !== "pass")
      .map((entry) => ({
        name: entry.name,
        error: entry.error?.split("\n")[0],
      })),
  ).toEqual([]);
}, 300_000);
