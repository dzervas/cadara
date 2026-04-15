import { TextInput, type TextInputProps } from '@mantine/core'

export function Input({ className, ...props }: TextInputProps) {
  return (
    <TextInput
      classNames={{ input: className }}
      styles={{
        input: {
          backgroundColor: 'var(--workbench-shell-control-surface)',
          borderColor: 'var(--workbench-shell-border)',
          color: 'var(--workbench-shell-text)',
        },
      }}
      {...props}
    />
  )
}
