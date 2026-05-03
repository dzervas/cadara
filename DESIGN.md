---
name: CADara
description: Browser-native parametric CAD for makers. Dark-first, monochromatic chrome, density that respects the operator.
colors:
  graphite-deep: "#333333"
  graphite-800: "#656565"
  graphite-700: "#717171"
  graphite-600: "#848484"
  graphite-500: "#8b8b8b"
  workshop-steel: "#9a9a9a"
  graphite-300: "#b2b2b2"
  graphite-200: "#cdcdcd"
  graphite-100: "#e7e7e7"
  graphite-bone: "#f5f5f5"
  spark-orange: "#f0a14a"
  ember-hover: "#f6b777"
  spark-emissive: "#a85a16"
  ember-emissive: "#8f4c13"
  pin-amber: "#f6c356"
  pin-amber-stroke: "#fff4c2"
  corner-cyan: "#7ab8d4"
  corner-cyan-stroke: "#b8dce8"
  viewcube-slate: "#314255"
  viewcube-outline: "#8db7ff"
typography:
  display:
    fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  headline:
    fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  section:
    fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  tag:
    fontFamily: "'Geist Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.18em"
    textTransform: "uppercase"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: "0px"
  xs: "2px"
  sm: "4px"
  md: "8px"
  lg: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  toolbar-pill:
    backgroundColor: "rgba(40, 40, 40, 0.55)"
    backdropFilter: "blur(18px) saturate(140%)"
    border: "1px solid rgba(255, 255, 255, 0.06)"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.lg}"
    padding: "4px"
  toolbar-logo:
    backgroundColor: "{colors.spark-orange}"
    textColor: "#1a1209"
    rounded: "10px"
    size: "36px"
  parts-tree-floating:
    backgroundColor: "transparent"
    width: "240px"
    rowActiveBackground: "rgba(40, 40, 40, 0.65)"
    rowActiveBackdropFilter: "blur(12px) saturate(140%)"
    rowActiveRailColor: "{colors.workshop-steel}"
  vars-fab:
    backgroundColor: "rgba(40, 40, 40, 0.65)"
    backdropFilter: "blur(18px) saturate(140%)"
    border: "1px solid rgba(255, 255, 255, 0.07)"
    rounded: "14px"
    size: "52px"
  vars-fab-open:
    backgroundColor: "{colors.spark-orange}"
    textColor: "#1a1209"
    rounded: "14px"
    size: "52px"
  vars-panel:
    backgroundColor: "rgba(40, 40, 40, 0.65)"
    backdropFilter: "blur(20px) saturate(140%)"
    border: "1px solid rgba(255, 255, 255, 0.06)"
    rounded: "{rounded.lg}"
    width: "320px"
  tool-button:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.md}"
    size: "40px"
  tool-button-active:
    backgroundColor: "#3d3d3d"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.md}"
    size: "40px"
  tool-button-success:
    backgroundColor: "#1f3d28"
    textColor: "#a8d9b1"
    rounded: "{rounded.md}"
    size: "40px"
  tool-button-disabled:
    backgroundColor: "#2a2a2a"
    textColor: "{colors.graphite-700}"
    rounded: "{rounded.md}"
    size: "40px"
  tooltip:
    backgroundColor: "#1f2122"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  input-compact:
    backgroundColor: "#3a3a3a"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 8px"
  parts-tree-row:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-bone}"
    rounded: "7px"
    padding: "5px 10px"
  parts-tree-row-hover:
    backgroundColor: "rgba(40, 40, 40, 0.55)"
    backdropFilter: "blur(12px) saturate(140%)"
    rounded: "7px"
    padding: "5px 10px"
  parts-tree-row-active:
    backgroundColor: "rgba(40, 40, 40, 0.65)"
    backdropFilter: "blur(12px) saturate(140%)"
    railColor: "{colors.workshop-steel}"
    fontWeight: 600
    rounded: "7px"
    padding: "5px 10px"
  diagnostic-card-error:
    backgroundColor: "#3a1c1d"
    textColor: "#f5b8b8"
    rounded: "{rounded.md}"
    padding: "8px 8px"
  diagnostic-card-warning:
    backgroundColor: "#3a2f15"
    textColor: "#f0d59a"
    rounded: "{rounded.md}"
    padding: "8px 8px"
