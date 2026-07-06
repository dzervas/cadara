# cadara CLI

`cadara` is the general-purpose command-line tool for the CADara project. It
runs under Bun/Node (never in the browser) and shares contract and domain code
with the app but never imports browser-bound modules.

```
cadara <group> <command> [args]
```

Exit codes: `0` success, `1` command failure, `2` usage error.

## Running

```bash
bun run cli -- <group> <command> [args]
# or, once linked as a bin:
cadara <group> <command> [args]
```

## `onshape capture`

Capture an Onshape document into a single self-contained, versioned bundle file
(`*.onshape-capture.json`) for later offline import.

```bash
cadara onshape capture <onshape-document-url> [output-file]
```

- `<onshape-document-url>` — the full Onshape browser URL, e.g.
  `https://cad.onshape.com/documents/{did}/w/{wid}[/e/{eid}]`. `w`, `v`, and `m`
  segments are accepted. Without `/e/{eid}`, every Part Studio in the
  workspace/version is captured into one bundle.
- `[output-file]` — optional output path. Defaults to
  `{documentId}.onshape-capture.json`.

The bundle contains, per Part Studio: the verbatim `getFeatures`, solved
`sketches`, `parts`, and (when available) `featurespecs` responses; a resolution
table mapping every referenced deterministic ID to a geometric signature (or a
structured `unresolved` reason); and final-state ground truth (tessellated faces
plus a STEP export). Raw Onshape payloads are archived unmodified — all
interpretation happens later in the import provider.

Capture fails loudly: if any mandatory section cannot be captured after bounded
retries, the command exits non-zero and writes **no** output file. Optional
sections (feature specs) may be absent, and the absence is recorded explicitly.

### Credentials

The command reads Onshape API keys from the environment and uses HTTP Basic
auth. Credentials are never written to bundles, logs, or error output.

```bash
export ONSHAPE_ACCESS_KEY=...   # API access key
export ONSHAPE_SECRET_KEY=...   # API secret key
```

Generate a key pair at <https://dev-portal.onshape.com/keys>. Capture is
read-only against documents the key owner can access; the client backs off on
HTTP 429 and caps concurrent in-flight requests.

## Manual live smoke test (not run in CI)

Automated tests use recorded fixture transcripts with an injected fetch — no
network. To verify real Onshape connectivity manually:

1. Export valid `ONSHAPE_ACCESS_KEY` / `ONSHAPE_SECRET_KEY`.
2. Capture a small document you own:
   ```bash
   bun run cli -- onshape capture \
     "https://cad.onshape.com/documents/<did>/w/<wid>" \
     /tmp/smoke.onshape-capture.json
   ```
3. Confirm the command exits `0` and reports the number of Part Studios.
4. Validate the output against the envelope schema (the CLI already validates
   before writing; this is a defense-in-depth check):
   ```bash
   bun -e 'import("@/contracts/import/onshape-capture-bundle").then(async (m) => {
     const fs = await import("node:fs/promises");
     const bundle = JSON.parse(await fs.readFile("/tmp/smoke.onshape-capture.json", "utf8"));
     const r = m.validateOnshapeCaptureBundle(bundle);
     console.log(r.success ? "valid" : r.issues);
   })'
   ```
5. Note the resulting bundle size for capacity planning.

Do not commit captured bundles: they may contain proprietary geometry and are
user-owned files like any other CAD export.
