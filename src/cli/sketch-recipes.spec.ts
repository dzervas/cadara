import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

it("runs private rectangle authoring and publication with client-only basis and draft aliases", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-sketch-recipe-"));
  try {
    const file = resolve(directory, "recipe.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        operations: [
          {
            version: 1,
            commandId: "create",
            operation: "document.create",
            label: "Plate",
            basis: null,
            as: "part",
          },
          {
            version: 1,
            commandId: "begin",
            operation: "sketch.begin",
            basis: { alias: "part" },
            plane: "xy",
            as: "empty",
          },
          {
            version: 1,
            commandId: "rectangle",
            operation: "sketch.author",
            basis: { alias: "empty" },
            draft: { alias: "empty" },
            primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
            construction: false,
            intent: "fulfill",
            as: "rectangle",
          },
          {
            version: 1,
            commandId: "publish",
            operation: "sketch.publish",
            basis: { alias: "rectangle" },
            draft: { alias: "rectangle" },
            requireProfiles: true,
            as: "published",
          },
          {
            version: 1,
            commandId: "inspect",
            operation: "document.inspect",
            basis: { alias: "published" },
          },
        ],
      }),
    );
    const output = await exec(
      "bun",
      ["src/cli/main.ts", "document", "recipe", file],
      { cwd: root, timeout: 90000 },
    );
    expect(output.stderr).toBe("");
    const result = JSON.parse(output.stdout);
    expect(
      result.results.map((r: { outcome: { kind: string } }) => r.outcome.kind),
    ).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(
      result.results[2].discovery.sketch.points.map(
        (p: { position: unknown }) => p.position,
      ),
    ).toEqual([
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ]);
    expect(result.results[2].discovery.state.draft).not.toBeNull();
    expect(result.results[3].discovery.state.draft).toBeNull();
    expect(result.results[3].completion.persistence.kind).toBe("committed");
    expect(result.results[3].discovery.sketch.profiles).toEqual([
      { regionId: expect.any(String), isClosed: true },
    ]);
    expect(
      result.results[4].discovery.references.some(
        (r: { target: { kind: string } }) => r.target.kind === "region",
      ),
    ).toBe(true);
    expect(result.cleanup).toMatchObject({
      kind: "closed",
      resourcesReleased: true,
    });
    expect(result.unexecuted).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
