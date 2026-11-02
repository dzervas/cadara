// UI lane: the Create team form's static contract: a name and URL name, the
// team plan's billing stated up front, and refusals shown inline.
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { workbenchTheme } from "@/theme/workbench-theme";
import { CreateTeamForm, type CreateTeamFormProps } from "./create-team-modal";

function render(overrides: Partial<CreateTeamFormProps> = {}) {
  return renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <CreateTeamForm
        busy={false}
        error={null}
        onCancel={() => undefined}
        onSubmit={() => undefined}
        {...overrides}
      />
    </MantineProvider>,
  );
}

test("the form asks for a name and URL name and says the team plan is billed per editor seat at checkout", () => {
  const html = render();
  expect(html).toContain("Team name");
  expect(html).toContain("URL name");
  expect(html).toContain("billed per editor seat");
  expect(html).toContain("Continue to checkout");
  // A team is always on the team plan: no plan to pick and no price quoted.
  expect(html).not.toMatch(/type="radio"|role="radiogroup"/);
  expect(html).not.toMatch(/[$€£]\s*\d|\d\s*[$€£]|\/\s*mo(?:nth)?\b/i);
  // Nothing to create until the team has a name.
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
});

test("a refusal is shown inline", () => {
  expect(render({ error: "Another team already uses that URL name." })).toMatch(
    /role="alert"[^>]*>Another team already uses that URL name\./,
  );
});
