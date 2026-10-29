import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

// Sources are trusted, repository-authored SVGs (never imported document data).
// Vite bundles these identically for the web app and the offline single HTML.
const sources = import.meta.glob<string>("/src/assets/icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});
// One markup object per icon: React re-assigns `innerHTML` whenever the
// `dangerouslySetInnerHTML` object changes identity, so a fresh object per
// render would re-parse the SVG on every re-render of the icon's parent.
// Asset file newlines must not become text in tree rows or status labels.
const markupByPath = new Map(
  Object.entries(sources).map(([path, source]) => [
    path,
    { __html: source.trim() },
  ]),
);

interface SvgIconProps {
  fileName: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
  highlight?: boolean;
  draggable?: boolean;
}

export function SvgIcon({
  fileName,
  className,
  size,
  style,
  highlight = false,
  draggable = false,
}: SvgIconProps) {
  const markup = markupByPath.get(`/src/assets/icons/${fileName}`);
  if (!markup) throw new Error(`Unknown icon asset: ${fileName}`);

  return (
    <span
      aria-hidden="true"
      data-icon={fileName}
      data-icon-highlight={highlight ? "true" : undefined}
      className={cn("cadara-icon", className)}
      style={{ width: size, height: size, ...style }}
      draggable={draggable}
      dangerouslySetInnerHTML={markup}
    />
  );
}
