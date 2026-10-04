import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { expect, test } from "vitest";

// Policy guard (T10 [TECH] T-7, review R7; landed in T10f). Spline geometry
// has one owner (exact cubic spans) and one display tessellator. The deleted
// private interpretations must not come back, and the tessellators may be
// read only by display/output modules. `GC_MakeArcOfCircle`/`GC_MakeCircle`
// are banned by `occ-unbound-handle-producer-guard.spec.ts` (not repeated).
// Files are read as bytes (latin1), so a NUL or other binary byte cannot hide
// a file from the scan the way text tools skip "binary" files.

/** Deleted names: forbidden anywhere in `src` (T10b, T10d, T10e, T10f, T10h). */
const FORBIDDEN_NAMES = [
  "sampleSplineGeometry",
  "sampleSplineSpans",
  "sampleSolvedCubicSpans",
  "projectedSplineDisplayPoints",
  "boundaryPointIds",
  "evaluateBezier",
  "OPEN_CURVE_CHAIN_TOLERANCE",
  "offsetPolylinePoints",
] as const;

const TESSELLATORS = [
  "tessellateCubicSpans",
  "tessellateProjectedSpline",
  "tessellateBoundaryLoop",
] as const;

/**
 * The only production modules that may read a tessellator (display or
 * output). Specs are exempt (oracles). The modules defining a tessellator
 * (`spline-geometry.ts`, and `region-boundary-curves.ts` for the boundary
 * loop) need no entry for the names they define.
 */
const TESSELLATOR_ALLOWLIST: Record<string, string> = {
  "src/domain/editor/sketch-session/display.ts":
    "session display: shells, projected splines, region fill",
  "src/domain/editor/sketch-session/internals.ts":
    "session display of every spline entity (authored reconstruction)",
  "src/domain/modeling/occ/snapshot.ts": "OCC snapshot display edges",
  "src/core/sketch-tools/tools/spline.ts": "spline tool preview",
  "src/domain/export/providers/dxf-sketch-export-provider.ts":
    "DXF output polylines",
  "src/domain/measure/measurement.ts": "measurement witness polylines",
  "src/contracts/sketch/region-boundary-curves.ts":
    "tessellateBoundaryLoop draws its cubic segments with the one tessellator",
  // TEMPORARY: Trim's intersection sampling is removed in T10g; delete this
  // entry then (the D6 offset/slot polyline went in T10h).
  "src/domain/sketch-editing/operations.ts":
    "TEMPORARY until T10g (Trim intersection sampling)",
};

const EXTENSIONS = new Set([".ts", ".tsx"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

const isSpec = (path: string) => /\.spec\.tsx?$/.test(path);

function namesIn(text: string, names: readonly string[]) {
  return names.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
}

/** Tessellators a file reads but does not define. */
function tessellatorReads(text: string) {
  return namesIn(text, TESSELLATORS).filter(
    (name) => !new RegExp(`export function ${name}\\b`).test(text),
  );
}

function scan(files: readonly { path: string; text: string }[]) {
  const forbidden = files.flatMap(({ path, text }) =>
    namesIn(text, FORBIDDEN_NAMES).map((name) => `${path}: ${name}`),
  );
  const readers = new Set(
    files
      .filter(
        ({ path, text }) => !isSpec(path) && tessellatorReads(text).length,
      )
      .map(({ path }) => path),
  );
  return {
    forbidden,
    unlisted: [...readers].filter((path) => !(path in TESSELLATOR_ALLOWLIST)),
    stale: Object.keys(TESSELLATOR_ALLOWLIST).filter(
      (path) => !readers.has(path),
    ),
  };
}

test("test/static/geometry-tessellation-boundary.spec.ts", () => {
  // The scanner itself: each forbidden name and an unlisted reader are caught.
  for (const name of FORBIDDEN_NAMES)
    expect(
      scan([{ path: "src/x.ts", text: `const a = ${name}(b);` }]).forbidden,
      `The guard must catch ${name}`,
    ).toEqual([`src/x.ts: ${name}`]);
  expect(
    scan([
      {
        path: "src/domain/sketch-snapping/snap-candidates.ts",
        text: 'import { tessellateCubicSpans } from "@/contracts/sketch/spline-geometry";',
      },
    ]).unlisted,
  ).toEqual(["src/domain/sketch-snapping/snap-candidates.ts"]);
  expect(
    scan([
      {
        path: "src/contracts/sketch/spline-geometry.ts",
        text: "export function tessellateCubicSpans() {}",
      },
      {
        path: "src/domain/a.spec.ts",
        text: "tessellateBoundaryLoop(basis, loop);",
      },
    ]).unlisted,
    "Defining modules and specs need no allowlist entry.",
  ).toEqual([]);

  const root = process.cwd();
  const files = sourceFiles(join(root, "src")).map((path) => ({
    path: relative(root, path).replaceAll("\\", "/"),
    text: readFileSync(path).toString("latin1"),
  }));
  const { forbidden, unlisted, stale } = scan(files);
  expect(
    forbidden,
    "Deleted private spline/boundary interpretations must not return; use the exact span owner (spline-geometry.ts) or the region boundary owner.",
  ).toEqual([]);
  expect(
    unlisted,
    "Only display/output modules may read the tessellators; non-display consumers use exact spans (closestPointOnSolvedCubicSpans, solvedCubicSpans, cubicSpansPoleBounds).",
  ).toEqual([]);
  expect(
    stale,
    "An allowlisted module no longer reads a tessellator: remove its entry (T10g removes operations.ts).",
  ).toEqual([]);
});