---

# Design System: CADara

## 1. Overview

**Creative North Star: "The Visible Workshop"**

CADara is a workshop, not a dashboard. Every tool the operator might reach for stays in the open — on the toolbar, in the tree, against the dark wall of the workspace. The chrome is monochromatic on purpose: graphite-on-graphite, no chromatic accent in the shell, because the only thing that should ever be in color is the geometry being made. When the shell is loud, the part is hard to read. When the shell is quiet, the part is the loudest thing in the room.

The reference for feel is **Plasticity** — bold, dark, decisive — but with the discoverability re-enabled. CADara hasn't earned the right to hide tools yet (see PRODUCT.md, *"Visible tools beat hidden tools"*), so density is a feature, not an apology. Targets are tight. Type is small. Tracking is wide. The interface looks like it was made in 2026, not retrofitted from 2005, and it explicitly rejects the chrome-and-baroque-dialogs lineage of SolidWorks, the unfinished-Qt look of FreeCAD, the IDE-coldness of Rhino, the kid-friendly bubblegum of TinkerCAD, and the cards-and-charts pattern of generic SaaS dashboards.

**Key Characteristics:**
- Dark-first, dense without being cramped, browser-native but never about being browser-native.
- **Floating chrome over a fullscreen viewport.** No structural top-bar row, no docked left sidebar — every chrome surface (toolbar, parts tree, variables, history, tabs, debugger) is a positioned overlay above the canvas. Tinted-glass surfaces let the part read through.
- Monochromatic shell with three earned Spark Affordances. Saturated color is reserved for canvas semantics — selection, sketch references, status states — and the three deliberate spark roles in chrome.
- Typographic discipline carries the density: small text, wide-tracked uppercase labels, monospace for numbers.
- Layered shadows + tinted-glass blur with a 1px inset top highlight. Glass earned by being *over the viewport*; opaque chrome stays opaque.

## 2. Colors: The Graphite Workshop

A 10-step graphite scale carries the entire shell — background, surfaces, text, borders, and the so-called "primary accent." Saturated color appears only where the user is looking *into* the model: viewport selection, sketch reference overlays, and status-tinted feedback.

### Primary
- **Workshop Steel** (`#9a9a9a` — workbench-4): The brand "primary." Honest acknowledgement: the primary color is a mid-grey. It carries focus rings, scrollbar thumbs, scrubber glows, and the subtle hint of "active" on tool buttons. It is not a hero color and is never used to attract attention; it is used to confirm state.

### Tertiary: Geometry Highlights (viewport-only)
- **Spark Orange** (`#f0a14a`): Selected geometry in the 3D viewport, plus the three Spark Affordances in chrome (logo mark, active-state Variables FAB, active-tab dot).
- **Ember Hover** (`#f6b777`): Hovered geometry in the 3D viewport.
- **Spark Emissive** (`#a85a16`) / **Ember Emissive** (`#8f4c13`): Self-lit selection/hover for shaded faces; tuned darker so they read as glow under viewport lighting, not as paint.

### Tertiary: Sketch Reference Overlays (sketch-mode-only)
- **Pin Amber** (`#f6c356`) with **Pin Amber Stroke** (`#fff4c2`): Reference image pin handles.
- **Corner Cyan** (`#7ab8d4`) with **Corner Cyan Stroke** (`#b8dce8`): Reference image corner handles.

### Neutral: The Graphite Scale
- **Graphite Bone** (`#f5f5f5` — workbench-0): Primary text on dark surfaces.
- **Graphite 100** (`#e7e7e7` — workbench-1): Accent text inside light tints.
- **Graphite 200** (`#cdcdcd` — workbench-2): Secondary text, "muted."
- **Graphite 300** (`#b2b2b2` — workbench-3): Dim text, "section-label dim."
- **Graphite 500/600/700/800** (`#8b8b8b → #656565`): Borders (strong → subtle), control surfaces, scrollbar tracks. The full ramp gives four steps of border weight to play with.
- **Graphite Deep** (`#333333` — workbench-9): The wall. Background of the viewport and tooltip surfaces. Floating overlays are tinted-glass at `rgba(40, 40, 40, 0.55–0.65)` so the same graphite carries through the blur.

