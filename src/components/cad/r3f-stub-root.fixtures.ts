import { createRoot, extend } from "@react-three/fiber";
import * as THREE from "three";

extend(THREE as never);

/**
 * A real R3F root (its own reconciler, as in the browser) on a stub WebGL
 * renderer that never draws; `frameloop: "never"`, so `useFrame` callbacks
 * do not run. For UI-lane specs of viewport scene nodes.
 */
export async function createStubR3fRoot() {
  const canvas = {
    style: {},
    width: 100,
    height: 100,
    addEventListener() {},
    removeEventListener() {},
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
  const gl = {
    domElement: canvas,
    render() {},
    setSize() {},
    setPixelRatio() {},
    getPixelRatio: () => 1,
    setAnimationLoop() {},
    dispose() {},
    shadowMap: {},
    info: { render: {} },
    xr: {
      enabled: false,
      isPresenting: false,
      addEventListener() {},
      removeEventListener() {},
      setAnimationLoop() {},
    },
  };
  const root = createRoot(canvas);
  await root.configure({
    gl: gl as never,
    frameloop: "never",
    size: { width: 100, height: 100, top: 0, left: 0 },
  });
  return root;
}

/**
 * Replaces `requestIdleCallback` (absent in the spec runtime) with a queue
 * the spec drains, so work deferred to idle time (the pick BVH builds) runs
 * exactly when the spec says, never inside a render's `act`.
 */
export function installManualIdleCallbacks() {
  const pending = new Map<number, IdleRequestCallback>();
  let nextHandle = 1;
  const target = globalThis as {
    requestIdleCallback?: typeof requestIdleCallback;
    cancelIdleCallback?: typeof cancelIdleCallback;
  };
  const previous = {
    requestIdleCallback: target.requestIdleCallback,
    cancelIdleCallback: target.cancelIdleCallback,
  };
  target.requestIdleCallback = (callback) => {
    const handle = nextHandle++;
    pending.set(handle, callback);
    return handle;
  };
  target.cancelIdleCallback = (handle) => {
    pending.delete(handle);
  };

  return {
    /** Runs every queued idle callback (and those they queue) with time to spare. */
    runIdlePeriods() {
      while (pending.size > 0) {
        const [handle, callback] = pending.entries().next().value!;
        pending.delete(handle);
        callback({ didTimeout: false, timeRemaining: () => 50 });
      }
    },
    restore() {
      target.requestIdleCallback = previous.requestIdleCallback;
      target.cancelIdleCallback = previous.cancelIdleCallback;
    },
  };
}
