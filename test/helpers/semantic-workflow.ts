import { createHeadlessSessionFactory } from "@/composition/headless";
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
      basis: current?.completion.live.state ?? initialization.state,
      ...input,
    } as unknown as SemanticCommand);
    return current;
  }
  async function execute(input: Record<string, unknown>) {
    const result = await run(input);
    if (result.outcome.kind !== "completed")
      throw new Error(JSON.stringify(result));
    return result;
  }
  try {
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