### Status (Mantine defaults, used sparingly)
- **Danger** (Mantine red): Variable evaluation errors, destructive actions, error diagnostics.
- **Warning** (Mantine yellow): Diagnostic warnings.
- **Success** (Mantine green): Sole appearance in chrome is the *Finish Sketch* tool button — the only "go" affordance in the toolbar.

### Named Rules

**The Quiet Chrome Rule.** The shell is monochromatic except for the three Spark Affordances below and status feedback the user must see. Hover states, dividers, tonal lifts, "primary" tints — all pull from the graphite scale. If a designer reaches for color to make something feel "more designed," they have already failed the rule.

**The Geometry-Owns-Color Rule.** Saturated hues live where the part lives. Spark Orange is the dominant signal — selected geometry in the viewport, plus the three Spark Affordances in chrome. Pin Amber is for sketch references the user has placed, Mantine reds and yellows are for problems the user has caused.

**The Spark Affordance Rule.** Spark Orange (`#f0a14a`) appears in the floating chrome in exactly three roles, each one earned:
1. **The brand mark.** The 36px logo block in the floating toolbar's leading position. Identity, not ornament.
2. **The Variables FAB, when open.** The FAB is a committed-state affordance: closed, it's a graphite glass pill; open, it flips to spark-orange to communicate "this panel is currently driving the workspace."
3. **The active-document indicator.** The 6px dot on the active document tab in the bottom tab bar, signaling which document the viewport is rendering. Other tabs use steel.

These are the only three. Any new sparks require a deliberate addition to this list, not a one-off override. The Mantine `primaryColor` remains `workbench` (graphite) — Spark Orange is a *signal* color, not a "primary."

## 3. Typography

**Display Font:** Geist Sans (with `ui-sans-serif`, `system-ui`, sans-serif fallback)
**Body Font:** Geist Sans (same stack — no display/body split)
**Mono Font:** IBM Plex Mono — used exclusively for numeric values, expressions, and constraint readouts.

**Character:** One typeface, four sizes, two weights, one narrow uppercase register reserved for tags. The voice is engineered with warmth — not editorial, not cold. Geist was designed by Vercel for technical software, and its slightly open apertures and rounded counters keep dense CAD information from reading as IDE-grim. The headers are sentence case with near-zero tracking; the register is "operator who has time for you," not "drafting print." `font-synthesis: none` prevents browsers from faking weights or italics; if a weight isn't loaded, it doesn't render.

### Hierarchy
- **Display** (600, 20px, line-height 1.3): Reserved for top-level identity moments (rare in this shell). Headings inside the workspace are smaller.
- **Headline** (600, 16px, 1.4): Section titles inside dense panels — feature inspector headings, modal titles.
- **Section** (600, 12.5px, line-height 1.3, letter-spacing -0.005em, sentence case): Sidebar accordion headers — `Parts & Objects`, `Variables`, `Document Diagnostics`. Identity-defining; sentence case at near-zero tracking is what makes the shell read as 2026 and not 2005.
- **Title** (500, 13px, 1.4): Tool button labels, item names in the parts/objects tree, variable names. The dominant text register in the application.
- **Body** (400, 13px, 1.5): Tooltip descriptions, helper text, diagnostic messages.
- **Tag** (600, 11px, line-height 1.2, letter-spacing 0.18em, uppercase): Reserved for diagnostic severity badges and short metadata stamps. Not for sidebar section headers — those moved to the Section register.
- **Mono** (400, 12px, 1.4): Variable expressions, evaluated values, dimension readouts, units. Anything where a `1` and an `l` need to be different shapes.

### Named Rules

**The Tracked Caps Rule.** Uppercase is reserved for the **Tag** register — diagnostic severity badges and similar short metadata stamps — never for sidebar headers, body copy, buttons, or marketing-style emphasis. Tracking is `0.18em`. Anything tighter reads as "default uppercase" and breaks the register; anything wider feels like a 2005 enterprise dashboard.

**The Mono-For-Numbers Rule.** Any field a user might compare against another field — a length, a constraint value, a coordinate, a variable result — is monospaced. The eye scans columns of `12.5` and `12.500001` and immediately sees the difference. Sans-serif numbers hide that difference.

