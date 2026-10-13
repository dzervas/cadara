import { expect } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";
import type {
  SemanticCommand,
  SemanticResult,
} from "@/contracts/semantic/schema";

export async function createSketchWorkflow() {
  const opened = await createHeadlessSessionFactory().open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  const { session, initialization } = opened;
  let current: SemanticResult | undefined;
  let sequence = 0;
  async function run(input: Record<string, unknown>) {
    const { documentId, revisionId, repositoryHeads } =
      current?.completion.live.state ?? initialization.state;
    const command = {
      version: 1,
      commandId: `round-${++sequence}`,
      basis: { documentId, revisionId, repositoryHeads },
      ...input,
    };
    const checked = validateSemanticCommand(command);
    expect(checked.success, JSON.stringify(checked)).toBe(true);
    const result = await session.execute(command as SemanticCommand);
    current = result;
    expect(
      validateSemanticResult(result.correlation, result).success,
      JSON.stringify(result),
    ).toBe(true);
    return result;
  }
  async function execute(input: Record<string, unknown>) {
    const result = await run(input);
    expect(result.outcome.kind, JSON.stringify(result)).toBe("completed");
    return result;
  }
  try {
    await execute({ operation: "sketch.begin", plane: "xy" });
    return {
      run,
      execute,
      current: () => current!,
      close: () => session.close(),
    };
  } catch (error) {
    await session.close();
    throw error;
  }
}
