// One table for both the landing scene's materials and the body colours the
// example build scripts write into the native files (`body.color.set`), so
// opening an example in CADara shows the parts as the landing page does.
// Gold, not Spark Orange: orange is CADara's selection colour.
export const finishes = {
  silver: { color: "#bfc6cc", metalness: 0.55, roughness: 0.36 },
  graphite: { color: "#7f8a96", metalness: 0.3, roughness: 0.48 },
  gold: { color: "#d4af37", metalness: 0.6, roughness: 0.32 },
  black: { color: "#14171a", metalness: 0.08, roughness: 0.55 },
} as const;

export type Finish = keyof typeof finishes;

/** The `body.color.set` appearance of a part with `finish`. */
export function finishBodyAppearance(finish: Finish) {
  return { kind: "custom", hex: finishes[finish].color } as const;
}