**The No-Display-Hero Rule.** There are no oversized hero headlines. The largest text on screen is 20px. PRODUCT.md is explicit: *"oversized friendly buttons"* are an anti-reference. Restraint at the top of the scale is the point.

## 4. Elevation

The shell separates planes two ways: **layered shadows** for opaque chrome and **tinted-glass + shadow** for floating overlays that sit *over* the viewport. Both share the same base graphite tone — depth comes from shadow weight, a 1px inset top highlight at 4–5% white, and (for floating overlays) a controlled `backdrop-filter: blur(18px) saturate(140%)` over a `rgba(40, 40, 40, 0.55–0.65)` fill.

### Shadow Vocabulary
- **Pill** (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 4px 12px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.06)`): The toolbar pill clusters and search/utility pills. Lift the float above the viewport without competing with the timeline.
- **Elevation MD** (`box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.04)`): Menu dropdowns and the toolbar search palette.
- **Timeline** (`box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.05)`): The feature-history scrubber bar.
- **Panel** (`box-shadow: 0 24px 48px rgba(0, 0, 0, 0.48), 0 8px 20px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.06)`): Floating panels and modals — Variables panel, export modal, the heaviest overlays.
- **FAB** (`box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45), 0 6px 14px rgba(0, 0, 0, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.07)`): The Variables FAB. A heavier lift than a pill button — the FAB is the heaviest single floating control in the shell, and the shadow earns it.

### Named Rules

**The Inner Highlight Rule.** Every elevated surface carries `inset 0 1px 0 rgba(255, 255, 255, 0.05)` (or `0.06–0.07` for heavier surfaces) on the top edge. It is barely visible and that is the point — it gives the surface a sculpted lip that sells the depth without adding chrome.

**The Floating-Glass Rule.** Surfaces that float *over the viewport* (toolbar pill clusters, parts tree active rows, Variables FAB, Variables panel, sketch tool overlays) use `backdrop-filter: blur(18px) saturate(140%)` over a `rgba(40, 40, 40, 0.55–0.65)` fill, with a 1px `rgba(255, 255, 255, 0.06–0.07)` border. Surfaces that anchor to the *edge* of the workspace (the bottom tab bar, the history timeline track) stay opaque graphite — their job is to define the workspace boundary, not to let the part read through. The blur is earned by floating; if a surface isn't floating over the viewport, it doesn't get blur.

## 5. Components

Components are Mantine primitives configured through the central `workbench-theme.ts` module. Defaults are tuned tight: `defaultRadius: 'md'`, `primaryColor: 'workbench'`, `primaryShade: 4`. The visible character is set by the CSS variable layer (`--workbench-shell-*`) layered on top of Mantine's `dark` palette.

### Tool Buttons (Toolbar)
- **Shape:** Rounded rectangle (`{rounded.md}` = 8px).
- **Default state:** Transparent background, `Graphite Bone` icon, no border. ActionIcon size 40px.
- **Active state:** Subtle Workshop-Steel tint background (Mantine `light` variant, ~12% opacity over Graphite Deep), 1px Workshop-Steel border, full-opacity icon.
- **Disabled state:** Slightly darker control surface, dim icon (`Graphite 700`), opacity ≈ 0.46, `cursor: not-allowed`.
- **Success state (`Finish Sketch` only):** Mantine green-tinted surface and border. The only chromatic affordance permitted on the toolbar; it earns this because it is the moment-of-commit out of sketch mode.
- **Hover/Focus:** Background lifts to a slightly lighter tint; focus is communicated by Workshop-Steel ring.

### Tool Dropdown Buttons
- Same shape and palette as Tool Buttons. The dropdown trigger is a chevron-end on the icon button; the dropdown menu uses the **Elevation MD** shadow and `Graphite Deep` (96% opaque) surface, no border. Items are full-width with the same 13px Title typography.

### Search Input (Toolbar)
- **Style:** 30px height, `{rounded.md}`, control-surface background (semi-transparent over Graphite Deep), 1px subtle Graphite border.
- **Leading icon:** 16px Workbench icon, dimmed.
- **Results palette:** Floating Paper at `top + 8px`, **Panel** shadow, max height 320px ScrollArea, results render as inline tool buttons with the description as a second line.

### Floating Toolbar (Pill Clusters)
- **Position:** `position: absolute; top: 12px; left: 12px; right: 12px;` over the viewport. The bar itself is `pointer-events: none` so the gaps between pills pass clicks through to the canvas; each pill carries `pointer-events: auto`.
- **Logo:** 36px spark-orange square (`{rounded.lg}` corner of 10px), 14px semibold "C" in `#1a1209`. Inset top highlight + spark-tinted glow shadow. The single permanent spark in the toolbar.
- **Pill clusters:** Each tool group is its own glass pill — `rgba(40, 40, 40, 0.55)` fill, `backdrop-filter: blur(18px) saturate(140%)`, 12px corner radius, 1px `rgba(255, 255, 255, 0.06)` border, **Pill** shadow. Internal padding `4px`, 2px gap between buttons.
- **Search pill:** Same glass treatment, 36px height, 260px width, 16px Workbench search icon dimmed, 12.5px Geist input, trailing `/` keyboard hint in mono.
- **Right utility pill:** Same glass treatment hosting Notifications, Settings, Help, GitHub. 32px ActionIcon size to fit the slimmer right pill.

