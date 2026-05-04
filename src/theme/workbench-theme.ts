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
  panelShadow: '0 24px 48px rgba(0, 0, 0, 0.48), 0 8px 20px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
  pillShadow: '0 12px 32px rgba(0, 0, 0, 0.45), 0 4px 12px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
  fabShadow: '0 16px 36px rgba(0, 0, 0, 0.45), 0 6px 14px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.07)',
  /** Spark Orange (#f0a14a) — see DESIGN.md "Spark Affordance Rule". */
  sparkAccent: '#f0a14a',
  sparkAccentHover: '#f6b777',
  sparkAccentInk: '#1a1209',
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

export const workbenchSketchPointColors = {
  imagePinFill: {
    css: '#f6c356',
    hex: 0xf6c356,
  },
  imagePinStroke: {
    css: '#fff4c2',
    hex: 0xfff4c2,
  },
  imageCornerFill: {
    css: '#7ab8d4',
    hex: 0x7ab8d4,
  },
  imageCornerStroke: {
    css: '#b8dce8',
    hex: 0xb8dce8,
  },
} as const

export const workbenchCssVariablesResolver: CSSVariablesResolver = (theme) => {
  const defaults = defaultCssVariablesResolver(theme)

  return {
    ...defaults,
    variables: {
      ...defaults.variables,
      '--workbench-panel-shadow': theme.shadows.panel,
      '--workbench-pill-shadow': workbenchShellTokens.pillShadow,
      '--workbench-fab-shadow': workbenchShellTokens.fabShadow,
      '--workbench-spark-accent': workbenchShellTokens.sparkAccent,
      '--workbench-spark-accent-hover': workbenchShellTokens.sparkAccentHover,
      '--workbench-spark-accent-ink': workbenchShellTokens.sparkAccentInk,
      '--workbench-glass-fill': 'rgba(40, 40, 40, 0.55)',
      '--workbench-glass-fill-strong': 'rgba(40, 40, 40, 0.65)',
      '--workbench-glass-fill-row-hover': 'rgba(40, 40, 40, 0.55)',
      '--workbench-glass-fill-row-active': 'rgba(40, 40, 40, 0.65)',
      '--workbench-glass-border': 'rgba(255, 255, 255, 0.06)',
      '--workbench-glass-border-strong': 'rgba(255, 255, 255, 0.07)',
      '--workbench-glass-border-spark-open': 'rgba(255, 255, 255, 0.18)',
      '--workbench-glass-divider': 'rgba(255, 255, 255, 0.05)',
      '--workbench-shell-inner-highlight': 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      '--workbench-glass-blur': 'blur(18px) saturate(140%)',
      '--workbench-glass-blur-row': 'blur(12px) saturate(140%)',
      '--workbench-glass-blur-panel': 'blur(20px) saturate(140%)',
      '--workbench-kbd-border': 'rgba(255, 255, 255, 0.08)',
      '--workbench-text-shadow-canvas': '0 1px 2px rgba(0, 0, 0, 0.6)',
      '--workbench-text-shadow-canvas-strong': '0 1px 2px rgba(0, 0, 0, 0.7)',
      '--workbench-icon-drop-shadow-canvas': 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.6))',
      '--workbench-parts-tree-row-active-shadow':
        'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 4px 12px rgba(0, 0, 0, 0.3)',
      '--workbench-spark-logo-shadow':
        'inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 8px 24px rgba(240, 161, 74, 0.20), 0 4px 12px rgba(0, 0, 0, 0.45)',
      '--workbench-spark-logo-shadow-hover':
        'inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 12px 34px rgba(240, 161, 74, 0.34), 0 0 0 1px rgba(246, 183, 119, 0.22), 0 6px 16px rgba(0, 0, 0, 0.48)',
      '--workbench-toolbar-button-transition':
        'background-color 180ms cubic-bezier(0.25, 1, 0.5, 1), border-color 180ms cubic-bezier(0.25, 1, 0.5, 1), box-shadow 180ms cubic-bezier(0.25, 1, 0.5, 1), transform 180ms cubic-bezier(0.25, 1, 0.5, 1)',
      '--workbench-toolbar-button-hover-background': 'rgba(255, 255, 255, 0.06)',
      '--workbench-toolbar-button-hover-border': 'rgba(255, 255, 255, 0.10)',
      '--workbench-toolbar-button-hover-shadow':
        'inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 7px 16px rgba(0, 0, 0, 0.28)',
      '--workbench-toolbar-button-press-background': 'rgba(255, 255, 255, 0.08)',
      '--workbench-toolbar-button-press-shadow':
        'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 3px 8px rgba(0, 0, 0, 0.22)',
      '--workbench-debugger-surface': 'rgba(20, 20, 20, 0.85)',
      '--workbench-debugger-chevron-bg': 'rgba(255, 255, 255, 0.06)',
      '--workbench-app-background': 'var(--mantine-color-dark-9)',
      '--workbench-shell-surface': 'var(--mantine-color-dark-9)',
      '--workbench-shell-surface-strong': 'var(--mantine-color-dark-9)',
      '--workbench-shell-surface-panel': 'var(--workbench-shell-surface-strong)',
      '--workbench-shell-surface-panel-elev':
        'color-mix(in oklch, var(--workbench-shell-surface-panel) 92%, white 8%)',
      '--workbench-shell-overlay-soft': 'rgba(255, 255, 255, 0.025)',
      '--workbench-shell-elevation-md':
        '0 12px 40px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.04)',
      '--workbench-shell-elevation-timeline':
        '0 14px 40px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.05)',
      '--workbench-shell-elevation-sidebar':
        '4px 0 20px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      '--workbench-shell-elevation-toolbar':
        '0 4px 16px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      '--workbench-shell-elevation-tabs':
        '0 -10px 28px rgba(0, 0, 0, 0.32), 0 -1px 0 rgba(0, 0, 0, 0.45)',
      '--workbench-shell-scrubber-track': 'rgba(255, 255, 255, 0.06)',
      '--workbench-shell-scrubber-track-glow':
        '0 0 10px color-mix(in oklch, var(--workbench-shell-accent) 12%, transparent)',
      '--workbench-shell-scrubber-glow':
        '0 0 0 4px color-mix(in oklch, var(--workbench-shell-accent) 30%, transparent), 0 4px 10px rgba(0, 0, 0, 0.45)',
      '--workbench-shell-scrubber-ring':
        '0 0 0 2px var(--workbench-shell-surface-panel), 0 4px 10px rgba(0, 0, 0, 0.45)',
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
      '--workbench-shell-divider':
        'color-mix(in srgb, var(--workbench-shell-border) 55%, transparent)',
      '--workbench-shell-text': 'var(--mantine-color-dark-0)',
      '--workbench-shell-text-muted': 'var(--mantine-color-dark-2)',
      '--workbench-shell-text-dim': 'var(--mantine-color-dark-3)',
      '--workbench-shell-sidebar-item-hover':
        'color-mix(in oklch, var(--workbench-shell-surface-panel) 94%, white 6%)',
      '--workbench-shell-sidebar-item-selected':
        'color-mix(in oklch, var(--workbench-shell-surface-panel) 88%, white 12%)',
      '--workbench-shell-sidebar-item-selected-icon': 'var(--mantine-color-dark-1)',
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
  fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  headings: {
    fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif",
    fontWeight: '600',
  },
  shadows: {
    panel: workbenchShellTokens.panelShadow,
    pill: workbenchShellTokens.pillShadow,
    fab: workbenchShellTokens.fabShadow,
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
          border: 'none',
          boxShadow: 'var(--workbench-shell-elevation-md)',
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
