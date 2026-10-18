import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";
import type {
  SemanticCommand,
  SemanticResult,
} from "@/contracts/semantic/schema";

/** The private sketch history's Undo and Redo entry labels. */
export const labels = (result: SemanticResult) => ({
  undo: result.discovery!.history!.undoEntries!.map((e) => e.label),
  redo: result.discovery!.history!.redoEntries!.map((e) => e.label),
});

export async function createSketchWorkflow(options: Parameters<typeof createHeadlessSessionFactory>[0] = {}) {
  const opened = await createHeadlessSessionFactory(options).open();
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
  const draft = () => current!.discovery!.state.draft;
  /** The discovered reference to a sketch point, entity or constraint by id. */
  function ref(id: string) {
    const found = current!.discovery!.references.find(
      ({ target }) =>
        (target.kind === "sketchPoint" && target.pointId === id) ||
        (target.kind === "sketchEntity" && target.entityId === id) ||
        (target.kind === "constraint" && target.constraintId === id),
    );
    if (!found) throw new Error(`No discovered reference to ${id}.`);
    return found.target;
  }
  /** One `sketch.author` round into the current draft. */
  const author = (primitive: Record<string, unknown>, construction = false) =>
    execute({
      operation: "sketch.author",
      draft: draft(),
      primitive,
      construction,
      intent: "fulfill",
    });
  /** `document.save` to a scratch file and the native document it wrote. */
  async function saveAndRead(): Promise<AuthoredModelDocument> {
    const directory = await mkdtemp(resolve(tmpdir(), "cadara-semantic-save-"));
    try {
      const path = resolve(directory, "saved.cadara");
      await execute({ operation: "document.save", path });
      return JSON.parse(await readFile(path, "utf8")) as AuthoredModelDocument;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  try {
    await execute({ operation: "sketch.begin", plane: "xy" });
    return {
      run,
      execute,
      current: () => current!,
      draft,
      ref,
      author,
      saveAndRead,
      close: () => session.close(),
    };
  } catch (error) {
    await session.close();
    throw error;
  }
}
