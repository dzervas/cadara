# Rendered views (trial prototype)

`cadara-rt look [tilePx]` renders the current model (all bodies) from native tessellation into one PNG. It is a 2×2 grid:

1. isometric (from +X −Y +Z)
2. front (from −Y; X right, Z up)
3. top (from +Z; X right, Y up)
4. right (from +X; Y right, Z up)

All views use shaded faces with dark feature edges and the same scale (mm per pixel, reported in `layout`). The command prints the image path; open it with your file-read tool to see it. The default tile is 384 px; smaller tiles cost fewer image tokens.

Images are **display evidence only**. Use them to check proportions, placement, missing or extra features, and orientation. Judge exact dimensions from `inspect`, topology and bounds.
