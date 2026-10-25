import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

// Sources are trusted, repository-authored SVGs (never imported document data).
// Vite bundles these identically for the web app and the offline single HTML.
const sources = import.meta.glob<string>("/src/assets/icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

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
  const source = sources[`/src/assets/icons/${fileName}`];
  if (!source) throw new Error(`Unknown icon asset: ${fileName}`);

  // Asset file newlines must not become text in tree rows or status labels.
  return (
    <span
      aria-hidden="true"
      data-icon={fileName}
      data-icon-highlight={highlight ? "true" : undefined}
      className={cn("cadara-icon", className)}
      style={{ width: size, height: size, ...style }}
      draggable={draggable}
      dangerouslySetInnerHTML={{ __html: source.trim() }}
    />
  );
}
