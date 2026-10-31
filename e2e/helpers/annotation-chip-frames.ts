import type { SketchWorkbenchHarness } from "./sketch-workbench";

type FrameRecorder = {
  frames: { id: string; x: number; y: number }[];
  stop: () => void;
};

/**
 * Every drawn position (centre) of the annotation chips `ids` at each frame
 * and DOM change while `action` runs and the page settles, so a chip drawn
 * away for a single frame is seen.
 */
export async function recordAnnotationChips(
  workbench: SketchWorkbenchHarness,
  ids: readonly string[],
  action: () => Promise<void>,
) {
  const page = workbench.page;
  await page.evaluate((ids) => {
    const recorder: FrameRecorder = { frames: [], stop: () => {} };
    const record = () => {
      for (const id of ids) {
        const box = document
          .querySelector(`[data-sketch-annotation-id="${id}"]`)
          ?.getBoundingClientRect();
        if (box) {
          recorder.frames.push({
            id,
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
          });
        }
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    let frame = 0;
    const tick = () => {
      record();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    recorder.stop = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    (
      window as unknown as { __cadaraChipFrames: FrameRecorder }
    ).__cadaraChipFrames = recorder;
  }, ids);
  await action();
  for (let round = 0; round < 12; round += 1) {
    await page.waitForTimeout(round === 11 ? 500 : 0);
    await workbench.waitForAnimationFrames(2);
  }
  return page.evaluate(() => {
    const recorder = (
      window as unknown as { __cadaraChipFrames: FrameRecorder }
    ).__cadaraChipFrames;
    recorder.stop();
    return recorder.frames;
  });
}
