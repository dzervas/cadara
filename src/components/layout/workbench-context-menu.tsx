import { Menu, type MantineColor } from '@mantine/core'
import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

export type WorkbenchContextMenuEntry =
  | {
      kind: 'item'
      id: string
      label: string
      icon?: ReactNode
      disabled?: boolean
      danger?: boolean
      onSelect: () => void
    }
  | {
      kind: 'divider'
      id: string
    }

interface WorkbenchContextMenuProps {
  children: ReactElement
  defaultOpened?: boolean
  items: WorkbenchContextMenuEntry[]
  label: string
  withinPortal?: boolean
}

interface MenuAnchor {
  x: number
  y: number
}

function getKeyboardAnchor(element: HTMLElement): MenuAnchor {
  const rect = element.getBoundingClientRect()

  return {
    x: rect.left + Math.min(rect.width, 24),
    y: rect.top + Math.min(rect.height, 24),
  }
}

export function WorkbenchContextMenu({
  children,
  defaultOpened = false,
  items,
  label,
  withinPortal = true,
}: WorkbenchContextMenuProps) {
  const menuId = useId()
  const [opened, setOpened] = useState(defaultOpened)
  const [anchor, setAnchor] = useState<MenuAnchor>({ x: 0, y: 0 })
  const hasItems = items.some((item) => item.kind === 'item')

  if (!isValidElement(children)) {
    return children
  }

  const child = children as ReactElement<{
    'aria-haspopup'?: string
    'aria-controls'?: string
    onContextMenu?: (event: MouseEvent<HTMLElement>) => void
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
    ref?: (element: HTMLElement | null) => void
  }>

  const setTargetRef = (element: HTMLElement | null) => {
    const { ref } = child.props
    if (typeof ref === 'function') {
      ref(element)
    }
  }

  const openAt = (nextAnchor: MenuAnchor) => {
    if (!hasItems) {
      return
    }

    setAnchor(nextAnchor)
    setOpened(true)
  }

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    child.props.onContextMenu?.(event)

    if (event.defaultPrevented) {
      return
    }

    event.preventDefault()
    openAt({ x: event.clientX, y: event.clientY })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    child.props.onKeyDown?.(event)

    if (event.defaultPrevented) {
      return
    }

    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
      return
    }

    event.preventDefault()
    const element = event.currentTarget
    openAt(getKeyboardAnchor(element))
  }

  const trigger = cloneElement(child, {
    ref: setTargetRef,
    onContextMenu: handleContextMenu,
    onKeyDown: handleKeyDown,
    'aria-haspopup': 'menu',
    'aria-controls': opened ? menuId : undefined,
  })

  return (
    <>
      {trigger}
      <Menu
        opened={opened}
        onChange={setOpened}
        position="bottom-start"
        closeOnItemClick
        withinPortal={withinPortal}
        width={190}
      >
        <Menu.Target>
          <span
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: anchor.x,
              top: anchor.y,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </Menu.Target>
        <Menu.Dropdown id={menuId} aria-label={label}>
          {items.map((item) => {
            if (item.kind === 'divider') {
              return <Menu.Divider key={item.id} />
            }

            const color: MantineColor | undefined = item.danger ? 'red' : undefined

            return (
              <Menu.Item
                key={item.id}
                leftSection={item.icon}
                color={color}
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) {
                    return
                  }

                  item.onSelect()
                }}
              >
                {item.label}
              </Menu.Item>
            )
          })}
        </Menu.Dropdown>
      </Menu>
    </>
  )
}
