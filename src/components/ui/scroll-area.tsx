import { ScrollArea as MantineScrollArea, type ScrollAreaProps } from '@mantine/core'

export function ScrollArea({
  className,
  ...props
}: ScrollAreaProps) {
  return (
    <MantineScrollArea
      className={className}
      styles={{
        scrollbar: {
          backgroundColor: 'transparent',
        },
        thumb: {
          backgroundColor: 'rgba(148, 174, 211, 0.32)',
        },
      }}
      {...props}
    />
  )
}
