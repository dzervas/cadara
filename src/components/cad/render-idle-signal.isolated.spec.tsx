import { act } from "@react-three/fiber";
import { createElement } from "react";
import { expect, test, vi } from "vitest";

import { createStubR3fRoot } from "@/components/cad/r3f-stub-root.fixtures";
import { RenderIdleSignal } from "@/components/cad/three-cad-viewport-inner-components";

test("busy editor frames stop while scene changes and idle readiness still request frames", async () => {
  const root = await createStubR3fRoot();
  const attributes = new Map<string, string>();
  const viewportRef = {
    current: {
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLDivElement,
  };
  const signal = (isEditorIdle: boolean, sceneKey = "scene-a") =>
    createElement(RenderIdleSignal, { isEditorIdle, sceneKey, viewportRef });
  const store = root.render(signal(false));
  const invalidate = vi.fn();
  try {
    await act(async () => store.setState({ invalidate }));
    invalidate.mockClear();
    for (let frame = 1; frame <= 10; frame += 1) {
      store.getState().advance(frame);
    }
    expect(
      invalidate,
      "unchanged feature/sketch editing must not keep the renderer running",
    ).not.toHaveBeenCalled();
    expect(attributes.has("data-render-idle")).toBe(false);

    await act(async () => root.render(signal(false, "scene-b")));
    expect(
      invalidate,
      "a changed scene still schedules a frame",
    ).toHaveBeenCalled();
    invalidate.mockClear();
    store.getState().advance(11);
    expect(invalidate).not.toHaveBeenCalled();
    expect(attributes.has("data-render-idle")).toBe(false);

    await act(async () => root.render(signal(true, "scene-b")));
    expect(
      invalidate,
      "returning to idle starts the readiness proof",
    ).toHaveBeenCalled();
    // Seconds between frames are deliberate: readiness has no minimum FPS.
    store.getState().advance(12);
    expect(attributes.has("data-render-idle")).toBe(false);
    store.getState().advance(13);
    expect(attributes.has("data-render-idle")).toBe(false);
    store.getState().advance(14);
    expect(attributes.get("data-render-idle")).toBe("true");
    invalidate.mockClear();
    store.getState().advance(15);
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => root.render(signal(true, "scene-c")));
    expect(
      invalidate,
      "visible changes re-arm an idle scene",
    ).toHaveBeenCalled();
    expect(attributes.has("data-render-idle")).toBe(false);
    for (const time of [16, 17, 18, 19]) store.getState().advance(time);
    expect(attributes.get("data-render-idle")).toBe("true");

    await act(async () => root.render(signal(false, "scene-c")));
    expect(attributes.has("data-render-idle")).toBe(false);
    invalidate.mockClear();
    store.getState().advance(20);
    expect(invalidate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