### Tool Buttons inside Pill Clusters
- **Shape:** 34px square, 9px corner radius (slightly tighter than the 12px pill so they nest cleanly inside).
- **Default state:** Transparent background, 18px stroke icon at 1.6 stroke-width in `Graphite Bone`.
- **Hover:** Background `rgba(255, 255, 255, 0.05)`. Active press goes to `rgba(255, 255, 255, 0.08)`.
- **Active state:** `rgba(154, 154, 154, 0.16)` background with a 1px `rgba(154, 154, 154, 0.35)` border — a subtle steel ring inside the glass pill.
- **Success state (`Finish Sketch` only):** `#1f3d28` background with `#a8d9b1` icon and a green-tinted border.
- **Disabled:** `Graphite 700` icon at 0.46 opacity, `cursor: not-allowed`.
- **Dropdown chevron:** A 6px CSS triangle in the bottom-right corner of the icon button at 0.55 opacity, indicating a tool family.

### Floating Parts Tree (Viewport Overlay)
- **Position:** `position: absolute; top: 76px; left: 16px;` — sits below the floating toolbar's left edge.
- **Width:** 240px.
- **Background:** None on the container itself. Only individual rows pick up glass when active or hovered, so the tree reads as labels-on-the-canvas, not a panel.
- **Header:** "Parts & Objects" in 11px semibold uppercase tracked-0.18em `Graphite 300`, with a `text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6)` so it stays legible against any viewport content.
- **Row default:** 5px/10px padding, 13px Title typography, 14px leading icon in `Graphite 200`, all with a 1px-down 0.7-alpha black `text-shadow` and `drop-shadow` for legibility against the canvas.
- **Row hover:** `rgba(40, 40, 40, 0.55)` with `backdrop-filter: blur(12px) saturate(140%)`, 7px corner radius.
- **Row selected:** `rgba(40, 40, 40, 0.65)` glass + a 2px Workshop-Steel rail riding the leading edge from `top: 6px` to `bottom: 6px` — the rail is what makes selection commit, the glass is what makes it readable.
- **Hidden row:** Container at `opacity: 0.55`, eye icon flips from open to closed, trailing toggle stays visible (no hover gate) so the user can flip visibility back without hunting.
- **Trailing affordance:** 22×22 visibility toggle, only visible on hover or when the row is hidden.

### Variables FAB & Panel
- **FAB position:** `position: absolute; bottom: 116px; right: 24px;` — sits above the bottom tab bar and clear of the history timeline.
- **FAB shape:** 52×52, 14px corner radius. Closed: glass treatment (`rgba(40, 40, 40, 0.65)`, `backdrop-filter: blur(18px) saturate(140%)`, 1px white-7% border, **FAB** shadow). Open: flips to **Spark Orange** `#f0a14a` with `#1a1209` icon — the second of the three Spark Affordances.
- **FAB icon:** 22×22 layers icon when closed, 22×22 X when open. Hover lifts the FAB by `translateY(-1px)` over 160ms.
- **Panel position:** `top: 76px; right: 16px; bottom: 100px; width: 320px;` — anchored to the right edge from below the toolbar to above the timeline.
- **Panel shape:** 16px corner radius, glass treatment (`rgba(40, 40, 40, 0.65)`, `backdrop-filter: blur(20px) saturate(140%)`, 1px white-6% border, **Panel** shadow).
- **Panel header:** 14px/16px padding bottom, 12.5px semibold `Graphite Bone` "Variables" title, trailing 26×26 close button.
- **Open animation:** `panelIn` 200ms `cubic-bezier(0.2, 0.8, 0.3, 1.05)` — `translateY(8px) scale(0.96)` → identity. The slight overshoot at the end of the curve is the only "spring" allowed in the shell, and it earns it because the panel is opening *toward the user's pointer*.

