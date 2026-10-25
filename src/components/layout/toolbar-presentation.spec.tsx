import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolbarToolIcon } from "@/components/layout/toolbar-tool-icon";
import { ToolbarTooltipContent } from "@/components/layout/toolbar-tooltip-content";
import { WorkbenchIcon } from "@/components/ui/workbench-icon";
import { SvgIcon } from "@/components/ui/svg-icon";

// UI lane: the same synchronous inline renderer serves toolbars, menus,
// annotations and the single-file build without external SVG requests.
test("tool icons render inline with inherited ink and theme-owned click highlights", () => {
  const markup = renderToStaticMarkup(<ToolbarToolIcon icon="extrude" />);
  expect(markup).toContain('data-icon="extrude.svg"');
  expect(markup).toContain('data-icon-highlight="true"');
  expect(markup).toContain("<svg");
  expect(markup).toContain('stroke="currentColor"');
  expect(markup).toContain("var(--cadara-icon-action, currentColor)");
  expect(markup).not.toContain("</svg>\n");
  expect(markup).not.toContain("<img");
  expect(markup).not.toContain("/icons/");
  expect(markup).not.toContain("filter:");
});

test("shell and annotation icons keep click accents neutral and honor host sizing", () => {
  const shell = renderToStaticMarkup(
    <WorkbenchIcon name="ruler" size={16} style={{ color: "red" }} />,
  );
  expect(shell).toContain('data-icon="shell-ruler.svg"');
  expect(shell).toContain("width:16px;height:16px;color:red");
  expect(shell).not.toContain("data-icon-highlight");
  const annotation = renderToStaticMarkup(
    <SvgIcon fileName="constraintParallel.svg" className="h-4 w-4" />,
  );
  expect(annotation).toContain('class="cadara-icon h-4 w-4"');
  expect(annotation).not.toContain("data-icon-highlight");
  expect(annotation).toContain('aria-hidden="true"');
  expect(() =>
    renderToStaticMarkup(<SvgIcon fileName="missing.svg" />),
  ).toThrow("Unknown icon asset");
});

test("tooltips retain descriptive, wrapping copy and shared contrast tokens", () => {
  const markup = renderToStaticMarkup(
    <ToolbarTooltipContent
      title="Pattern"
      description="Choose a pattern tool."
    />,
  );
  for (const text of [
    "Pattern",
    "Choose a pattern tool.",
    "--workbench-tooltip-title",
    "--workbench-tooltip-description",
    "whitespace-normal",
    "break-words",
  ])
    expect(markup).toContain(text);
});
