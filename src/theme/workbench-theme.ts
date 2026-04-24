import {
  createTheme,
  defaultCssVariablesResolver,
  type CSSVariablesResolver,
  type MantineColorsTuple,
} from '@mantine/core'

export const workbenchColors: MantineColorsTuple = [
  "#f5f5f5",
  "#e7e7e7",
  "#cdcdcd",
  "#b2b2b2",
  "#9a9a9a",
  "#8b8b8b",
  "#848484",
  "#717171",
  "#656565",
  "#333333"
]

export const workbenchShellTokens = {
  inspectorWidth: 320,
  panelShadow: '0 20px 50px rgba(0, 0, 0, 0.38), 0 1px 0 rgba(255, 255, 255, 0.04) inset',
} as const

export const workbenchGeometryHighlightColors = {
  hover: {
    css: '#f6b777',
    hex: 0xf6b777,
  },
  selected: {
    css: '#f0a14a',
    hex: 0xf0a14a,
  },
  hoverEmissive: {
    css: '#8f4c13',
    hex: 0x8f4c13,
  },
  selectedEmissive: {
    css: '#a85a16',
    hex: 0xa85a16,
  },
} as const

export const workbenchCssVariablesResolver: CSSVariablesResolver = (theme) => {
  const defaults = defaultCssVariablesResolver(theme)

  return {
    ...defaults,
    variables: {
      ...defaults.variables,
      '--workbench-panel-shadow': theme.shadows.panel,
      '--workbench-app-background': 'var(--mantine-color-dark-9)',
      '--workbench-shell-surface': 'var(--mantine-color-dark-9)',
      '--workbench-shell-surface-strong': 'var(--mantine-color-dark-9)',
      '--workbench-shell-surface-panel': 'var(--workbench-shell-surface-strong)',
      '--workbench-shell-overlay':
        'color-mix(in srgb, var(--mantine-color-dark-9) 90%, transparent)',
      '--workbench-shell-overlay-strong':
        'color-mix(in srgb, var(--mantine-color-dark-9) 96%, transparent)',
      '--workbench-shell-control-surface':
        'color-mix(in srgb, var(--mantine-color-dark-8) 82%, transparent)',
      '--workbench-shell-control-surface-hover':
        'color-mix(in srgb, var(--mantine-color-dark-7) 88%, transparent)',
      '--workbench-shell-border': 'var(--mantine-color-dark-5)',
      '--workbench-shell-border-strong': 'var(--mantine-color-dark-4)',
      '--workbench-shell-text': 'var(--mantine-color-dark-0)',
      '--workbench-shell-text-muted': 'var(--mantine-color-dark-2)',
      '--workbench-shell-text-dim': 'var(--mantine-color-dark-3)',
      '--workbench-shell-accent': 'var(--mantine-color-workbench-4)',
      '--workbench-shell-accent-surface': 'var(--mantine-color-workbench-light)',
      '--workbench-shell-accent-surface-hover': 'var(--mantine-color-workbench-light-hover)',
      '--workbench-shell-accent-border': 'var(--mantine-color-workbench-5)',
      '--workbench-shell-accent-text': 'var(--mantine-color-workbench-1)',
      '--workbench-shell-success': 'var(--mantine-color-green-4)',
      '--workbench-shell-success-surface': 'var(--mantine-color-green-light)',
      '--workbench-shell-success-border': 'var(--mantine-color-green-4)',
      '--workbench-shell-success-text': 'var(--mantine-color-green-light-color)',
      '--workbench-shell-danger-surface':
        'color-mix(in srgb, var(--mantine-color-red-9) 72%, transparent)',
      '--workbench-shell-danger-border': 'var(--mantine-color-red-8)',
      '--workbench-shell-danger-text': 'var(--mantine-color-red-2)',
      '--workbench-shell-warning-surface':
        'color-mix(in srgb, var(--mantine-color-yellow-9) 72%, transparent)',
      '--workbench-shell-warning-border': 'var(--mantine-color-yellow-8)',
      '--workbench-shell-warning-text': 'var(--mantine-color-yellow-2)',
      '--workbench-tooltip-surface':
        'color-mix(in srgb, var(--mantine-color-dark-8) 98%, transparent)',
      '--workbench-tooltip-border': 'var(--mantine-color-dark-5)',
      '--workbench-tooltip-title': 'var(--mantine-color-dark-0)',
      '--workbench-tooltip-description': 'var(--mantine-color-dark-2)',
      '--workbench-scroll-thumb':
        'color-mix(in srgb, var(--mantine-color-workbench-4) 36%, transparent)',
      '--workbench-viewport-background': 'var(--mantine-color-dark-9)',
      '--workbench-viewport-overlay':
        'color-mix(in srgb, var(--mantine-color-dark-9) 90%, transparent)',
      '--workbench-viewport-overlay-muted':
        'color-mix(in srgb, var(--mantine-color-dark-9) 82%, transparent)',
      '--workbench-geometry-highlight-hover': workbenchGeometryHighlightColors.hover.css,
      '--workbench-geometry-highlight-selected': workbenchGeometryHighlightColors.selected.css,
      '--workbench-geometry-highlight-hover-emissive': workbenchGeometryHighlightColors.hoverEmissive.css,
      '--workbench-geometry-highlight-selected-emissive': workbenchGeometryHighlightColors.selectedEmissive.css,
      '--workbench-notification-surface': 'var(--workbench-shell-overlay-strong)',
      '--workbench-notification-text': 'var(--workbench-shell-text)',
      '--workbench-notification-text-muted': 'var(--workbench-shell-text-muted)',
      '--workbench-notification-info-accent': 'var(--workbench-shell-accent)',
      '--workbench-notification-info-border': 'var(--workbench-shell-accent-border)',
      '--workbench-notification-info-title': 'var(--workbench-shell-accent-text)',
      '--workbench-notification-warning-accent': 'var(--workbench-shell-warning-border)',
      '--workbench-notification-warning-border': 'var(--workbench-shell-warning-border)',
      '--workbench-notification-warning-title': 'var(--workbench-shell-warning-text)',
      '--workbench-notification-error-accent': 'var(--workbench-shell-danger-border)',
      '--workbench-notification-error-border': 'var(--workbench-shell-danger-border)',
      '--workbench-notification-error-title': 'var(--workbench-shell-danger-text)',
      '--cad-background': 'var(--mantine-color-dark-9)',
      '--cad-foreground': 'var(--workbench-shell-text)',
      '--cad-muted': 'var(--workbench-shell-text-dim)',
      '--cad-muted-foreground': 'var(--workbench-shell-text-muted)',
      '--cad-border': 'var(--workbench-shell-border)',
      '--cad-border-strong': 'var(--workbench-shell-border-strong)',
      '--cad-surface': 'var(--workbench-shell-surface)',
      '--cad-surface-elevated': 'var(--workbench-shell-overlay)',
      '--cad-surface-overlay': 'var(--workbench-shell-overlay-strong)',
      '--cad-accent': 'var(--workbench-shell-accent)',
      '--cad-panel-shadow': 'var(--workbench-panel-shadow)',
    },
  }
}

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
  shadows: {
    panel: workbenchShellTokens.panelShadow,
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
      styles: {
        dropdown: {
          backgroundColor: 'var(--workbench-shell-overlay-strong)',
          borderColor: 'var(--workbench-shell-border)',
          boxShadow: 'var(--workbench-panel-shadow)',
        },
        item: {
          color: 'var(--workbench-shell-text)',
        },
        itemLabel: {
          color: 'inherit',
        },
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
      styles: {
        scrollbar: {
          backgroundColor: 'transparent',
        },
        thumb: {
          backgroundColor: 'var(--workbench-scroll-thumb)',
        },
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'md',
        size: 'sm',
      },
      styles: {
        input: {
          backgroundColor: 'var(--workbench-shell-control-surface)',
          borderColor: 'var(--workbench-shell-border)',
          color: 'var(--workbench-shell-text)',
        },
        section: {
          color: 'var(--workbench-shell-text-muted)',
        },
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
      styles: {
        tooltip: {
          backgroundColor: 'var(--workbench-tooltip-surface)',
          border: '1px solid var(--workbench-tooltip-border)',
          boxShadow: 'var(--workbench-panel-shadow)',
          maxWidth: 'min(280px, calc(100vw - 32px))',
          whiteSpace: 'normal',
        },
      },
    },
  },
})