### Variable Rows
- **View mode:** Two-column row — name on the left (13px Title), expression chip + `=` separator + result chip on the right (12px Mono).
- **Expression chip:** Mono typography, 12px, `Graphite Deep` background, 1px white-8% border, 4px corner radius, 2/8px padding.
- **Result chip:** Same shape; `--workbench-shell-success-surface` when valid, `--workbench-shell-danger-surface` when evaluation fails. The literal text `???` appears in the result chip on error and a tooltip auto-opens with the failure message.
- **Edit mode:** Two inline `<input>`s in a `1fr / 0.75fr` grid; commits on blur or Enter, cancels on Escape.

### Tooltips
- **Shape:** `{rounded.md}` (8px), 1px Graphite-strong border, **Panel** shadow.
- **Background:** Graphite-8 at 98% opacity (a hair lighter than Graphite Deep so the tooltip lifts off the surface that triggered it).
- **Content:** Two-line — title in 12px semibold `Graphite Bone`, description in 12px Graphite-2 with `leading-relaxed`. Optional `ShortcutHint` floats to the right of the title.
- **Behavior:** No arrow, 100ms `openDelay`, max-width 280px or `calc(100vw - 32px)` on narrow viewports. Multiline allowed.

### Document Tab Bar
- **Position:** `position: absolute; left: 0; right: 0; bottom: 0;` — anchored to the bottom of the workspace, full width, 32–40px height.
- **Style:** Opaque `--workbench-shell-overlay-strong` (Graphite Deep at 96% opacity), 1px `--workbench-shell-border` top edge, **Tabs** elevation shadow casting upward to lift the history timeline above. The bar is *not* glass — it defines the workspace boundary.
- **Default tab:** 12.5px medium `Graphite 300`, 14px hit-target padding, 14px storage glyph (browser circle / filesystem doc / cloud) at the leading edge.
- **Active tab:** 13px semibold `Graphite Bone`, plus a 1px Workshop-Steel hairline along the top edge, plus a 6px **Spark Orange** dot in the storage-glyph slot — the third Spark Affordance, signaling which document the viewport currently renders.
- **Pending recompute:** The same hairline becomes a 1.5px sweep animation `workbench-tab-loading-sweep` 1100ms — loading "becomes" the active state when the recompute resolves.
- **Error:** The hairline turns Mantine `red-8`. Active dot stays spark.
- **Close button:** 18×18, only visible on hover or when active, fades the close glyph in over 120ms.
- **Reorder:** Drag-to-reorder with an 8px translate on the drop-target slot (160ms `cubic-bezier(0.25, 1, 0.5, 1)`).

### State Debugger (Bottom-Left Chip)
- **Position:** `position: absolute; bottom: 96px; left: 16px;` — sits at the bottom-left corner of the viewport, below the history timeline tray.
- **Collapsed shape:** A horizontal mono chip — `rgba(20, 20, 20, 0.85)` background, 1px white-6% border, 8px corner radius, **Elevation MD** shadow, 8/10px padding, 10px IBM Plex Mono uppercase tracked-0.18em `Graphite 300`.
- **Content:** A "STATE DEBUGGER" tag in `Graphite 200`, the active mode/machine/command triad in mono dim, and a 18×18 expand button.
- **Expanded:** The chip grows downward into a panel, keeping the same monospace register at the chip-top and switching to 12px sans-serif Title rows for the full state read-out. Bordered section dividers separate selection / sketch / requirements / topology blocks.
- **Test mode:** `pointer-events: none` so the chip doesn't intercept hit-testing during automated runs.

