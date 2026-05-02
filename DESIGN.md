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
    fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  headline:
    fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.20em"
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
  toolbar-shell:
    backgroundColor: "{colors.graphite-deep}"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.none}"
    padding: "0 16px"
  sidebar-shell:
    backgroundColor: "{colors.graphite-deep}"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.none}"
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
  sidebar-item:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.none}"
    padding: "6px 20px"
  sidebar-item-hover:
    backgroundColor: "color-mix(in oklch, {colors.graphite-deep} 94%, white 6%)"
    textColor: "{colors.graphite-bone}"
    rounded: "{rounded.none}"
    padding: "6px 20px"
  sidebar-item-active:
    backgroundColor: "color-mix(in oklch, {colors.graphite-deep} 88%, white 12%)"
    textColor: "{colors.graphite-bone}"
    iconColor: "{colors.graphite-100}"
    fontWeight: 600
    rounded: "{rounded.none}"
    padding: "6px 20px"
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
- Monochromatic shell. Saturated color is reserved for canvas semantics — selection, sketch references, status states.
- Typographic discipline carries the density: small text, wide-tracked uppercase labels, monospace for numbers.
- Soft layered shadows with a 1px inset top highlight, not glassmorphism, not flat-by-decree.

## 2. Colors: The Graphite Workshop

A 10-step graphite scale carries the entire shell — background, surfaces, text, borders, and the so-called "primary accent." Saturated color appears only where the user is looking *into* the model: viewport selection, sketch reference overlays, and status-tinted feedback.

### Primary
- **Workshop Steel** (`#9a9a9a` — workbench-4): The brand "primary." Honest acknowledgement: the primary color is a mid-grey. It carries focus rings, scrollbar thumbs, scrubber glows, and the subtle hint of "active" on tool buttons. It is not a hero color and is never used to attract attention; it is used to confirm state.

### Tertiary: Geometry Highlights (viewport-only)
- **Spark Orange** (`#f0a14a`): Selected geometry in the 3D viewport. Never appears in chrome.
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
- **Graphite Deep** (`#333333` — workbench-9): The wall. Background of toolbar, sidebar, viewport, tooltip surfaces — all share the same base, layered apart only by shadow.

### Status (Mantine defaults, used sparingly)
- **Danger** (Mantine red): Variable evaluation errors, destructive actions, error diagnostics.
- **Warning** (Mantine yellow): Diagnostic warnings.
- **Success** (Mantine green): Sole appearance in chrome is the *Finish Sketch* tool button — the only "go" affordance in the toolbar.

### Named Rules

**The Quiet Chrome Rule.** The shell is monochromatic. No saturated color belongs in the toolbar, sidebar, or panel chrome unless it is communicating a status the user must see. If a designer reaches for a brand color to make something feel "more designed," they have already failed the rule.

**The Geometry-Owns-Color Rule.** Saturated hues live where the part lives. Spark Orange is for geometry the user has selected, Pin Amber is for sketch references the user has placed, Mantine reds and yellows are for problems the user has caused. The shell stays out of the way.

**The Brand-Color-Is-Grey Rule.** The Mantine `primaryColor` is `workbench` and `primaryShade` is `4` — Workshop Steel. This is intentional. There is no purple, no electric blue, no neon. If a future feature needs a "primary" tint, it pulls from the graphite scale, not from a chromatic palette.

## 3. Typography

**Display Font:** IBM Plex Sans (with Segoe UI, sans-serif fallback)
**Body Font:** IBM Plex Sans (same stack — no display/body split)
**Mono Font:** Mantine's monospace stack — used exclusively for numeric values, expressions, and constraint readouts.

**Character:** One typeface, three sizes, two weights, one wide-tracked uppercase register. The voice is engineered, not editorial. IBM Plex was chosen for its competence on small sizes and its mechanical neutrality — it never tries to be charming, which is exactly right for an operator-grade tool. `font-synthesis: none` prevents browsers from faking weights or italics; if a weight isn't loaded, it doesn't render.

### Hierarchy
- **Display** (600, 20px, line-height 1.3): Reserved for top-level identity moments (rare in this shell). Headings inside the workspace are smaller.
- **Headline** (600, 16px, 1.4): Section titles inside dense panels — feature inspector headings, modal titles.
- **Title** (500, 13px, 1.4): Tool button labels, item names in the parts/objects tree, variable names. The dominant text register in the application.
- **Body** (400, 13px, 1.5): Tooltip descriptions, helper text, diagnostic messages.
- **Label** (600, 11px, line-height 1.2, letter-spacing 0.20em, uppercase): Section headers in the sidebar — `PARTS & OBJECTS`, `VARIABLES`, `DOCUMENT DIAGNOSTICS`. Identity-defining.
- **Mono** (400, 12px, 1.4): Variable expressions, evaluated values, dimension readouts, units. Anything where a `1` and an `l` need to be different shapes.

