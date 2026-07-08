# Change Notes: Relax Import Bake Cascade

## 2026-07-08 Live bundle baseline

Re-imported the two live capture bundles from `/tmp/cadara-onshape-smoke-*.onshape-capture.json` through the headless provider → prepare → apply path using the real sketch solver and `MockKernelAdapter`.

| Document | Part Studio | Features | parametric | baked | geometryOnly | Applied ops | Created sketches | Created features |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `40a51fb8fa82fd4565151114` (HackerBoard) | Mounts | 10 | 6 | 4 | 0 | 6 | 1 | 1 |
| `9841e486906fa2ce62d74d8e` (Taskariki) | Part Studio 1 | 41 | 6 | 35 | 0 | 6 | 3 | 0 |

Reason breakdown after dependency-based cascade:

| Document | `needs-region-resolution` | `needs-history-probe` | `downstream-of-baked` |
| --- | ---: | ---: | ---: |
| HackerBoard / Mounts | 1 | 3 | 1 |
| Taskariki / Part Studio 1 | 15 | 20 | 5 |

Deltas vs. the previous post-correlation baseline:

- HackerBoard tier counts are unchanged at 6/4/0, but `downstream-of-baked` drops from 3 to 1.
- Taskariki tier counts are unchanged at 6/35/0 in this bundle, but `downstream-of-baked` drops from 24 to 5. The remaining baked features now carry their own blocker (`needs-history-probe` or `needs-region-resolution`) unless they are true dependents.
- No error diagnostics were produced during headless apply.
