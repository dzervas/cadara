import { expect, test, type Locator } from "@playwright/test";

// Lane: e2e (docs/testing.md). Seam: the spark logo's hover and press
// styles as the browser resolves the cascade of the app CSS against
// Mantine's ActionIcon stylesheet. Mantine's hover rule repainted the tile
// with the graphite primary and white ink, and a stronger hover rule must
// not outlast the press; only the browser computes which rule wins. The
// expected colours are the theme tokens themselves, resolved in the page.

test("hovering the spark logo keeps the spark accent tile with its dark ink and lifts it; pressing drops the lift", async ({
  page,
}) => {
  await page.goto("/app");
  const logo = page.getByRole("button", { name: "File", exact: true });
  await expect(logo).toBeVisible();
  const tokens = await resolveTokens(logo);

  await expect
    .poll(() => paint(logo), { message: "the logo at rest" })
    .toEqual({ background: tokens.accent, ink: tokens.ink });

  await logo.hover();
  await expect
    .poll(() => paint(logo), {
      message: "the hovered logo keeps the spark hover tile and dark ink",
    })
    .toEqual({ background: tokens.accentHover, ink: tokens.ink });
  await expect
    .poll(() => lift(logo), { message: "the hovered logo lifts" })
    .toEqual({ raised: true, enlarged: true });

  // Pressing settles the lifted tile back, while the pointer still hovers.
  await page.mouse.down();
  await expect
    .poll(() => lift(logo), { message: "the pressed logo drops its lift" })
    .toEqual({ raised: false, enlarged: false });
  await page.mouse.up();
});

/** The theme tokens as computed colours, via a probe inside the logo. */
async function resolveTokens(logo: Locator) {
  return logo.evaluate((element) => {
    const probe = document.createElement("span");
    element.append(probe);
    const resolve = (token: string) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const tokens = {
      accent: resolve("--workbench-spark-accent"),
      accentHover: resolve("--workbench-spark-accent-hover"),
      ink: resolve("--workbench-spark-accent-ink"),
    };
    probe.remove();
    return tokens;
  });
}

/** Whether the logo's computed transform raises or enlarges the tile. */
async function lift(logo: Locator) {
  return logo.evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { raised: matrix.f < -0.01, enlarged: matrix.a > 1.001 };
  });
}

async function paint(logo: Locator) {
  return logo.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, ink: style.color };
  });
}
