# Product

## Register

product

## Users

Primarily hobbyists and 3D-printing makers who've tried mainstream CAD (Fusion 360, Onshape, SolidWorks) and bounced off — not because parametric CAD is too complex, but because the UI feels dated, the pricing is hostile, and the feature set is bloated with things they'll never use. These users are competent: they can model parametrically, they understand sketches and constraints, they just want a tool that respects their time and runs anywhere.

Secondary: CAD-literate engineers refugees from proprietary tools who can do their work without surfacing, FEA, or other heavy modules. CADara is not catching up to SolidWorks feature-for-feature — that's not the job.

Context: dedicated session at a desktop or laptop, often offline, often working toward a part they intend to print or laser-cut.

## Product Purpose

CADara is an open-source, browser-based, offline-capable CAD application. It exists because the proprietary CAD market is hostile to people who just want to make things, and existing free alternatives feel either broken (FreeCAD) or toy-like (TinkerCAD).

Winning is about interop, not feature parity. Success looks like:

- A user can drag in an `.sldprt`, `.sldasm`, or `.f3d` file, keep working, and not feel like they lost anything.
- Mesh-to-solid conversion is exceptionally good — drop in an STL, get a clean editable solid back with minimal manual cleanup.
- One click takes a finished model from CADara to MakerWorld, Printables, or a slicer.
- Eventually: 2D users (laser cutters, CNC) pick CADara because the geometry kernel and UX are better than what they currently use.

Geometry quality is table stakes. UX is the moat.

## Brand Personality

Modern, confident, direct. The tool of someone who knows what they're doing and respects that you do too.

Reference for feel: **Plasticity** — bold, dark, modern, decisive. Where CADara diverges from Plasticity: tools should stay visible. Plasticity hides a lot behind discoverability and shortcuts; that requires substantial UX work to make graceful, and CADara doesn't earn that yet. Onshape is a useful baseline for clean and organized, but it doesn't feel modern.

The interface should look like it was made in 2026, not retrofitted from 2005. Dense without being cramped. Dark-first because that's where this category lives, but light is a future nice-to-have.

## Anti-references

- **SolidWorks** — frozen-in-2005 chrome, baroque dialog stacks, every feature has a different visual language.
- **FreeCAD** — inconsistent enough to feel broken; default Qt look reads as unfinished open-source. CADara is open-source; it must not look open-source in the bad way.
- **Rhino** — feels like an IDE, not a creative tool. Too many panels, too much state, hostile to anyone who isn't already an expert in _Rhino specifically_.
- **TinkerCAD** — kid-centered. Playful illustrations, oversized friendly buttons, "let's design a robot!" copy. CADara users are adults making real things.
- **Generic SaaS dashboard cliché** — cards-and-charts, hero metrics, gradient accents. CADara is a tool, not a dashboard.
- **"Look, we run in the browser!" tells** — cute illustrations announcing the web-app-ness, intro tours, marketing-ish empty states. Browser-native should be invisible.

## Design Principles

1. **Interop is identity.** Every friction point importing from a proprietary competitor is treated as an existential bug, not a nice-to-have. The first impression for most users is whether their existing files open cleanly.
2. **Visible tools beat hidden tools.** Until UX work earns the right to hide things gracefully (à la Plasticity), tools live where users can see them. Discoverability beats minimalism in a CAD app where missing a tool costs minutes of hunting.
3. **Treat hobbyists as professionals.** No oversized friendly buttons, no cartoon mascots, no "great job!" affirmations. The audience is competent and dignified; the interface should match.
4. **Browser-native is invisible.** Never announce that CADara runs in a browser. No "isn't it cool that this works on the web" energy. It just works, like a real desktop app would.
5. **Density, but readable.** This is a CAD app — there are a lot of tools, modes, and pieces of state. Embrace that density, but commit to typographic and spatial discipline so the density never reads as cluttered.

## Accessibility & Inclusion

- Dark-first is the default. Light mode is a future nice-to-have, not a current requirement.
- WCAG conformance is not a current priority. Don't bend designs to AA contrast ratios at the cost of the intended look — but don't write actively inaccessible markup either (semantic elements, keyboard reachability, focus states are still required as basic hygiene).
- Alt input methods (touch, pen, 3D mouse / SpaceMouse) will become a first-class concern soon. Don't actively design against them: keep hit targets reasonable, don't depend on hover-only affordances, leave room for gesture surfaces.
