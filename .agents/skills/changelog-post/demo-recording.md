# Demo recording

The demo is a GIF of one headline feature, made with a throwaway Playwright script against a local build of `main@origin`.

## Serve the right tree

The demo must show `main@origin`. If `@` is not on it, create a private workspace with `jj workspace add .pi/worktrees/demo -r main@origin`, then run `bun install --frozen-lockfile` inside it. Port 3000 often belongs to another server, so serve on your own port: `bunx vite --port 31NN`. Start the server in the same shell command as the script, because a background server dies with the shell that started it. The toolchain (bun, playwright, ffmpeg) is in `.devenv/profile/bin`. Remove the workspace when you are done.

## Script

Write the script under `.scratch/community/demo/`. The fastest start is the feature's own E2E spec: find it among the files the group's commits touched under `e2e/`, or search `e2e/` for the feature's wording. Reuse `e2e/helpers/` to open the app and reach a state. Example models live in `landing/examples/*/model.cadara`. A populated model reads better than an empty sketch.

Shot rules:

- 1280×720 viewport, dark theme as shipped, 3–8 seconds of action.
- Start from a settled view. The loading overlay, error toasts and debug UI stay out of the frame.
- Show the one thing the headline promises. Frame it so it is large enough to read at 800 px wide.

## Capture

Headless Chromium renders WebGL in software at roughly 100–200 ms per frame, so a recorded video stutters. Capture **frame by frame** instead: split the interaction into small scripted steps (for example 40 `mouse.move` increments for a drag) and take `page.screenshot` after each one once the canvas has settled. Use `recordVideo` only when the timing is itself the subject, such as a progress bar.

```sh
ffmpeg -y -framerate 15 -i frame-%03d.png \
  -vf "scale=800:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" demo.gif
```

For a video, use `-i video.webm` with `fps=15,` at the start of the filter. Keep the GIF under 10 MB, the bot upload limit. If it is over, lower the fps or the width.

## Check

Extract the first, middle and last frames (`ffmpeg -i demo.gif -vf "select=eq(n\,K)" -frames:v 1 f.png`) and look at them. The demo is done when the feature is clearly visible and nothing in any of the frames is loading, broken or debug-only. Then tell the user the path so they can watch the GIF themselves.
