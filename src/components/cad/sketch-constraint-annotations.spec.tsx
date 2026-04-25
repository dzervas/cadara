import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  SketchConstraintAnnotations,
} from '@/components/cad/sketch-constraint-annotations'
import { getAnnotationProjectionId } from '@/components/cad/sketch-viewport-feedback-model'
import type { SketchAnnotationDescriptor } from '@/domain/editor/sketch-session'

test('src/components/cad/sketch-constraint-annotations.spec.tsx', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const annotation: SketchAnnotationDescriptor = {
    id: 'constraint_1_parallel',
    target: {
      kind: 'constraint',
      sketchId: 'sketch_draft',
      constraintId: 'constraint_1_parallel',
    },
    glyphKind: 'constraintParallel',
    anchor: { kind: 'sketchPoint', point: [5, 2], offset: { x: 18, y: -18 } },
    affectedGeometryRefs: [
      { kind: 'sketchEntity', sketchId: 'sketch_draft', entityId: 'sketch_entity_1_line' },
      { kind: 'sketchEntity', sketchId: 'sketch_draft', entityId: 'sketch_entity_2_line' },
    ],
    constraintDisplay: { state: 'overconstrained', isAffectedOverconstraint: true },
    label: 'Parallel',
    detail: 'Parallel lines',
    status: 'constraint',
  }
  const dimensionAnnotation: SketchAnnotationDescriptor = {
    id: 'dimension_1_distance',
    target: {
      kind: 'dimension',
      sketchId: 'sketch_draft',
      dimensionId: 'dimension_1_distance',
    },
    glyphKind: 'dimensionDistance',
    anchor: { kind: 'sketchPoint', point: [5, 2], offset: { x: 0, y: -28 } },
    affectedGeometryRefs: [
      { kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_1_start' },
      { kind: 'sketchPoint', sketchId: 'sketch_draft', pointId: 'sketch_point_1_end' },
    ],
    label: 'Distance',
    detail: '10.00 mm distance',
    status: 'dimension',
    visibleLabel: '10.00',
    dragHandle: {
      id: 'dimension_1_distance-annotation-drag',
      dimensionId: 'dimension_1_distance',
    },
  }
  const angleDimensionAnnotation: SketchAnnotationDescriptor = {
    ...dimensionAnnotation,
    id: 'dimension_2_angle',
    target: {
      kind: 'dimension',
      sketchId: 'sketch_draft',
      dimensionId: 'dimension_2_angle',
    },
    glyphKind: 'dimensionAngle',
    label: 'Line angle',
    detail: '90.0 deg angle',
    visibleLabel: '90.0°',
    dragHandle: {
      id: 'dimension_2_angle-annotation-drag',
      dimensionId: 'dimension_2_angle',
    },
  }
  const horizontalAnnotation: SketchAnnotationDescriptor = {
    ...annotation,
    id: 'constraint_2_horizontal',
    target: {
      kind: 'constraint',
      sketchId: 'sketch_draft',
      constraintId: 'constraint_2_horizontal',
    },
    glyphKind: 'constraintHorizontal',
    label: 'Horizontal',
    detail: 'Horizontal line',
  }
  const verticalAnnotation: SketchAnnotationDescriptor = {
    ...annotation,
    id: 'constraint_3_vertical',
    target: {
      kind: 'constraint',
      sketchId: 'sketch_draft',
      constraintId: 'constraint_3_vertical',
    },
    glyphKind: 'constraintVertical',
    label: 'Vertical',
    detail: 'Vertical line',
  }
  const newGlyphAnnotations: SketchAnnotationDescriptor[] = [
    ['constraintConcentric', 'Concentric'],
    ['constraintMidpoint', 'Midpoint'],
    ['constraintNormal', 'Normal'],
    ['constraintPierce', 'Pierce'],
    ['constraintSymmetric', 'Symmetric'],
    ['constraintFixed', 'Fixed'],
  ].map(([glyphKind, label], index) => ({
    ...annotation,
    id: `constraint_new_${index}`,
    target: {
      kind: 'constraint',
      sketchId: 'sketch_draft',
      constraintId: `constraint_new_${index}`,
    },
    glyphKind: glyphKind as SketchAnnotationDescriptor['glyphKind'],
    label,
    detail: `${label} constraint`,
  }))

  const markup = renderToStaticMarkup(
    <SketchConstraintAnnotations
      annotations={[annotation, dimensionAnnotation, angleDimensionAnnotation, horizontalAnnotation, verticalAnnotation, ...newGlyphAnnotations]}
      projections={[
        { id: getAnnotationProjectionId(annotation.id), x: 120, y: 80 },
        { id: getAnnotationProjectionId(dimensionAnnotation.id), x: 120, y: 80 },
        { id: getAnnotationProjectionId(angleDimensionAnnotation.id), x: 180, y: 80 },
        { id: getAnnotationProjectionId(horizontalAnnotation.id), x: 220, y: 80 },
        { id: getAnnotationProjectionId(verticalAnnotation.id), x: 260, y: 80 },
        ...newGlyphAnnotations.map((entry, index) => ({
          id: getAnnotationProjectionId(entry.id),
          x: 300 + index * 36,
          y: 80,
        })),
      ]}
      hoveredAnnotation={annotation.target}
      selectedAnnotation={annotation.target}
      onHover={() => undefined}
      onClearHover={() => undefined}
      onSelect={() => undefined}
      onEdit={() => undefined}
    />,
  )

  assert(
    markup.includes('data-sketch-annotation-glyph="constraintParallel"'),
    'Committed annotation glyphs should render from descriptor glyph kinds.',
  )
  assert(
    markup.includes('z-30'),
    'Committed annotation glyphs should render above committed dimension overlay geometry.',
  )
  assert(
    markup.includes('/icons/sketch-parallel.svg') && markup.includes('/icons/sketch-dimension.svg'),
    'Committed annotation glyphs should use toolbar SVG assets.',
  )
  assert(
    markup.includes('/icons/drawing-angular-dim-line-to-line.svg'),
    'Committed angle dimension annotations should use the angular dimension icon asset.',
  )
  assert(
    markup.includes('/icons/sketch-horizontal.svg') && markup.includes('/icons/sketch-vertical.svg'),
    'Horizontal and vertical constraint annotations should use visible public icon assets.',
  )
  assert(
    markup.includes('/icons/sketch-concentric.svg') &&
      markup.includes('/icons/sketch-midpoint.svg') &&
      markup.includes('/icons/sketch-normal.svg') &&
      markup.includes('/icons/sketch-pierce.svg') &&
      markup.includes('/icons/sketch-symmetric.svg') &&
      markup.includes('/icons/sketch-fix.svg'),
    'New committed constraint glyphs should use their dedicated toolbar SVG assets.',
  )
  assert(
    markup.includes('left:120px') && markup.includes('left:158px') && markup.includes('top:80px'),
    'Committed annotation glyphs should offset colliding projected anchors.',
  )
  assert(
    markup.includes('Parallel: Parallel lines') && markup.includes('Distance: 10.00 mm distance'),
    'Committed annotation glyphs should preserve durable label/detail metadata for accessible labels.',
  )
  assert(
    markup.includes('data-sketch-annotation-kind="dimension"') && markup.includes('>10.00<'),
    'Committed dimensions should render as compact icon-plus-value chips.',
  )
  assert(
    markup.includes('var(--workbench-shell-danger-text)'),
    'Affected overconstrained annotation glyphs should use the shared danger theme token.',
  )
})
