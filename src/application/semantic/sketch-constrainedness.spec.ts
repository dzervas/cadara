import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("reports the remaining size and position freedoms of a primitive rectangle", async () => {
  const workflow = await createSketchWorkflow();
  try {
    const authored = await workflow.author({
      kind: "rectangle",
      start: [-50, -35],
      end: [50, 35],
    });
    expect(authored.discovery!.sketch!.solveStatus).toMatchObject({
      solveState: "solved",
      constraintState: "underConstrained",
    });
    const points = authored.discovery!.sketch!.points;
    for (const dimension of [
      {
        axis: "horizontal",
        points: [points[0]!.pointId, points[1]!.pointId],
        value: 100,
      },
      {
        axis: "vertical",
        points: [points[1]!.pointId, points[2]!.pointId],
        value: 70,
      },
    ]) {
      const sized = await workflow.execute({
        operation: "sketch.dimension.add",
        draft: workflow.draft(),
        ...dimension,
        mode: "driving",
        intent: "fulfill",
      });
      expect(sized.discovery!.sketch!.solveStatus.constraintState).toBe(
        "underConstrained",
      );
    }
    const positioned = await workflow.execute({
      operation: "sketch.requirement.add",
      draft: workflow.draft(),
      tool: "constraintFix",
      targets: [workflow.ref(points[0]!.pointId)],
      mode: "driving",
      value: null,
      intent: "fulfill",
    });
    expect(positioned.discovery!.sketch!.solveStatus).toEqual({
      solveState: "solved",
      constraintState: "wellConstrained",
    });
    const published = await workflow.execute({
      operation: "sketch.publish",
      draft: workflow.draft(),
      requireProfiles: true,
    });
    expect(published.discovery!.sketch!.solveStatus).toEqual(
      positioned.discovery!.sketch!.solveStatus,
    );
  } finally {
    await workflow.close();
  }
});
