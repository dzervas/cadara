import { test } from 'bun:test'

import { getMeasurementWitnessStyleConfig } from '@/components/cad/measurement-witness-style'

test('src/components/cad/measurement-witness-style.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const style = getMeasurementWitnessStyleConfig()

  assert(style.core.color === 0xffde59, 'Measurement witness core lines should use the bright yellow accent.')
  assert(style.halo.lineWidth > style.core.lineWidth, 'Measurement witness halo should render wider than the core line.')
  assert(style.halo.opacity < style.core.opacity, 'Measurement witness halo should stay softer than the core line.')
  assert(style.marker.scale > 1, 'Measurement witness markers should be emphasized over default point markers.')
})