### Diagnostic Cards
- **Shape:** `{rounded.md}`, 1px border in the severity color, internal padding `8px 8px`.
- **Severity tag:** 11px uppercase tracked-0.18em, color matches severity (red text for error, yellow for warning, dim for info).
- **Body:** 13px message, optional target reference at 12px Graphite-2, code at 12px Graphite-3.
- **Backgrounds:** `--workbench-shell-danger-surface` (~70% red-9), `--workbench-shell-warning-surface` (~70% yellow-9), `--workbench-shell-overlay` for info.

### Notifications
- **Shell:** Paper at `--workbench-shell-overlay-strong` (Graphite Deep at 96% opacity), 1px severity-tinted border, **Panel** shadow, max-width `sm` (24rem), overflow hidden so the leading rail bleeds to the corner.
- **Severity rail:** A 4px-wide solid bar on the leading edge — the only sanctioned side-stripe in the system. Color is the severity accent (Workshop Steel for info, `yellow-8` for warning, `red-8` for error). The rail is paired with a matching full border on the Paper; severity is *not* communicated by tinting the surface, only by the rail + border + title color.
- **Body:** 20×20 leading icon (`info` / `warning` / `error`) tinted in the accent color, then a stack: 12px semibold title in the severity title color (`workbench-1` / `yellow-2` / `red-2`), 12px Graphite-2 message, optional `default`-variant Button as inline action.
- **Dismiss:** 24px subtle ActionIcon top-right with a 1px Graphite-strong border. Auto-dismiss timing comes from `scheduleWorkbenchNotificationAutoDismiss` per type.
- **Placement:** Either anchored at app top-center (`fixed top-3, left-1/2, -translate-x-1/2`, max width 720px) or floated inside the viewport at explicit `top` / `right` offsets.

### View Cube (Viewport overlay)
- **What it is:** A WebGL widget rendered into a small inset scene at the top-right of the viewport — not a DOM component. Faces and corners are interactive hit targets that drive camera transitions to canonical orientations (`TOP`, `BOTTOM`, `FRONT`, `BACK`, `LEFT`, `RIGHT`, plus eight beveled corners).
- **Body:** A cube with cut corners. Body half-size is `0.58` scene units, corner cut size `0.30`.
- **Faces:** Filled with `Viewcube Slate` (`#314255`), outlined in `Viewcube Outline` (`#8db7ff`) at 50% opacity. The slate-blue palette is a permitted exception to the Quiet Chrome Rule: the view cube lives *in* the viewport, not on the chrome, so it falls under the Geometry-Owns-Color Rule's domain.
- **Labels:** Face labels (`TOP`, `FRONT`, etc.) are rendered to a 256×128 canvas texture using `600 42px Geist Sans, ui-sans-serif, system-ui, sans-serif` with a thick 10px outline in the viewport background color and fill in `--workbench-shell-text` (Graphite Bone). The outline reads as a halo against any face tint, keeping the text legible.
- **Corners:** Same Viewcube Slate fill and Viewcube Outline edges. Corners are clickable for isometric-style 3/4 views.
- **Lighting:** Ambient `#ffffff` at 1.1 intensity plus a directional light at 0.9 — bright enough that the cube reads as flatly lit (deliberately uniform, no dramatic shading) so the user reads it as a navigation widget, not as a model.

### Named Rules

**The Visible Tool Rule.** Every tool the operator might need is on the toolbar at all times. There are no "advanced" overflow menus that hide capability. Dropdown variant families exist (e.g., pattern variants), but their parent is always present. *"Discoverability beats minimalism in a CAD app where missing a tool costs minutes of hunting."* — PRODUCT.md.

**The Floating Layout Rule.** The shell has no structural top-bar row and no docked sidebar. The viewport is fullscreen; chrome floats over it. Toolbar pills float at the top, the parts tree floats top-left, the Variables FAB+panel float right, the history timeline floats bottom-center, the tab bar anchors the bottom, the state debugger chip floats bottom-left. The advantage is the part is always the largest thing on screen; the cost is that overlay placement is now load-bearing — every new chrome element must reserve its corner of the viewport explicitly.

