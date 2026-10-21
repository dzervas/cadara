import { Menu, Tooltip } from "@mantine/core";
import type { CSSProperties } from "react";

import {
  BODY_PALETTE,
  type BodyAppearance,
  type BodyPaletteSlot,
} from "@/contracts/modeling/body-appearance";

function swatchStyle(
  background: string,
  active: boolean,
  size = 20,
): CSSProperties {
  return {
    display: "inline-block",
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: "50%",
    padding: 0,
    border: "none",
    cursor: "pointer",
    background,
    boxShadow: active
      ? "var(--workbench-color-swatch-shadow-active)"
      : "var(--workbench-color-swatch-shadow)",
    transition: "box-shadow 120ms cubic-bezier(0.25, 1, 0.5, 1)",
  };
}

/**
 * Body colour section at the top of a body's context menu: the palette as a
 * row of swatches (the current one ringed) and a "Custom color…" item.
 */
export function BodyColorMenuSection({
  appearance,
  close,
  onChoosePaletteSlot,
  onOpenCustomColor,
}: {
  appearance: BodyAppearance;
  close: () => void;
  onChoosePaletteSlot: (slot: BodyPaletteSlot) => void;
  onOpenCustomColor: () => void;
}) {
  return (
    <>
      <div
        role="group"
        aria-label="Body color"
        className="flex items-center justify-between"
        style={{ padding: "8px 10px 6px" }}
      >
        {BODY_PALETTE.map((swatch, index) => {
          const slot = index as BodyPaletteSlot;
          const active =
            appearance.kind === "palette" && appearance.slot === slot;
          return (
            <Tooltip key={swatch.name} label={swatch.name} openDelay={300}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active}
                aria-label={swatch.name}
                data-menu-item
                onClick={() => {
                  close();
                  if (!active) onChoosePaletteSlot(slot);
                }}
                style={swatchStyle(swatch.hex, active)}
              />
            </Tooltip>
          );
        })}
      </div>
      <Menu.Item
        aria-checked={appearance.kind === "custom"}
        leftSection={
          <span
            aria-hidden="true"
            style={swatchStyle(
              appearance.kind === "custom"
                ? appearance.hex
                : "var(--workbench-color-custom-swatch)",
              false,
              14,
            )}
          />
        }
        onClick={onOpenCustomColor}
      >
        Custom color…
      </Menu.Item>
    </>
  );
}
