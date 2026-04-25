## 1. Shared Camera Transition Path

- [x] 1.1 Add a shared programmatic camera transition helper in the viewport workspace domain that can interpolate between captured `ViewportCameraFrame` poses, preserve projection-specific state, and cancel or retarget an in-flight transition.
- [x] 1.2 Update the viewport camera frame utilities in `src/domain/workspace/viewport-projection.ts` so captured and applied frames include the state needed to restore orthographic and perspective views accurately.
- [x] 1.3 Integrate the transition helper into `src/components/cad/three-cad-viewport.tsx` so view-cube actions use the animated path instead of direct snap-style frame application.

## 2. Sketch Camera Entry And Exit

- [x] 2.1 Replace direct sketch framing in `src/components/cad/three-cad-viewport.tsx` and `src/domain/workspace/sketch-camera-framing.ts` with the shared animated camera transition path.
- [x] 2.2 Capture the pre-sketch viewport camera pose when a sketch session starts and keep that snapshot scoped to the active sketch session token.
- [x] 2.3 Restore the captured pre-sketch camera pose through the same animated path when sketch mode exits through finish, commit, cancel, abort, or sketch-mode `Escape`.

## 3. Verification

- [x] 3.1 Add or update domain tests for camera-frame capture, transition interpolation, and sketch-camera restore behavior.
- [x] 3.2 Add or update viewport component tests covering smooth view-cube navigation, sketch entry reframing, and sketch-exit camera restoration.
- [x] 3.3 Run `bun run test`, `bun run lint`, and `bun run build` after implementation changes land.