### Named Rules

**The Tracked Caps Rule.** Uppercase is used for sidebar section headers and for diagnostic severity tags — never for body copy, never for buttons, never for marketing-style emphasis. Tracking is `0.20em`. Anything tighter reads as "default uppercase" and breaks the register.

**The Mono-For-Numbers Rule.** Any field a user might compare against another field — a length, a constraint value, a coordinate, a variable result — is monospaced. The eye scans columns of `12.5` and `12.500001` and immediately sees the difference. Sans-serif numbers hide that difference.

**The No-Display-Hero Rule.** There are no oversized hero headlines. The largest text on screen is 20px. PRODUCT.md is explicit: *"oversized friendly buttons"* are an anti-reference. Restraint at the top of the scale is the point.

## 4. Elevation

The shell uses **layered shadows**, not glass or strokes, to separate planes. Every elevated surface in the chrome shares the same base color (Graphite Deep, `#333333`) and is pulled forward only by shadow weight and a 1px inset top highlight at 4–5% white. The result reads as soft sculpted depth — the toolbar floats over the viewport, the sidebar over the canvas, dropdowns over everything — without ever using a colored backdrop or a backdrop-filter blur.

### Shadow Vocabulary
- **Toolbar** (`box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25)`): The lightest of the structural shadows. Sits under the top toolbar.
- **Sidebar** (`box-shadow: 4px 0 20px rgba(0, 0, 0, 0.2)`): Horizontal-only shadow under the left sidebar — the depth runs sideways into the viewport, not down.
- **Elevation MD** (`box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.04)`): Standard surface elevation for menu dropdowns and the toolbar search palette.
- **Timeline** (`box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255, 255, 255, 0.05)`): The feature-history scrubber bar. Slightly stronger lift to communicate "draggable timeline."
- **Panel** (`box-shadow: 0 20px 50px rgba(0, 0, 0, 0.38), 0 1px 0 rgba(255, 255, 255, 0.04) inset`): The deepest shadow in the system. Reserved for floating panels, modals, and the heaviest overlays.

### Named Rules

**The Inner Highlight Rule.** Every elevated surface carries `0 1px 0 rgba(255, 255, 255, 0.04)` (or `0.05`) on the top edge. It is barely visible and that is the point — it gives the surface a sculpted lip that sells the depth without adding chrome. If a new surface skips this, it will read as flat-in-a-bad-way against the rest of the shell.

**The No-Glass Rule.** No `backdrop-filter: blur(...)` in the chrome. Surfaces are opaque or use `color-mix(... transparent)` for tonal layering, never optical blur. PRODUCT.md says it directly: glassmorphism reads as 2014, and it is forbidden.

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

### Sidebar Items (Parts & Objects, Variables, Diagnostics)
- **Shape:** No rounding on the row itself — full-width hit target with internal padding `6px 20px`.
- **Default state:** Transparent background, 13px Title typography, leading 14px tool icon in Workshop-Steel.
- **Hover:** Background lifts one graphite step (`--workbench-shell-sidebar-item-hover`). Text and icon stay in their default tone so incidental pointer travel does not read as selection.
- **Selected:** Background lifts a second graphite step (`--workbench-shell-sidebar-item-selected`), label weight tightens to semibold, and the leading icon brightens to `Graphite 100`. Selection should read as a committed state even when the pointer is elsewhere.
- **Hidden state:** Container at `opacity: 0.55`, eye icon flips from open to closed.
- **Trailing affordance:** Visibility toggle as a 24px subtle ActionIcon, only visually committed on hover or when toggled.

### Section Headers (Sidebar)
- **Style:** Label typography (11px, 600, uppercase, tracking 0.20em), `Graphite 300`. Header sits above its scroll region, padded `12px 16px`. No divider rule — the shadow and the typographic register do all the separating.

### Variable Rows (Sidebar)
- **View mode:** Two-column row — name on the left (Title typography), expression chip + `=` separator + result chip on the right.
- **Expression chip:** Mono typography, 12px, `Graphite Deep` background, 1px Graphite border, `{rounded.sm}`.
- **Result chip:** Same shape; tinted *green-success-surface* when valid, *red-danger-surface* when evaluation fails. The literal text `???` appears in the result chip on error and a tooltip auto-opens with the failure message.
- **Edit mode:** Two inline `<input>`s in a `1fr / 0.75fr` grid; commits on blur or Enter, cancels on Escape.

### Tooltips
- **Shape:** `{rounded.md}` (8px), 1px Graphite-strong border, **Panel** shadow.
- **Background:** Graphite-8 at 98% opacity (a hair lighter than Graphite Deep so the tooltip lifts off the surface that triggered it).
- **Content:** Two-line — title in 12px semibold `Graphite Bone`, description in 12px Graphite-2 with `leading-relaxed`. Optional `ShortcutHint` floats to the right of the title.
- **Behavior:** No arrow, 100ms `openDelay`, max-width 280px or `calc(100vw - 32px)` on narrow viewports. Multiline allowed.

