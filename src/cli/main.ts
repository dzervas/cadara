#!/usr/bin/env bun
/**
 * `cadara` CLI entrypoint — a hand-rolled subcommand dispatcher.
 *
 * Routes `cadara <group> <command> [args]` to a registered {@link CommandModule}
 * and owns usage output plus the exit-code policy (0 success, 1 command
 * failure, 2 usage error). New subcommands are added by registration, never by
 * restructuring this file.
 */
import { onshapeCaptureCommand } from "@/cli/commands/onshape-capture";
import type { CliEnv, CliIO, CommandModule } from "@/cli/types";

/** Registered subcommands. Add new commands here. */
export const commandRegistry: readonly CommandModule[] = [onshapeCaptureCommand];

function commandTokens(name: string): string[] {
  return name.split(" ").filter(Boolean);
}

function matchesCommand(name: string, argv: readonly string[]): boolean {
  const tokens = commandTokens(name);
  return tokens.every((token, index) => argv[index] === token);
}

function formatUsage(commands: readonly CommandModule[]): string {
  const lines = ["Usage: cadara <group> <command> [args]", "", "Commands:"];
  for (const command of commands) {
    lines.push(`  ${command.name.padEnd(24)}${command.description}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Dispatch a single CLI invocation. Returns the process exit code without ever
 * calling `process.exit`, so tests can assert routing and exit-code policy
 * directly.
 */
export async function dispatch(
  argv: readonly string[],
  env: CliEnv,
  io: CliIO,
  commands: readonly CommandModule[] = commandRegistry,
): Promise<number> {
  const command = commands.find((candidate) =>
    matchesCommand(candidate.name, argv),
  );

  if (!command) {
    io.stderr(formatUsage(commands));
    return 2;
  }

  const rest = argv.slice(commandTokens(command.name).length);
  const result = await command.run([...rest], env, io);

  if (result.ok) {
    return 0;
  }

  io.stderr(`${result.message}\n`);
  return result.kind === "usage" ? 2 : 1;
}

// Bun sets `import.meta.main` for the entry module; it is absent under test.
if ((import.meta as { main?: boolean }).main) {
  void dispatch(
    process.argv.slice(2),
    (name) => process.env[name],
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
  ).then((code) => process.exit(code));
}
