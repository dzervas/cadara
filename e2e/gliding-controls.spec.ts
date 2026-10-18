import { expect, test } from "@playwright/test";

import {
  activateProfileSlot,
  glideDoubleClick,
  toggleVisibility,
} from "./helpers/acceptance";
import { glidePress } from "./helpers/mirror-workbench";

// Finish exposes the document timeline before its translation has settled.
// Pin an intermediate frame, then finish the motion on the first real pointer
// move: a pre-glide bounding box is deterministically wrong at click time.
for (const action of [
  "double-click",
  "press",
  "profile",
  "visibility",
] as const) {
  test(`${action} measures an animated control at click time`, async ({
    page,
  }) => {
    await page.setContent(`
      <div style="position:absolute;top:100px;left:100px;width:240px;height:180px"
           data-history-panel="document" data-transition-state="active">
        <button style="width:200px;height:28px" aria-pressed="false"></button>
      </div>
      <output>idle</output>
    `);
    const name = action === "profile" ? "+ Add Profile" : "Hide Sketch Draft";
    const button = page.getByRole("button", { name, exact: true });
    await page.locator("button").evaluate(
      (element, { name, action }) => {
        element.textContent = name;
        const animation = element.parentElement!.animate(
          [{ transform: "translateY(64px)" }, { transform: "translateY(0)" }],
          { duration: 200, fill: "both" },
        );
        animation.pause();
        animation.currentTime = 100;
        document.addEventListener("pointermove", () => animation.finish(), {
          once: true,
        });
        element.addEventListener(
          action === "double-click" ? "dblclick" : "click",
          () => {
            element.setAttribute("aria-pressed", "true");
            document.querySelector("output")!.textContent = "activated";
          },
        );
      },
      { name, action },
    );

    if (action === "double-click") await glideDoubleClick(page, button);
    else if (action === "press") await glidePress(page, button);
    else if (action === "profile") await activateProfileSlot(page);
    else await toggleVisibility(page, "Hide", "Sketch Draft");

    await expect(page.locator("output")).toHaveText("activated");
  });
}
