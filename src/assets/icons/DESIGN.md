# CADara icon design

Status: approved through revision 07 (cadara-4ti). Canonical sources live in
`src/assets/icons/`; identical icons use the relative symlinks listed below.
`public/icons/` holds only symlinks for files pages outside the app need by URL.

## Intent

Precise, quiet technical drawings for a dense professional workbench. Follow
`PRODUCT.md` and the root `DESIGN.md`: graphite chrome, visible tools, no miniature
illustrations or decorative color. Design each symbol from the operation it
represents. Familiar geometric conventions are useful; unnecessary detail is not.

## Geometry

- One `viewBox="0 0 20 20"`. Default display size: 20 px; inspect at 16, 20 and 24 px.
- Normally stay inside coordinates 2–18, including stroke and point markers.
- Main stroke: 1.5 units, round caps and round joins. Geometry remains angular;
  rounded joins soften the ink, not the underlying shape.
- Primary geometry: continuous stroke. Auxiliary guides: 1 unit, opacity .5.
- Click locations: golden filled circles, normally radius 1.5. Midpoint line
  emphasizes its first click with radius 2; its generated opposite half is quiet.
  Mark actual placement inputs, not every geometric vertex. For tools selecting
  existing geometry, highlight the selectable edge, curve or region instead.
- Leave about 2 units between unrelated strokes. Remove details before shrinking
  gaps. Judge optical balance at 20 px, not only on the enlarged drawing.
- Use a consistent shallow oblique projection for solids: receding edges run
  up/right. No gradients, lighting, thick silhouettes or faux-3D shading.
- Every arrow uses the horizontal dimension's exact geometry: a filled,
  unstroked isosceles head **2.75 units long and 3 units wide**, on a **1.5-unit
  butt-capped shaft**. No narrower diagonal heads, larger action heads or open
  chevrons. Rotate and translate this shape; never stretch it per icon.
- Canonical right-pointing head with its tip at the origin:
  `M0 0-2.75-1.5v3Z`, `fill="currentColor"`, `stroke="none"`.
  Its shaft ends at `(-2.25, 0)`, .5 units inside the base. For any unit direction
  vector `u`, tip `t`, and perpendicular `n`, the base corners are
  `t - 2.75u ± 1.5n`; the shaft ends at `t - 2.25u`. Rotate first, then round
  coordinates to two decimals. This applies to distance, projected dimensions,
  radius, import, reference and extrusion arrows alike.
- The head tip is the visible endpoint: there is no round cap or stroked join
  beyond it. Round caps remain the default for geometry and gold edge highlights;
  butt caps are specific to arrow shafts. Disclosure chevrons, check marks,
  constraint symbols and the pointer cursor are symbols, not directional arrows;
  they retain their conventional shapes rather than receiving arrowheads.
