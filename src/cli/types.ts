/**
 * Shared contracts for the `cadara` CLI shell and its subcommands.
 *
 * These types are deliberately free of any browser-bound dependency: the CLI
 * runs under Bun/Node and shares only `src/contracts/` and `src/domain/` code
 * with the app.
 */

/** Output sink injected into commands so tests can capture stdout/stderr. */
export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Environment accessor injected into commands (defaults to `process.env`). */
export type CliEnv = (name: string) => string | undefined;

/** Result of running a command module. */
export type CommandResult =
  | { ok: true }
  | { ok: false; kind: "usage" | "failure"; message: string };

/**
 * A registered subcommand. Command modules own their own argument parsing and
 * return a structured result; the dispatcher owns usage output and exit codes.
 */
export interface CommandModule {
  /** Space-joined command path, e.g. `onshape capture`. */
  readonly name: string;
  readonly description: string;
  run(argv: string[], env: CliEnv, io: CliIO): Promise<CommandResult>;
}
