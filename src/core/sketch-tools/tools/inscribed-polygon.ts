import { createRegularPolygonSketchToolDefinition } from '@/core/sketch-tools/tools/polygon-shared'

export const inscribedPolygonSketchToolDefinition = createRegularPolygonSketchToolDefinition({
  id: 'inscribedPolygon',
  name: 'Inscribed Polygon',
  tooltip: 'Create a regular polygon with vertices on a construction circle.',
  mode: 'inscribed',
  dropdown: {
    familyId: 'polygon-family',
    variantIds: ['inscribedPolygon', 'circumscribedPolygon'],
  },
})
