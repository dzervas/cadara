# Per-tier fidelity baseline (probe-less v1)

This is the checked-in, reproducible fidelity baseline for the Onshape import
provider in its probe-less v1 configuration. It is the comparison baseline that
`add-kernel-topology-signatures` will measure its fidelity gain against.

## How to reproduce

The baseline is computed deterministically (no network) from the capture CLI's
checked-in fixture transcript via `assembleFixtureCaptureBundle()` +
`planStudioFidelity()`. The provider/planner logic-lane specs exercise the same
path; see `src/domain/import/onshape/fidelity-planner.spec.ts`.

## Fixture bundle baseline (deterministic)

Assembled from `src/cli/commands/onshape-capture/fixtures/transcript.ts`.

| Part Studio | Features | parametric | baked | geometryOnly | Studio bake needed |
| ----------- | -------- | ---------- | ----- | ------------ | ------------------ |
| Mounts      | 3        | 2          | 1     | 0            | yes                |
| Empty       | 0        | 0          | 0     | 0            | no                 |

Degradation reason breakdown (Mounts):

- `sketch-on-canonical-plane` × 2 — sketches on the captured Top datum plane translate parametrically.
- `needs-region-resolution` × 1 — the extrude consumes a sketch region that can only be resolved post-commit (blocked by the missing cross-action correlation mechanism, **not** the history probe).

Per-feature:

1. `newSketch` → **parametric** (`sketch-on-canonical-plane`)
2. `extrude` → **baked** (`needs-region-resolution`)
3. `newSketch` → **parametric** (`sketch-on-canonical-plane`)

## Real spike documents (2 documents, ~51 features)

The two real capture bundles are proprietary and git-ignored, so their baseline
is **not** checked in. To record it, a maintainer with Onshape credentials runs
`bun run cli onshape-capture <url>` for each spike document and feeds the bundle
through the provider. Expected shape under probe-less v1, from the spike mapping
table:

- **parametric:** `newSketch` on datum planes, `assignVariable` document variables.
- **baked / `needs-region-resolution`:** `extrude`, `revolve`, `sweep`, `loft`, `thicken` (sketch-region consumers).
- **baked / `needs-history-probe`:** `chamfer`, `shell`, `cPlane`, `transform`, `splitPart`, `booleanBodies`, `deleteBodies` (body-topology consumers).
- **baked / `custom-feature`:** any FeatureScript feature outside the mapping table.

The dominant baked driver is expected to be `needs-region-resolution` +
`needs-history-probe`; both are addressed by the fast-follow kernel/correlation
work, which is where the real fidelity gain lands (the ~90 mid-history
unresolved refs the smoke data surfaced).

### Recorded real-bundle baseline (2026-07-06, maintainer smoke)

Both real bundles imported successfully in-app (variables + parametric sketches
live with correct solved geometry; remaining features suppressed with reason
codes). Counts confirmed identical in the headless real-solver pipeline run.

| Document | Part Studio | Features | parametric | baked | geometryOnly |
| --- | --- | --- | --- | --- | --- |
| `40a51fb8fa82fd4565151114` (HackerBoard) | Mounts | 10 | 5 | 5 | 0 |
| `9841e486906fa2ce62d74d8e` (Taskariki) | Part Studio 1 | 41 | 6 | 35 | 0 |

Degradation reason breakdown (a feature may carry several codes):

| Document | `needs-region-resolution` | `needs-history-probe` | `downstream-of-baked` |
| --- | --- | --- | --- |
| HackerBoard / Mounts | 2 | 3 | 3 |
| Taskariki / Part Studio 1 | 16 | 19 | 24 |

Reading for the fast-follows:

- **Action correlation** (`needs-region-resolution`) unblocks 18 features —
  every extrude in both documents.
- **Kernel probe** (`needs-history-probe`) unblocks up to 22 features
  (face sketches, chamfers, shell, cPlane, transform, split, boolean, delete).
- `downstream-of-baked` (27) is not an independent blocker: it dissolves as
  the two mechanisms above land and the bake cascade shortens.
- Baked-tier geometry is not yet materialized (`onshape-bake-unavailable`);
  the baked substrate fast-follow turns the suppressed features into
  visible geometry.
