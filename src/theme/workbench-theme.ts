import { createTheme, type MantineColorsTuple } from '@mantine/core'

export const workbenchColors: MantineColorsTuple = [
  "#f4f5f6",
  "#e8e8e8",
  "#cfcfcf",
  "#b4b4b4",
  "#9e9e9e",
  "#8f9090",
  "#868989",
  "#727677",
  "#63696a",
  "#3d4647"
]

export const workbenchShellTokens = {
  inspectorWidth: 320,
  panelShadow: '0 20px 50px rgba(0, 0, 0, 0.38), 0 1px 0 rgba(255, 255, 255, 0.04) inset',
} as const

export const workbenchTheme = createTheme({
  colors: {
    dark: workbenchColors,
    workbench: workbenchColors,
  },
  primaryColor: 'workbench',
  primaryShade: 4,
  defaultRadius: 'md',
  black: workbenchColors[9],
  white: workbenchColors[0],
  fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
  headings: {
    fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    fontWeight: '600',
  },
  components: {
    ActionIcon: {
      defaultProps: {
        radius: 'md',
        size: 40,
      },
    },
    Button: {
      defaultProps: {
        radius: 'md',
        size: 'sm',
      },
    },
    Menu: {
      defaultProps: {
        shadow: 'md',
        radius: 'md',
        withinPortal: true,
      },
    },
    Paper: {
      defaultProps: {
        radius: 'md',
      },
    },
    ScrollArea: {
      defaultProps: {
        offsetScrollbars: 'y',
        scrollbarSize: 8,
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'md',
        size: 'sm',
      },
    },
    Tooltip: {
      defaultProps: {
        offset: 8,
        openDelay: 100,
        radius: 'md',
        withArrow: false,
        withinPortal: true,
      },
    },
  },
})
