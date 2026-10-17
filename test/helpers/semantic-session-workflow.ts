import { createHeadlessSessionFactory } from "@/composition/headless";
import type { SemanticCommand, SemanticResult } from "@/contracts/semantic/schema";

/** Raw public-command runner: callers retain their own validation/outcome policy. */
export async function createSemanticSessionWorkflow(
  prefix: string,
  options: Parameters<typeof createHeadlessSessionFactory>[0] = {},
) {
  const opened = await createHeadlessSessionFactory(options).open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  const { session, initialization } = opened;
  let current: SemanticResult | undefined;
  let sequence = 0;
  async function run(
    input: Record<string, unknown>,
    options?: Parameters<typeof session.execute>[1],
  ) {
    current = await session.execute(
      {
        version: 1,
        commandId: input.commandId ?? `${prefix}-${++sequence}`,
        basis: current?.completion.live.state ?? initialization.state,
        ...input,
      } as unknown as SemanticCommand,
      options,
    );
    return current;
  }
  return {
    session,
    run,
    current: () => current!,
    close: () => session.close(),
  };
}
