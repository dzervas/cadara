import { createHeadlessSessionFactory } from "@/composition/headless";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";
import type {
  SemanticCommand,
  SemanticResult,
} from "@/contracts/semantic/schema";

/** Public-command fixture shared by native export and the full workflow gate. */
export async function createPlateWorkflow(
  options: Parameters<typeof createHeadlessSessionFactory>[0] = {},
) {
  const opened = await createHeadlessSessionFactory(options).open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  const { session, initialization } = opened;
  let current: SemanticResult | undefined;
  let sequence = 0;
  async function run(input: Record<string, unknown>) {
    current = await session.execute({
      version: 1,
      commandId: `workflow-${++sequence}`,
      basis: (() => {
        const { documentId, revisionId, repositoryHeads } =
          current?.completion.live.state ?? initialization.state;
        return { documentId, revisionId, repositoryHeads };
      })(),
      ...input,
    } as unknown as SemanticCommand);
    return current;
  }
  async function execute(input: Record<string, unknown>) {
    const state = current?.completion.live.state ?? initialization.state;
    const command = {
      version: 1,
      commandId: `workflow-${sequence + 1}`,
      basis: {
        documentId: state.documentId,
        revisionId: state.revisionId,
        repositoryHeads: state.repositoryHeads,
      },
      ...input,
    };
    const validation = validateSemanticCommand(command);
    if (!validation.success) throw new Error(JSON.stringify(validation));
    const result = await run(input);
    const checked = validateSemanticResult(result.correlation, result);
    if (!checked.success) throw new Error(JSON.stringify(checked));
    if (result.outcome.kind !== "completed")
      throw new Error(JSON.stringify(result));
    return result;
  }
  try {
    await execute({
      operation: "document.create",
      label: "Workflow plate",
      basis: null,
    });
    await execute({ operation: "sketch.begin", plane: "xy" });
    await execute({
      operation: "sketch.author",
      draft: current!.discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const points = current!.discovery!.sketch!.points;
    for (const dimension of [
      {
        axis: "horizontal",
        points: [points[0]!.pointId, points[1]!.pointId],
        value: 20,
      },
      {
        axis: "vertical",
        points: [points[1]!.pointId, points[2]!.pointId],
        value: 10,
      },
    ])
      await execute({
        operation: "sketch.dimension.add",
        draft: current!.discovery!.state.draft,
        ...dimension,
        mode: "driving",
        intent: "fulfill",
      });
    const published = await execute({
      operation: "sketch.publish",
      draft: current!.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const solid = await execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 7,
      intent: "fulfill",
    });
    return {
      session,
      execute,
      run,
      published,
      solid,
      current: () => current!,
      close: () => session.close(),
    };
  } catch (error) {
    await session.close();
    throw error;
  }
}
