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
