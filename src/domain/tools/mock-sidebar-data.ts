export const featureTreeItems = [
  {
    id: "origin-planes",
    label: "Origin Planes",
    description: "XY, YZ, XZ reference setup",
    kind: "plane",
  },
  {
    id: "sketch-1",
    label: "Sketch 1",
    description: "Primary profile on the XY plane",
    kind: "sketch",
  },
  {
    id: "extrude-1",
    label: "Extrude 1",
    description: "Mid-plane boss feature",
    kind: "feature",
  },
  {
    id: "fillet-1",
    label: "Fillet 1",
    description: "Edge softening for outer shell",
    kind: "feature",
  },
] as const;

export const partStudioObjects = [
  {
    id: "part-1",
    label: "Part 1",
    description: "Solid body",
  },
  {
    id: "surface-xy",
    label: "Plane XY",
    description: "Reference plane",
  },
  {
    id: "surface-yz",
    label: "Plane YZ",
    description: "Reference plane",
  },
] as const;
