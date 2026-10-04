import { Menu, Text } from "@mantine/core";

import type { SketchPickChooserItem } from "@/components/cad/sketch-pick-hint-model";

export interface SketchPickChooserModel {
  /** Anchor in px from the viewport's top-left (the overlap point). */
  readonly left: number;
  readonly top: number;
  readonly items: readonly SketchPickChooserItem[];
}

/**
 * The overlap candidate chooser (T11e, T11-D6): a controlled Mantine `Menu`
 * anchored at the overlap point, listing the eligible candidates in stack
 * order, the selected ones marked. Arrow keys and Enter pick and focus is
 * trapped. Escape is the caller's: it consumes it with a window
 * capture-phase listener while open (`handleSketchPickChooserKeyDown`,
 * T11e review R-1), so Mantine's own Escape handling is off.
 * Selection orchestration stays with the caller: `onPick`, `onPreview`
 * (item hover or keyboard focus) and `onClose` (Escape, click outside).
 */
export function SketchPickChooser({
  chooser,
  onPick,
  onPreview,
  onClose,
}: {
  chooser: SketchPickChooserModel | null;
  onPick: (item: SketchPickChooserItem) => void;
  onPreview: (item: SketchPickChooserItem) => void;
  onClose: () => void;
}) {
  return (
    <Menu
      opened={chooser !== null}
      onChange={(opened) => {
        if (!opened) onClose();
      }}
      closeOnEscape={false}
      closeOnItemClick={false}
      position="bottom-start"
      offset={4}
      trapFocus
      transitionProps={{ duration: 0 }}
    >
      <Menu.Target>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            left: chooser?.left ?? 0,
            top: chooser?.top ?? 0,
            width: 0,
            height: 0,
          }}
        />
      </Menu.Target>
      <Menu.Dropdown data-testid="sketch-pick-chooser">
        <Menu.Label>Choose one</Menu.Label>
        {chooser?.items.map((item) => (
          <Menu.Item
            key={item.key}
            color={item.selected ? "blue" : undefined}
            data-selected={item.selected || undefined}
            aria-current={item.selected || undefined}
            onClick={() => onPick(item)}
            onMouseEnter={() => onPreview(item)}
            onFocus={() => onPreview(item)}
            rightSection={
              <Text component="span" size="xs" c="dimmed">
                {item.tag}
              </Text>
            }
          >
            {item.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