**The Variables-Behind-FAB Rule.** Variables don't live in the parts tree and don't have a permanent panel. They are accessed by the bottom-right FAB, which when toggled opens the Variables panel as a transient floating overlay. Rationale: variables are *modeling state*, not navigation, and they're consulted/edited far less often than the parts tree is scanned. Putting them behind the FAB reclaims the right edge of the viewport for the canvas in the steady state.

**The Floating-Panel Anchor Rule.** Floating panels (Variables, future references) anchor to a viewport edge with a fixed corner-distance, *not* to a sidebar slot. Variables: top 76px / right 16px / bottom 100px. Other panels follow the same pattern with explicit pixel offsets. No floating panel should overlap the toolbar (top 12px), the timeline (bottom ~56–96px), or the tab bar (bottom 0–40px). The reservations exist precisely so future panels can compose without colliding.

## 6. Do's and Don'ts

### Do:
- **Do** keep saturated color confined to the viewport, sketch overlays, status states, and the three Spark Affordances. Anything else is graphite-on-graphite or it's rejected.
- **Do** use `{rounded.md}` (8px) for inline components, `{rounded.lg}` (12–16px) for floating pills/panels, `9px` for tool buttons inside pill clusters.
- **Do** match the Inner Highlight Rule on every new elevated surface — a 1px inset top highlight at ~4–7% white. Heavier surfaces (FAB, panel) earn the higher end.
- **Do** apply the Floating-Glass Rule on every overlay that sits over the viewport: `rgba(40, 40, 40, 0.55–0.65)` + `backdrop-filter: blur(18px) saturate(140%)`. Edge-anchored chrome (tab bar) stays opaque.
- **Do** use Geist Sans for everything, IBM Plex Mono only for numbers, units, expressions, and identifiers.
- **Do** apply 0.18em letter-spacing on the uppercase **Tag** register at 11px/600 (severity badges, the State Debugger chip), and never at body sizes.
- **Do** treat hobbyists as professionals. Tooltips are short, exact, and load-bearing — not "Welcome! 👋" copy.
- **Do** use Mantine primitives configured through `workbench-theme.ts`. New bespoke styled components require a reason; new bespoke `<div>` chrome requires a *very* good reason.

### Don't:
- **Don't** introduce a fourth Spark Affordance without amending the rule. Three is the count.
- **Don't** ship UI that reads as **SolidWorks** — frozen-in-2005 chrome, baroque dialog stacks, every feature with a different visual language.
- **Don't** ship UI that reads as **FreeCAD** — inconsistent enough to feel broken, default Qt look. Open-source must not look open-source in the bad way.
- **Don't** ship UI that reads as **Rhino** — IDE-cold, panel-stacked, hostile to anyone who isn't already a Rhino expert.
- **Don't** ship UI that reads as **TinkerCAD** — playful illustrations, oversized friendly buttons, "let's design a robot!" copy. CADara users are adults making real things.
- **Don't** use the **generic SaaS dashboard cliché** — cards-and-charts, hero metrics, gradient accents, identical card grids.
- **Don't** announce browser-native-ness. No cute "isn't it cool that this works on the web" illustrations, no marketing-ish empty states.
- **Don't** reach for side-stripe borders as a default accent. The Notification widget's 4px severity rail and the parts-tree-row 2px Workshop-Steel rail are the *only* sanctioned side stripes — both earn the exception by being precise navigation/severity signals. On cards, list items, callouts — severity is carried by full borders + tinted surfaces.
- **Don't** use gradient text. Single solid color, weight or size for emphasis.
- **Don't** put `backdrop-filter: blur(...)` on edge-anchored chrome (the tab bar) — that surface defines the workspace boundary and should be opaque. Floating overlays earn glass; structural anchors don't.
- **Don't** reach for a modal as the first idea. Inline editing (the variable row pattern) is the house style. Modals exist (export, file dialogs) but are the second answer, not the first.
- **Don't** introduce a structural left sidebar or top-bar row. The Floating Layout Rule is load-bearing — the part has to be the largest thing on screen.
- **Don't** use serif fonts, script fonts, or display fonts. The sans stack is Geist Sans, full stop; the mono stack is IBM Plex Mono.
- **Don't** use letter-spacing on body text. Tracking is reserved for the uppercase **Tag** register.
- **Don't** introduce sentence-case "Great job!" affirmations, mascots, or success illustrations. Confirmation is a state change, not a celebration.
