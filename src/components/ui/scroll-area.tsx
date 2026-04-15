import { ScrollArea as MantineScrollArea, type ScrollAreaProps } from '@mantine/core'

export function ScrollArea({
  className,
  ...props
}: ScrollAreaProps) {
  return (
    <MantineScrollArea className={className} {...props} />
  )
}
