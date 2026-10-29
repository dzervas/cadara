import { Menu, type MantineColor } from "@mantine/core";
import {
  cloneElement,
  Fragment,
  isValidElement,
  useId,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";

import { ShortcutHint } from "@/components/shortcuts/shortcut-hint";
import type { ShortcutCommandId } from "@/core/shortcuts/commands";

export type WorkbenchContextMenuEntry =
  | {
      kind: "item";
      id: string;
      label: string;
      commandId?: ShortcutCommandId;
      icon?: ReactNode;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    }
  | {
      kind: "divider";
      id: string;
    }
  | {
      /** Non-item menu content, e.g. a swatch row; `close` dismisses the menu. */
      kind: "content";
      id: string;
      render: (context: { anchor: MenuAnchor; close: () => void }) => ReactNode;
    };

interface WorkbenchContextMenuProps {
  children: ReactElement;
  defaultOpened?: boolean;
  items: WorkbenchContextMenuEntry[];
  label: string;
  withinPortal?: boolean;
  /** Inline editors take focus themselves when a menu action starts editing. */
  returnFocus?: boolean;
}

export interface MenuAnchor {
  x: number;
  y: number;
}

function getKeyboardAnchor(element: HTMLElement): MenuAnchor {
  const rect = element.getBoundingClientRect();

  return {
    x: rect.left + Math.min(rect.width, 24),
    y: rect.top + Math.min(rect.height, 24),
  };
}

export function WorkbenchContextMenu({
  children,
  defaultOpened = false,
  items,
  label,
  withinPortal = true,
  returnFocus = true,
}: WorkbenchContextMenuProps) {
  const menuId = useId();
  const [opened, setOpened] = useState(defaultOpened);
  // The Mantine menu (popover, floating-ui, a portal anchor) re-renders with
  // its row on every workbench update, so it mounts on the first open only
  // and then stays mounted.
  const [menuMounted, setMenuMounted] = useState(defaultOpened);
  const [anchor, setAnchor] = useState<MenuAnchor>({ x: 0, y: 0 });
  const hasItems = items.some((item) => item.kind === "item");

  if (!isValidElement(children)) {
    return children;
  }

  const child = children as ReactElement<{
    "aria-haspopup"?: string;
    "aria-controls"?: string;
    onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
    onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
    ref?: (element: HTMLElement | null) => void;
  }>;

  const setTargetRef = (element: HTMLElement | null) => {
    const { ref } = child.props;
    if (typeof ref === "function") {
      ref(element);
    }
  };

  const openAt = (nextAnchor: MenuAnchor) => {
    if (!hasItems) {
      return;
    }

    if (!menuMounted) {
      // Commit the menu closed first: its focus return records the focused
      // element on the closed -> open transition, not on mount.
      flushSync(() => {
        setAnchor(nextAnchor);
        setMenuMounted(true);
      });
    } else {
      setAnchor(nextAnchor);
    }
    setOpened(true);
  };

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    child.props.onContextMenu?.(event);

    if (event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    openAt({ x: event.clientX, y: event.clientY });
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    child.props.onPointerDown?.(event);

    if (event.defaultPrevented || event.button !== 2) {
      return;
    }

    event.preventDefault();
    openAt({ x: event.clientX, y: event.clientY });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    child.props.onKeyDown?.(event);

    if (event.defaultPrevented) {
      return;
    }

    if (
      event.key !== "ContextMenu" &&
      !(event.shiftKey && event.key === "F10")
    ) {
      return;
    }

    event.preventDefault();
    const element = event.currentTarget;
    openAt(getKeyboardAnchor(element));
  };

  const trigger = cloneElement(child, {
    ref: setTargetRef,
    onContextMenu: handleContextMenu,
    onKeyDown: handleKeyDown,
    onPointerDown: handlePointerDown,
    "aria-haspopup": "menu",
    "aria-controls": opened ? menuId : undefined,
  });

  if (!menuMounted) {
    return trigger;
  }

  return (
    <>
      {trigger}
      <Menu
        opened={opened}
        returnFocus={returnFocus}
        onChange={setOpened}
        position="bottom-start"
        closeOnItemClick
        floatingStrategy="fixed"
        transitionProps={{ duration: 0 }}
        withinPortal={withinPortal}
        width={190}
      >
        {typeof document !== "undefined" ? (
          createPortal(
            <Menu.Target>
              <div
                aria-hidden="true"
                style={{
                  position: "fixed",
                  left: anchor.x,
                  top: anchor.y,
                  display: "block",
                  width: 1,
                  height: 1,
                  pointerEvents: "none",
                }}
              />
            </Menu.Target>,
            document.body,
          )
        ) : (
          <Menu.Target>
            <div
              aria-hidden="true"
              style={{
                position: "fixed",
                left: anchor.x,
                top: anchor.y,
                display: "block",
                width: 1,
                height: 1,
                pointerEvents: "none",
              }}
            />
          </Menu.Target>
        )}
        <Menu.Dropdown id={menuId} aria-label={label}>
          {items.map((item) => {
            if (item.kind === "divider") {
              return <Menu.Divider key={item.id} />;
            }

            if (item.kind === "content") {
              return (
                <Fragment key={item.id}>
                  {item.render({ anchor, close: () => setOpened(false) })}
                </Fragment>
              );
            }

            const color: MantineColor | undefined = item.danger
              ? "red"
              : undefined;

            return (
              <Menu.Item
                key={item.id}
                leftSection={item.icon}
                color={color}
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) {
                    return;
                  }

                  item.onSelect();
                }}
              >
                <span className="flex min-w-0 items-center justify-between gap-4">
                  <span className="truncate">{item.label}</span>
                  {item.commandId ? (
                    <ShortcutHint commandId={item.commandId} />
                  ) : null}
                </span>
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
