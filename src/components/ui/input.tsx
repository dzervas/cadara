import { TextInput, type TextInputProps } from '@mantine/core'

export function Input({ className, ...props }: TextInputProps) {
  return (
    <TextInput
      classNames={{ input: className }}
      styles={{
        input: {
          backgroundColor: 'var(--mantine-color-dark-8)',
          borderColor: 'var(--mantine-color-dark-5)',
          color: 'var(--mantine-color-dark-0)',
        },
      }}
      {...props}
    />
  )
}
