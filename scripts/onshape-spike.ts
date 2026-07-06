// Throwaway spike: capture raw Onshape Part Studio JSON for import research.
// NOT production code — informs the onshape-capture-bundle openspec proposal.
//
// Usage:
//   ONSHAPE_ACCESS_KEY=... ONSHAPE_SECRET_KEY=... \
//     bun scripts/onshape-spike.ts <onshape-document-url> [output-dir]
//
// Accepts URLs like:
//   https://cad.onshape.com/documents/{did}/w/{wid}/e/{eid}
//   https://cad.onshape.com/documents/{did}/v/{vid}/e/{eid}
// The element id is optional; without it, every Part Studio in the
// workspace/version is captured.
//
// Output (default tmp-onshape-spike/<did>/, gitignored via tmp-* rule):
//   document.json                  document metadata
//   elements.json                  element list
//   <eid>/features.json            full ordered feature list (the history)
//   <eid>/sketches.json            solved sketch geometry (solver oracle)
//   <eid>/parts.json               resulting parts
//   <eid>/featurescript-specs.json feature spec metadata for the studio

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
const BASE = "https://cad.onshape.com/api/v10";

interface DocumentRef {
  documentId: string;
  wvm: "w" | "v" | "m";
  wvmId: string;
  elementId: string | null;
}

function parseDocumentUrl(raw: string): DocumentRef {
  const url = new URL(raw);
  const match = url.pathname.match(
    /\/documents\/([0-9a-f]{24})(?:\/(w|v|m)\/([0-9a-f]{24}))?(?:\/e\/([0-9a-f]{24}))?/i,
  );
  if (!match) {
    throw new Error(
      `Unrecognized Onshape document URL: ${raw}\n` +
        "Expected .../documents/{did}/w/{wid}[/e/{eid}]",
    );
  }
  const [, documentId, wvm, wvmId, elementId] = match;
  if (!wvm || !wvmId) {
    throw new Error(
      "URL is missing the workspace/version segment (/w/{wid} or /v/{vid}). " +
        "Open the document in Onshape and copy the full browser URL.",
    );
  }
  return {
    documentId,
    wvm: wvm as DocumentRef["wvm"],
    wvmId,
    elementId: elementId ?? null,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const authHeader =
  "Basic " +
  Buffer.from(
    `${requireEnv("ONSHAPE_ACCESS_KEY")}:${requireEnv("ONSHAPE_SECRET_KEY")}`,
  ).toString("base64");

async function apiGet(path: string): Promise<unknown> {
  const url = `${BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: "application/json;charset=UTF-8; qs=0.09",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET ${url} → ${response.status}\n${body.slice(0, 500)}`);
  }
  return response.json();
}

async function dump(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
  console.log(`  wrote ${path}`);
}

const [rawUrl, outputDirArg] = process.argv.slice(2);
if (!rawUrl) {
  console.error(
    "Usage: bun scripts/onshape-spike.ts <onshape-document-url> [output-dir]",
  );
  process.exit(1);
}

const ref = parseDocumentUrl(rawUrl);
const outputDir = outputDirArg ?? `tmp-onshape-spike/${ref.documentId}`;
const ctx = `/d/${ref.documentId}/${ref.wvm}/${ref.wvmId}`;

console.log(`Document ${ref.documentId} (${ref.wvm}/${ref.wvmId})`);

const documentInfo = await apiGet(`/documents/${ref.documentId}`);
await dump(`${outputDir}/document.json`, documentInfo);

const elements = (await apiGet(`/documents${ctx}/elements`)) as Array<{
  id: string;
  name: string;
  elementType: string;
}>;
await dump(`${outputDir}/elements.json`, elements);

const partStudios = elements.filter(
  (element) =>
    element.elementType === "PARTSTUDIO" &&
    (ref.elementId === null || element.id === ref.elementId),
);

if (partStudios.length === 0) {
  console.error(
    ref.elementId
      ? `Element ${ref.elementId} is not a Part Studio in this document.`
      : "No Part Studios found in this document.",
  );
  process.exit(1);
}

for (const studio of partStudios) {
  console.log(`Part Studio "${studio.name}" (${studio.id})`);
  const studioPath = `/partstudios${ctx}/e/${studio.id}`;
  const studioDir = `${outputDir}/${studio.id}`;

  await dump(
    `${studioDir}/features.json`,
    await apiGet(`${studioPath}/features`),
  );
  await dump(
    `${studioDir}/sketches.json`,
    await apiGet(`${studioPath}/sketches?output3D=true&curvePoints=true`),
  );
  await dump(`${studioDir}/parts.json`, await apiGet(`/parts${ctx}/e/${studio.id}`));

  // Feature spec metadata (parameter schemas per feature type) — useful for
  // understanding which options each feature in this studio actually uses.
  try {
    await dump(
      `${studioDir}/featurescript-specs.json`,
      await apiGet(`${studioPath}/featurespecs`),
    );
  } catch (error) {
    console.warn(`  featurespecs unavailable: ${String(error)}`);
  }
}

console.log(`\nDone. Inspect ${outputDir}/ next to:`);
console.log("  src/contracts/sketch/schema.ts");
console.log("  src/contracts/modeling/schema.ts");
