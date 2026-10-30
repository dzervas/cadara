import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execCliTestProcess } from "./cli-recipe-process";

describe.sequential("CLI subprocess test deadline", () => {
  let directory: string | undefined;
  let signal: AbortSignal;
  let outcome: Promise<unknown>;

  // The expected failure is the real runner deadline, not a simulated abort.
  it.fails(
    "aborts an active child when Vitest reaches the test deadline",
    async (context) => {
      signal = context.signal;
      directory = await mkdtemp(join(tmpdir(), "cadara-cli-cancel-"));
      outcome = execCliTestProcess(
        process.execPath,
        [
          "-e",
          `process.on('SIGTERM', () => {});
           require('node:fs').writeFileSync(process.argv[1], String(process.pid));
           setTimeout(() => process.exit(0), 10000);`,
          join(directory, "child.pid"),
        ],
        { encoding: "utf8", signal },
      ).then(
        () => "completed without cancellation",
        (error: unknown) => error,
      );
      await outcome;
    },
    1000,
  );

  it("reaps the child instead of leaving work running after the deadline", async () => {
    expect(signal.aborted).toBe(true);
    expect(signal.reason.message).toContain("Test timed out");
    expect(await outcome).toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
    });
    const pid = Number(await readFile(join(directory!, "child.pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrowError(/ESRCH/);
  }, 3000);

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });
});
