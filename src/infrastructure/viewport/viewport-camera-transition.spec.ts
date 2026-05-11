import { expect, test } from "bun:test";

import * as THREE from "three";

import { createViewportCameraTransitionController } from "@/infrastructure/viewport/viewport-camera-transition";
import type { ViewportCameraFrame } from "@/infrastructure/viewport/viewport-projection";

test("src/infrastructure/viewport/viewport-camera-transition.spec.ts", () => {
  function createFrame(input: {
    position: readonly [number, number, number];
    target?: readonly [number, number, number];
    projectionMode?: "orthographic" | "perspective";
    orthographicZoom?: number;
  }): ViewportCameraFrame {
    const target = new THREE.Vector3(...(input.target ?? [0, 0, 0]));
    const position = new THREE.Vector3(...input.position);
    const cameraDistance = position.distanceTo(target);

    return {
      projectionMode: input.projectionMode ?? "orthographic",
      position,
      target,
      up: new THREE.Vector3(0, 0, 1),
      cameraDistance,
      perspectiveDistance: cameraDistance,
      orthographicZoom: input.orthographicZoom ?? 1,
    };
  }

  function approx(actual: number, expected: number, epsilon = 1e-6) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
  }

  {
    const controller = createViewportCameraTransitionController();
    const startFrame = createFrame({
      position: [0, -10, 10],
      orthographicZoom: 1,
    });
    const endFrame = createFrame({
      position: [10, 0, 10],
      orthographicZoom: 2,
    });

    controller.start({
      fromFrame: startFrame,
      toFrame: endFrame,
      durationMs: 200,
    });

    const firstStep = controller.advance(100);
    expect(firstStep).toBeTruthy();
    expect(firstStep.completed === false).toBeTruthy();
    expect(firstStep.frame.position.x > 0).toBeTruthy();
    expect(firstStep.frame.orthographicZoom > 1).toBeTruthy();

    const finalStep = controller.advance(100);
    expect(finalStep?.completed === true).toBeTruthy();
    approx(finalStep?.frame.position.x ?? 0, 10);
    expect(controller.isActive() === false).toBeTruthy();
  }

  {
    const controller = createViewportCameraTransitionController();
    const originalTarget = createFrame({ position: [0, -12, 12] });
    const retargeted = createFrame({
      position: [12, 0, 12],
      projectionMode: "perspective",
      orthographicZoom: 0.8,
    });

    controller.start({
      fromFrame: createFrame({ position: [0, 0, 12] }),
      toFrame: originalTarget,
      durationMs: 300,
    });
    const inFlight = controller.advance(120);
    expect(inFlight).toBeTruthy();

    controller.start({
      fromFrame: inFlight.frame,
      toFrame: retargeted,
      durationMs: 180,
    });

    expect(controller.getTargetFrame()?.projectionMode).toBe("perspective");
    const completed = controller.advance(180);
    expect(completed?.completed === true).toBeTruthy();
    approx(completed?.frame.position.x ?? 0, 12);
  }

  {
    const controller = createViewportCameraTransitionController();
    controller.start({
      fromFrame: createFrame({ position: [0, -8, 8] }),
      toFrame: createFrame({ position: [0, 8, 8] }),
      durationMs: 250,
    });

    controller.cancel();
    expect(controller.advance(16) === null).toBeTruthy();
    expect(controller.isActive() === false).toBeTruthy();
  }
});
