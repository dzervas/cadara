import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

it("gives replacements distinct authoritative bases, accepts the latest alias and rejects the first alias", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-replacement-"));
  try {
    const file = resolve(directory, "recipe.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        operations: [
          {
            version: 1,
            commandId: "first",
            operation: "document.create",
            label: "First",
            basis: null,
            as: "first",
          },
          {
            version: 1,
            commandId: "second",
            operation: "document.create",
            label: "Second",
            basis: null,
            as: "second",
          },
          {
            version: 1,
            commandId: "latest",
            operation: "document.inspect",
            basis: { alias: "second" },
          },
          {
            version: 1,
            commandId: "stale-first",
            operation: "document.inspect",
            basis: { alias: "first" },
          },
          {
            version: 1,
            commandId: "never",
            operation: "document.create",
            label: "Never",
            basis: null,
          },
        ],
      }),
    );
    const failure = await exec(
      "bun",
      ["src/cli/main.ts", "document", "recipe", file],
      { cwd: root, timeout: 60000 },
    ).then(
      () => {
        throw new Error("Expected stale first alias to conflict");
      },
      (error) => error as { code: number; stdout: string; stderr: string },
    );
    expect(failure.code).toBe(1);
    const result = JSON.parse(failure.stdout);
    expect(
      result.results.map((r: { outcome: { kind: string } }) => r.outcome.kind),
    ).toEqual(["completed", "completed", "completed", "conflicted"]);
    const first = result.results[0].discovery.state;
    const second = result.results[1].discovery.state;
    expect(second.revisionId).not.toBe(first.revisionId);
    expect(second.repositoryHeads).not.toEqual(first.repositoryHeads);
    expect(result.results[2].discovery).toMatchObject({
      state: second,
      document: { label: "Second" },
      history: { canUndo: false, canRedo: false },
    });
    expect(result.results[3].completion.live.state).toEqual(second);
    expect(result.results[3].discovery).toBeNull();
    expect(result.unexecuted).toEqual(["never"]);
    expect(result.cleanup).toMatchObject({
      kind: "closed",
      resourcesReleased: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);

it("runs an isolated sequential recipe in a real Bun process with clean JSON stdout", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-recipe-"));
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
            commandId: "inspect",
            operation: "document.inspect",
            basis: { alias: "part" },
          },
        ],
      }),
    );
    const first = await exec(
      "bun",
      ["src/cli/main.ts", "document", "recipe", file],
      { cwd: root, timeout: 60000 },
    );
    expect(first.stderr).toBe("");
    const result = JSON.parse(first.stdout);
    expect(result.results.map((r: { outcome: unknown }) => r.outcome)).toEqual([
      { kind: "completed", change: "changed" },
      { kind: "completed", change: "unchanged" },
    ]);
    expect(result.results[0].discovery.document).toEqual({ label: "Plate" });
    expect(result.results[1].discovery.document).toEqual({ label: "Plate" });
    expect(result.results[0].discovery.state).toEqual(
      result.results[1].discovery.state,
    );
    expect(result.cleanup).toMatchObject({
      kind: "closed",
      resourcesReleased: true,
    });
    const probe = `
      function check() { for (const name of ['window', 'document', 'indexedDB']) if (name in globalThis) throw new Error('Unexpected browser global: ' + name); }
      check();
      const { dispatch } = await import('./src/cli/main.ts');
      process.exitCode = await dispatch(['document', 'recipe', ${JSON.stringify(file)}], () => undefined, { stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) });
      check();
    `;
    const independent = await exec("bun", ["-e", probe], {
      cwd: root,
      timeout: 60000,
    });
    expect(independent.stderr).toBe("");
    const second = JSON.parse(independent.stdout);
    expect(second.results[0].discovery.state.documentId).not.toBe(
      result.results[0].discovery.state.documentId,
    );
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        operations: [
          {
            version: 1,
            commandId: "create",
            operation: "document.create",
            label: "Retained",
            basis: null,
          },
          {
            version: 1,
            commandId: "stale",
            operation: "document.inspect",
            basis: {
              documentId: "doc_wrong",
              revisionId: "rev_wrong",
              repositoryHeads: [],
            },
          },
          {
            version: 1,
            commandId: "never",
            operation: "document.create",
            label: "Never",
            basis: null,
          },
        ],
      }),
    );
    try {
      await exec("bun", ["src/cli/main.ts", "document", "recipe", file], {
        cwd: root,
        timeout: 60000,
      });
      throw new Error("Expected recipe failure");
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      expect(failure.code).toBe(1);
      expect(failure.stderr).toBe(
        "Recipe failed; prior completed operations are retained.\n",
      );
      const stopped = JSON.parse(failure.stdout);
      expect(
        stopped.results.map(
          (r: { outcome: { kind: string } }) => r.outcome.kind,
        ),
      ).toEqual(["completed", "conflicted"]);
      expect(stopped.unexecuted).toEqual(["never"]);
      expect(stopped.results[0].discovery.document).toEqual({
        label: "Retained",
      });
      expect(stopped.results[1].completion.live.state).toEqual(
        stopped.results[0].discovery.state,
      );
    }
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        operations: [
          {
            version: 1,
            commandId: "bad",
            operation: "document.inspect",
            basis: { alias: "missing" },
          },
        ],
      }),
    );
    await expect(
      exec("bun", ["src/cli/main.ts", "document", "recipe", file], {
        cwd: root,
        timeout: 60000,
      }),
    ).rejects.toMatchObject({
      code: 2,
      stdout: "",
      stderr: "Unknown or ambiguous document alias.\n",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);
