import { createRegularPolygonSketchToolDefinition } from '@/domain/sketch-tools/tools/polygon-shared'

export const circumscribedPolygonSketchToolDefinition = createRegularPolygonSketchToolDefinition({
  id: 'circumscribedPolygon',
  name: 'Circumscribed Polygon',
  tooltip: 'Create a regular polygon with sides tangent to a construction circle.',
  mode: 'circumscribed',
})