### Diagnostic Cards (Sidebar)
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
- **Labels:** Face labels (`TOP`, `FRONT`, etc.) are rendered to a 256×128 canvas texture using `600 42px IBM Plex Sans, Segoe UI, sans-serif` with a thick 10px outline in the viewport background color and fill in `--workbench-shell-text` (Graphite Bone). The outline reads as a halo against any face tint, keeping the text legible.
- **Corners:** Same Viewcube Slate fill and Viewcube Outline edges. Corners are clickable for isometric-style 3/4 views.
- **Lighting:** Ambient `#ffffff` at 1.1 intensity plus a directional light at 0.9 — bright enough that the cube reads as flatly lit (deliberately uniform, no dramatic shading) so the user reads it as a navigation widget, not as a model.

### Named Rules

**The Visible Tool Rule.** Every tool the operator might need is on the toolbar at all times. There are no "advanced" overflow menus that hide capability. Dropdown variant families exist (e.g., pattern variants), but their parent is always present. *"Discoverability beats minimalism in a CAD app where missing a tool costs minutes of hunting."* — PRODUCT.md.

**The 320px-Inspector Rule.** The inspector / sidebar width is `320px`. Components inside it are designed to fit that width without horizontal scroll. If a future panel needs more, the right answer is to refactor the panel, not widen the shell.

**The No-Round-On-Shell Rule.** The toolbar Paper and the sidebar Paper are `radius={0}`. Rounding is for *components inside* the shell, not the shell itself. The window-edge feel comes from sharp shell corners + soft component corners.

## 6. Do's and Don'ts

### Do:
- **Do** keep saturated color confined to the viewport, sketch overlays, and status states. New chrome is graphite-on-graphite or it is rejected.
- **Do** use `{rounded.md}` (8px) for components and `{rounded.none}` (0) for the shell itself.
- **Do** match the Inner Highlight Rule on every new elevated surface — a 1px inset top highlight at ~4% white. Without it, the surface reads as a flat patch.
- **Do** use IBM Plex Sans for everything, monospace only for numbers, units, expressions, and identifiers.
- **Do** apply 0.20em letter-spacing on uppercase section labels at 11px/600, and never at body sizes.
- **Do** treat hobbyists as professionals. Tooltips are short, exact, and load-bearing — not "Welcome! 👋" copy.
- **Do** use Mantine primitives configured through `workbench-theme.ts`. New bespoke styled components require a reason; new bespoke `<div>` chrome requires a *very* good reason.

### Don't:
- **Don't** introduce a "primary brand color" that isn't grey. The brand is grey on purpose. PRODUCT.md is unambiguous: this is a tool, not a dashboard.
- **Don't** ship UI that reads as **SolidWorks** — frozen-in-2005 chrome, baroque dialog stacks, every feature with a different visual language.
- **Don't** ship UI that reads as **FreeCAD** — inconsistent enough to feel broken, default Qt look. Open-source must not look open-source in the bad way.
- **Don't** ship UI that reads as **Rhino** — IDE-cold, panel-stacked, hostile to anyone who isn't already a Rhino expert.
- **Don't** ship UI that reads as **TinkerCAD** — playful illustrations, oversized friendly buttons, "let's design a robot!" copy. CADara users are adults making real things.
- **Don't** use the **generic SaaS dashboard cliché** — cards-and-charts, hero metrics, gradient accents, identical card grids. CADara is a tool, not a dashboard.
- **Don't** announce browser-native-ness. No cute "isn't it cool that this works on the web" illustrations, no marketing-ish empty states, no intro tours about "how to use the browser app."
- **Don't** reach for side-stripe borders as a default accent. The Notification widget's 4px severity rail is the *only* sanctioned side stripe in the system, and it earns that exception because notifications are short-lived overlays where severity must be readable in peripheral vision. On cards, list items, sidebar rows, diagnostics, callouts — severity is carried by full borders + tinted surfaces, never side stripes.
- **Don't** use gradient text. Single solid color, weight or size for emphasis.
- **Don't** apply `backdrop-filter: blur(...)` to chrome surfaces. No glassmorphism. Use opaque graphite layered by shadow.
- **Don't** reach for a modal as the first idea. Inline editing (the variable row pattern) is the house style. Modals exist (export, file dialogs) but are the second answer, not the first.
- **Don't** use rounded corners on the shell itself. The toolbar and sidebar are `radius={0}`.
- **Don't** use serif fonts, script fonts, or display fonts. The stack is IBM Plex Sans, full stop.
- **Don't** use letter-spacing on body text. Tracking is reserved for the uppercase section-label register.
- **Don't** introduce sentence-case "Great job!" affirmations, mascots, or success illustrations. Confirmation is a state change, not a celebration.
