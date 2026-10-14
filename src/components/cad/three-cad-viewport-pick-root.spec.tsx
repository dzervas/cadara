/**
 * T17c6 (D-4). UI lane (docs/testing.md: `src/components`, render-local
 * behaviour and wiring). Seam: `ViewportPickRoot`, the viewport's pick root,
 * rendered through a real R3F root (its own reconciler, as in the browser;
 * a stub renderer, no frames). Its `onCommit` must see the committed scene:
 * the bindings collected there hold exactly the objects mounted by that
 * commit, all attached, after a remount (the `Bvh` key) and after a
 * replacement of its children. Picking after the first Finish was dead
 * because the bindings were collected before R3F's commit.
 */
import { act, createRoot, extend } from "@react-three/fiber";
import { createRef, type ReactNode } from "react";
import * as THREE from "three";
import { expect, test } from "vitest";

import { ViewportPickRoot } from "@/components/cad/three-cad-viewport-inner-components";
import { collectBindings } from "@/infrastructure/viewport/render-picking";

extend(THREE as never);

function stubRoot() {
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
  return { root, gl };
}

const isAttachedUnder = (object: THREE.Object3D, root: THREE.Object3D) => {
  for (
    let cursor: THREE.Object3D | null = object;
    cursor;
    cursor = cursor.parent
  )
    if (cursor === root) return true;
  return false;
};

test("onCommit collects the committed pick objects: after a remount and after its children are replaced", async () => {
  const { root, gl } = stubRoot();
  await root.configure({
    gl: gl as never,
    frameloop: "never",
    size: { width: 100, height: 100, top: 0, left: 0 },
  });
  const rootRef = createRef<THREE.Group>();
  const commits: { ids: string[]; attached: boolean }[] = [];
  const onCommit = () => {
    const group = rootRef.current;
    const bindings = collectBindings(group);
    commits.push({
      ids: (bindings?.pickables ?? []).map(
        (object) => object.userData.pickId as string,
      ),
      attached:
        group !== null &&
        (bindings?.pickables ?? []).every((object) =>
          isAttachedUnder(object, group),
        ),
    });
  };
  const scene = (key: string, ids: readonly string[], token: unknown) => (
    <group key={key}>
      <ViewportPickRoot
        rootRef={rootRef}
        commitToken={token}
        onCommit={onCommit}
      >
        {ids.map(
          (id): ReactNode => (
            <mesh key={id} userData={{ pickId: id }} />
          ),
        )}
      </ViewportPickRoot>
    </group>
  );

  await act(async () => root.render(scene("sketch", ["a", "b"], 1)));
  expect(commits.at(-1), "the mounted scene").toEqual({
    ids: ["a", "b"],
    attached: true,
  });

  // The scene key changes (Finish: the `Bvh` subtree remounts) with other
  // objects: the remount's commit is collected.
  await act(async () => root.render(scene("part", ["plane", "region"], 1)));
  expect(commits.at(-1), "the remounted scene").toEqual({
    ids: ["plane", "region"],
    attached: true,
  });

  // Same key, children replaced and a new token: collected again.
  await act(async () =>
    root.render(scene("part", ["plane", "region", "edge"], 2)),
  );
  expect(commits.at(-1), "the replaced children").toEqual({
    ids: ["plane", "region", "edge"],
    attached: true,
  });
  await act(async () => root.unmount());
});