- Undo/Redo are an explicit user-requested exception to dimensional arrowheads:
  an open 5-unit return corner flows into a broad swept-back curve. They use the
  same 1.5-unit round stroke as geometry, not filled dimension triangles. The two
  icons are exact horizontal reflections. Avoid circular reload loops and
  quarter-turn traffic arrows. Visual direction reference: Lucide's Undo family
  (https://lucide.dev/icons/undo-2); these paths are independently authored.
- Dimension tips stop at least .25 units before the target's visible stroke
  boundary (half its stroke width), not at its path centerline. For radial tips,
  compute the circle intersection; do not approximate it with a bounding-box corner.
  Action arrows may intentionally lead outside a solid, but stay inside the icon.

## Color and rendering

- Base ink uses `currentColor`; click targets use
  `var(--cadara-icon-action, currentColor)`; `none` is allowed. No literal colors,
  baked backgrounds, CSS filters or embedded raster content.
- Main geometry is opaque. Secondary guides may use opacity .5; area previews
  may use opacity .18, or .45 for the approved Fill tool's selectable interior.
  Neither may carry the only distinguishing information.
- The host owns normal, hover, selected, disabled and status colors. Per the
  icon review decision, the app's subtle golden accent now identifies expected
  click targets. This is an explicit approved extension of the root design's
  Spark Affordance rules, not permission to decorate unrelated chrome.
- `ToolIcon` binds `--cadara-icon-action` to `--workbench-spark-accent`. Disabled
  tools collapse both inks to `currentColor`. Shell and annotation icons remain
  neutral so status colors inherit from their hosts. Shape must still distinguish
  tools without gold. Tools without canvas click targets need no gold ornament.
- `SvgIcon` renders trusted repository SVGs inline, bundled by Vite for both the
  web app and single-file build. Never pass imported document SVG into it.
  External SVGs inside `<img>` do not inherit a button's `currentColor`; masks
  flatten internal opacity. No separate single-file icon injection is needed.
- No fixed SVG width/height. Stroke scales with the icon; do not use
  `vector-effect="non-scaling-stroke"` for enlarged inspection.

## Semantic grammar

| Family                                              | Distinction                                                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Line / midpoint line                                | Two endpoint clicks versus an emphasized center click, one endpoint click and a quieter generated half.                                   |
| Rectangle / center rectangle                        | Opposite corner markers versus center marker and diagonal guides.                                                                         |
| Aligned rectangle                                   | Rotated rectangle with its defining edge endpoints marked.                                                                                |
| Circle / three-point circle                         | Center marker and radius guide versus three circumference markers.                                                                        |
| Center / three-point / tangent arc                  | Radii meeting at center; three arc markers; tangent source segment continuing into the arc.                                               |
| Inscribed / circumscribed polygon                   | A three-sided regular polygon inside its circumcircle versus around its incircle. Same triangle; vertex click versus side-midpoint click. |
| Horizontal / vertical constraint                    | A selected segment with an orientation witness. No dimension arrowheads.                                                                  |
| Distance / horizontal / vertical / radius dimension | Measurement arrows; projected dimensions have extension lines, radius has one center-to-rim arrow.                                        |
| Construction                                        | Dash-dot geometry, matching the viewport's dash-dot convention at icon scale.                                                             |
| Reference                                           | Source geometry projected onto a destination plane. Not another dashed line.                                                              |
| Import / import image                               | Incoming arrow and generic document versus incoming arrow and picture frame.                                                              |
| Section view                                        | Solid with an explicit cut face and sparse section hatching.                                                                              |
| SVG rendering / fill / stroke                       | Combined area-and-edge preview with visibility cue; filled interior; outline with edge emphasis.                                          |

Polygon exemplars intentionally use three sides: a hexagon leaves less than
one pixel of useful separation after stroke at native size. The three-sided
example exposes inside/outside clearly; it does not prescribe the tool's default
side count.

Extrude retains the shared oblique solid scaffold: a gold parallelogram depicts
an XY sketch, a matching neutral parallelogram sits directly above it, and
vertical connectors and an upward arrow show the normal-direction extrusion.
The source sketch must not read as an upright front face.

Remaining-family conventions:

- Fit-point splines put gold points on the curve. Per review, Control Spline uses
  that same curve with neutral existing points, one additional gold point and a
  plus sign. Bezier shows the two independent endpoint handles.
- Flip Direction proposes a double-headed reversal arrow across a quiet datum;
  it must not read as reload or recycle. Undo/Redo use the swept return convention
  above, not a circular loop.
- Sketch surfaces have four parallelogram corners with parallel opposite edges.
  Shell exposes an open cavity and wall thickness; Split shows a translucent
  cutting plane rather than an isolated line. Its two solid halves must be exact
  translated copies with identical top/bottom heights and depth vectors; make
  room around the plane without independently reshaping either half.
  Delete Solid uses the trash motif.
- Ruler ticks divide the long edge into four equal intervals, including the
  margins at both ends. Pencil/Ruler combines the canonical Measure
  ruler geometry with the Edit pencil geometry, rather than redrawing either.
  In revision 06, both motifs are rotated upright and scaled uniformly to .8,
  placed side by side with a visible gap rather than crossed. Rendered composite
  strokes are 1.2 units; the standalone canonical motifs remain unchanged.
- Constraint icons emphasize selected geometry and use quiet witnesses for the
  geometric relation. They do not use measurement arrowheads.
- Sketch and solid pattern tools intentionally share their repeated-shape grammar;
  the toolbar mode supplies dimensional context. The generic Pattern entry shares
  Linear Pattern artwork. Identical whole-icon assets must be relative symlinks
  to one canonical SVG, not copies kept in sync.
- Shell actions, status glyphs and annotation glyphs inherit `currentColor` only.
  Gold is reserved for canvas click/selection semantics, not generic buttons.
- Reuse the same neutral cube for body and view-cube glyphs; the same check for
  Finish Sketch and confirmation; the same ruler for Measure and shell measurement.
  Current aliases: `sketchCircularPattern → circularPattern`,
  `dimensionDistance → dimension`, `shell-check → finishSketch`,
  `shell-import → import`, `pattern` and `sketchLinearPattern → linearPattern`,
  `shell-ruler → measure`, `view-cube → shell-box` (all `.svg`).
  Composite icons remain distinct compositions. Their smaller secondary badges
  may use a 1-unit rendered stroke for detail, while primary geometry stays 1.5.
- Third-party brand marks remain outside the redraw and retain their official
  artwork. They are exempt from the authored grid and paint restrictions.

These symbols communicate the tool, not its full instructions. Tooltips remain
necessary. The relationship between circle and polygon, and between an arc and
its defining points, must be geometrically correct.

## Authoring and size

Author editable SVG directly with `path`, `circle`, `rect`, `ellipse`, `polyline`
and `polygon`. Prefer short meaningful paths over outlined strokes. Share
presentation attributes on the root or a group. Keep coordinates to integers,
halves, or at most two decimals when geometry needs them.

Target 250–700 bytes for simple symbols; this is a guideline, not a quota. No
metadata, editor namespaces, fonts, scripts, IDs, masks, filters or clip paths
unless a reviewed icon genuinely needs them. Optimization must preserve markers,
stroke widths, guide opacity and the image at native size.

## Comparison workflow

The reviewed comparison study is preserved outside production at JJ bookmark
`icon-review-4ti`, revision 07. Run its checkout with
`bun run dev -- --port 3016` and open `/prototype/icons/`. The following rules
apply to that review surface; its old assets and page do not ship in production.

- Show every registered tool (including menu variants) as its own old/new pair.
- Include shell glyphs with live consumers and direct viewport/inspector SVG consumers.
  A file or mapping entry alone is not evidence of use. Exclude unconsumed mappings.
- Reused old files do not imply reused new symbols.
- Keep pending rows visible by default; never present an old icon as a new one.
- Inspect at native size first, then click either half to enlarge both together.
- Review shape under neutral, muted and status ink, and on dark/light surfaces.
- The inspector's Reviewed checkbox and comment auto-save to local storage
  (`cadara.icon-prototype.reviews.v1`), per browser and origin/port. Reviewed means
  inspected, not necessarily approved. Storage failures are shown explicitly.
- Export review includes only icons with non-empty comments, independent of
  reviewed status and filters: ID, old/new paths, reviewed status, comment and the
  current proposed SVG source. Reviewed alone never adds an icon to the export.
  Copy the Markdown into the chat; manual selection works if clipboard access is
  unavailable. Export before changing browsers/ports or clearing browser storage.
- Third-party brand marks remain recognizable and are not redrawn.
- Only used assets are redraw scope. List unreferenced files separately; remove
  them after the replacement pass and a final consumer audit. Preserve the old
  used artwork until comparison review is complete.
- In the saved study, candidates live in `public/icons/prototype/`; file stems
  match comparison IDs. Approved sources are now in `src/assets/icons/`, with
  metadata selecting the matching asset. Remove obsolete sources only after a
  consumer audit. Static inventory and symlink tests guard that contract.

During design iteration, use targeted SVG and browser checks only. Do not run
`test:all` until the entire icon replacement and cleanup task is finished.

Before approval: compare dense neighbors, verify semantics, confirm small-size
legibility, audit theme inheritance and byte size, and review every pending row.
