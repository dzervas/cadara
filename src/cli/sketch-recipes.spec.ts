import { expect, it } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

it("runs both documented command families and opens a native file over a private draft", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-combined-recipe-"));
  try {
    const help = await exec(
      "bun",
      [cliEntry(), "document", "recipe", "--help"],
      { cwd: root },
    );
    const recipe = JSON.parse(help.stdout.slice(help.stdout.indexOf("{")));
    const path = resolve(directory, "part.cadara");
    for (const operation of recipe.operations) {
      if ("path" in operation) operation.path = path;
    }
    recipe.operations.push(
      {
        version: 1,
        commandId: "begin-before-open",
        operation: "sketch.begin",
        basis: { alias: "opened" },
        plane: "xy",
        as: "private-before-open",
      },
      {
        version: 1,
        commandId: "open-over-private",
        operation: "document.open",
        path,
        basis: null,
        as: "reopened",
      },
      {
        version: 1,
        commandId: "inspect-reopened",
        operation: "document.inspect",
        basis: { alias: "reopened" },
      },
    );
    const file = resolve(directory, "recipe.json");
    await writeFile(file, JSON.stringify(recipe));
    const output = await exec("bun", [cliEntry(), "document", "recipe", file], {
      cwd: root,
      timeout: 90000,
    });
    const result: {
      results: SemanticResult[];
      unexecuted: string[];
      cleanup: { kind: string };
    } = JSON.parse(output.stdout);
    expect(result.results.map((r) => r.correlation.family)).toEqual([
      "document",
      "sketch-open",
      "sketch-author",
      "sketch-publish",
      "model-mutate",
      "document",
      "file-save",
      "file-open",
      "document",
      "sketch-open",
      "file-open",
      "document",
    ]);
    expect(result.results.map((r) => r.outcome.kind)).toEqual(
      Array(12).fill("completed"),
    );
    expect(
      result.results[2]!.discovery!.sketch!.points.map((p) => p.position),
    ).toEqual([
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ]);
    expect(result.results[9]!.discovery!.state.draft).not.toBeNull();
    expect(result.results[10]!.completion.persistence.kind).toBe("committed");
    expect(result.results[10]!.completion.handoff.kind).toBe("current");
    expect(result.results[11]!.discovery!.state).toMatchObject({
      editingContext: { kind: "document" },
      draft: null,
    });
    expect(
      result.results[11]!.discovery!.references.filter(
        (r) => r.target.kind === "sketch",
      ),
    ).toHaveLength(1);
    expect(result.unexecuted).toEqual([]);
    expect(result.cleanup.kind).toBe("closed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

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
    const output = await exec("bun", [cliEntry(), "document", "recipe", file], {
      cwd: root,
      timeout: 90000,
    });
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
