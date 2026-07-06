import { test, expect } from "vitest";

import { dispatch } from "@/cli/main";
import type { CliIO, CommandModule } from "@/cli/types";

function makeIO(): CliIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
}

const noEnv = () => undefined;

test("main.spec.ts routes to the matching command with remaining args", async () => {
  const received: { argv: string[] } = { argv: [] };
  const command: CommandModule = {
    name: "onshape capture",
    description: "test",
    run: async (argv) => {
      received.argv = argv;
      return { ok: true };
    },
  };

  const io = makeIO();
  const code = await dispatch(
    ["onshape", "capture", "https://example.com/doc", "out.json"],
    noEnv,
    io,
    [command],
  );

  expect(code, "A routed, successful command exits 0.").toBe(0);
  expect(
    received.argv,
    "The command receives only the args after its name tokens.",
  ).toEqual(["https://example.com/doc", "out.json"]);
});

test("main.spec.ts prints usage and exits 2 for an unknown command", async () => {
  const command: CommandModule = {
    name: "onshape capture",
    description: "Capture an Onshape document.",
    run: async () => ({ ok: true }),
  };
  const io = makeIO();

  const code = await dispatch(["bogus", "command"], noEnv, io, [command]);

  expect(code, "Unknown commands exit with usage code 2.").toBe(2);
  expect(io.out, "Usage errors must not go to stdout.").toEqual([]);
  expect(
    io.err.join(""),
    "Usage output lists the available commands on stderr.",
  ).toContain("onshape capture");
});

test("main.spec.ts exits 2 for a command-reported usage error", async () => {
  const command: CommandModule = {
    name: "onshape capture",
    description: "test",
    run: async () => ({ ok: false, kind: "usage", message: "bad url" }),
  };
  const io = makeIO();

  const code = await dispatch(["onshape", "capture"], noEnv, io, [command]);

  expect(code).toBe(2);
  expect(io.err.join("")).toContain("bad url");
});

test("main.spec.ts exits 1 and surfaces the failure detail for a failing command", async () => {
  const command: CommandModule = {
    name: "onshape capture",
    description: "test",
    run: async () => ({
      ok: false,
      kind: "failure",
      message: "GET /features → HTTP 500",
    }),
  };
  const io = makeIO();

  const code = await dispatch(["onshape", "capture", "url"], noEnv, io, [
    command,
  ]);

  expect(code, "Command failures exit with code 1.").toBe(1);
  expect(
    io.err.join(""),
    "The underlying failure detail is passed through unaltered.",
  ).toContain("HTTP 500");
});
